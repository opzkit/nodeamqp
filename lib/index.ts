import {
  Channel,
  connect,
  Connection as AMQPConn,
  ConsumeMessage,
} from "amqplib";
import { hostname } from "os";
import {
  eventsExchangeName,
  serviceEventQueueName,
  serviceEventRandomQueueName,
  serviceRequestExchangeName,
  serviceRequestQueueName,
  serviceResponseExchangeName,
} from "./naming";
import { LIB_VERSION } from "./version";
import { Logger, NoOpLogger } from "./logger";
import { MessageLogger, NoOpMessageLogger } from "./message_logger";

const QUEUE_EXPIRATION = 5 * 24 * 60 * 60 * 1000;

type Setup = (conn: Connection) => Promise<void>;

type Handler = (msg: any, headers: any) => Promise<any>;

type messageHandlerInvoker = {
  handler: Handler;
  queueRoutingKey: string;
};

type kind = "direct" | "topic" | "headers";

type Headers = {
  [key: string]: any;
};

class Publisher {
  private connection?: Connection;
  private exchange?: string;
  private service?: string;
  private messageLogger?: MessageLogger;

  setup(conn: Connection, exchange: string) {
    this.connection = conn;
    this.exchange = exchange;
    this.service = conn.serviceName;
    this.messageLogger = conn.messageLogger;
  }

  publish(msg: any, routingKey: string, headers: Headers = {}): Promise<void> {
    if (!this.connection || !this.connection.started || !this.exchange) {
      return Promise.reject(
        new Error("calling publish before start is completed is not possible")
      );
    }
    const content = Buffer.from(JSON.stringify(msg));
    this.messageLogger && this.messageLogger(content, routingKey, true);
    const success = this.connection.channel?.publish(
      this.exchange,
      routingKey,
      content,
      {
        headers,
        contentType: "application/json",
      }
    );
    if (success) {
      return Promise.resolve();
    }
    return Promise.reject(new Error("unable to publish message"));
  }
}

type queueHandlers = { [key: string]: messageHandlerInvoker };

class Connection {
  readonly url: string;
  started: boolean;
  readonly serviceName: string;
  connection?: AMQPConn;
  channel?: Channel;
  private handlers: {
    [key: string]: messageHandlerInvoker;
  } = {};
  logger: Logger = new NoOpLogger();
  messageLogger: MessageLogger = NoOpMessageLogger;

  constructor(serviceName: string, url: string) {
    this.url = url;
    this.started = false;
    this.serviceName = serviceName;
  }

  async start(...opts: Setup[]): Promise<void> {
    if (this.started) {
      return Promise.reject(new Error("already started"));
    }
    return connect(this.url, {
      clientProperties: {
        connection_name: `${this.serviceName}#v${LIB_VERSION}#@${hostname()}`,
      },
    })
      .then(async (conn: AMQPConn) => {
        this.connection = conn;
        const serverProperties = conn.connection.serverProperties;
        this.channel = await conn.createChannel();
        await this.channel.prefetch(20, true);
        await Promise.all(
          opts.map(async (fn: Setup) => {
            return fn(this);
          })
        );
        this.logger.info(
          `Successfully connected to ${serverProperties.product} ${serverProperties["cluster_name"]} ${serverProperties.version}`
        );
        this.setup();
        this.started = true;
        this.logger.info("nodeamqp started");
        return;
      })
      .catch((e) => {
        return Promise.reject(e);
      });
  }

  private setup() {
    const queues = Object.keys(this.handlers).reduce(
      (acc: { [key: string]: messageHandlerInvoker[] }, k: string) => {
        const [q] = k.split("<->", 1);
        acc[q] = acc[q] || [];
        acc[q].push(this.handlers[k]);
        return acc;
      },
      {}
    );
    const promises = Object.keys(queues).map((q: string) => {
      const h = queues[q];
      const qh = h.reduce((acc: queueHandlers, handler) => {
        const [, routingKey] = handler.queueRoutingKey.split("<->", 2);
        acc[routingKey] = handler;
        return acc;
      }, {});
      return new Promise((resolve, reject) => {
        this.channel!.consume(q, this.handleMsg(qh), {
          exclusive: false,
          noLocal: false,
        })
          .then((res) => resolve(res))
          .catch((e) => reject(e));
      });
    });
    return Promise.all(promises);
  }

  handleMsg(qh: queueHandlers): (msg: ConsumeMessage | null) => void {
    return (msg: ConsumeMessage | null): Promise<any> => {
      if (msg) {
        const key: string | undefined = msg.fields.routingKey;
        this.messageLogger && this.messageLogger(msg.content, key, false);
        if (!key || !qh[key]) {
          this.logger.error(
            `no handler found for routingkey: '${key}', rejecting message with requeue=false`
          );
          this.channel?.reject(msg, false);
          return Promise.resolve();
        }
        const content = JSON.parse(msg.content.toString("utf8"));
        return qh[key]
          .handler(content, msg.properties.headers)
          .then(() => {
            // TODO: Send response?
            this.channel?.ack(msg, false);
          })
          .catch(() => {
            this.channel?.nack(msg, false, true);
          });
      }
      return Promise.resolve();
    };
  }

  private static uniqueKey(queueName: string, routingKey: string): string {
    return `${queueName}<->${routingKey}`;
  }

  addHandler(
    queueName: string,
    routingKey: string,
    handler: Handler
  ): Error | undefined {
    const uniqueKey = Connection.uniqueKey(queueName, routingKey);
    if (this.handlers.hasOwnProperty(uniqueKey)) {
      return new Error(
        `routingkey ${routingKey} for queue ${queueName} already assigned to handler, can't reassign`
      );
    }
    this.handlers[uniqueKey] = { handler, queueRoutingKey: uniqueKey };
    return undefined;
  }

  exchangeDeclare(name: string, kind: kind): Promise<void> {
    return this.channel!.assertExchange(name, kind, {
      durable: true,
      autoDelete: false,
      internal: false,
    })
      .then(() => Promise.resolve())
      .catch((e) => Promise.reject(new Error(e)));
  }

  queueDeclare(queueName: string): Promise<void> {
    return this.channel!.assertQueue(queueName, {
      durable: true,
      autoDelete: false,
      exclusive: false,
      expires: QUEUE_EXPIRATION,
    }).catch((e) => Promise.reject(new Error(e)));
  }

  transientQueueDeclare(queueName: string): Promise<void> {
    return this.channel!.assertQueue(queueName, {
      durable: false,
      autoDelete: true,
      exclusive: false,
      expires: QUEUE_EXPIRATION,
    }).catch((e) => Promise.reject(new Error(e)));
  }

  async messageHandlerBindQueueToExchange(
    queueName: string,
    exchangeName: string,
    routingKey: string,
    kind: kind,
    handler: Handler,
    headers: Headers
  ): Promise<void> {
    let err = this.addHandler(queueName, routingKey, handler);
    if (err) {
      return Promise.reject(err);
    }

    await this.exchangeDeclare(exchangeName, kind);
    await this.queueDeclare(queueName);

    return this.channel!.bindQueue(queueName, exchangeName, routingKey, headers)
      .then(() => Promise.resolve())
      .catch((e) => Promise.reject(new Error(e)));
  }

  async messageHandlerBindTransientQueueToExchange(
    queueName: string,
    exchangeName: string,
    routingKey: string,
    kind: kind,
    handler: Handler,
    headers: Headers
  ): Promise<void> {
    let err = this.addHandler(queueName, routingKey, handler);
    if (err) {
      return Promise.reject(err);
    }

    await this.exchangeDeclare(exchangeName, kind);
    await this.transientQueueDeclare(queueName);

    return this.channel!.bindQueue(queueName, exchangeName, routingKey, headers)
      .then(() => Promise.resolve())
      .catch((e) => Promise.reject(new Error(e)));
  }
}

function useLogger(logger: Logger): Setup {
  return async (conn: Connection) => {
    conn.logger = logger;
  };
}

function useMessageLogger(logger: MessageLogger): Setup {
  return async (conn: Connection) => {
    conn.messageLogger = logger;
  };
}

function withPrefetchLimit(limit: number): Setup {
  return async (conn: Connection) => {
    conn.channel?.prefetch(limit, true);
  };
}

function closeListener(listener: (...args: any[]) => void): Setup {
  return async (conn: Connection) => {
    conn.channel?.on("close", listener);
  };
}

function eventStreamListener(routingKey: string, handler: Handler): Setup {
  return async (conn: Connection) => {
    const queueName = serviceEventQueueName(conn.serviceName);
    return conn.messageHandlerBindQueueToExchange(
      queueName,
      eventsExchangeName,
      routingKey,
      "topic",
      handler,
      {}
    );
  };
}

function transientEventStreamListener(
  routingKey: string,
  handler: Handler
): Setup {
  return async (conn: Connection) => {
    const queueName = serviceEventRandomQueueName(conn.serviceName);
    return conn.messageHandlerBindTransientQueueToExchange(
      queueName,
      eventsExchangeName,
      routingKey,
      "topic",
      handler,
      {}
    );
  };
}

function eventStreamPublisher(publisher: Publisher): Setup {
  return async (conn: Connection) => {
    await conn.exchangeDeclare(eventsExchangeName, "topic");
    publisher.setup(conn, eventsExchangeName);
  };
}

function servicePublisher(targetService: string, publisher: Publisher): Setup {
  return async (conn: Connection) => {
    publisher.setup(conn, serviceRequestExchangeName(targetService));
  };
}

function serviceResponseListener(
  targetService: string,
  routingKey: string,
  handler: Handler
): Setup {
  return async (conn: Connection) => {
    const exchangeName = serviceResponseExchangeName(targetService);
    const queueName = serviceResponseExchangeName(conn.serviceName);
    return conn.messageHandlerBindQueueToExchange(
      queueName,
      exchangeName,
      routingKey,
      "headers",
      handler,
      { service: conn.serviceName }
    );
  };
}

function serviceRequestListener(routingKey: string, handler: Handler): Setup {
  return async (conn: Connection) => {
    const exchangeName = serviceRequestExchangeName(conn.serviceName);
    const queueName = serviceRequestQueueName(conn.serviceName);
    const resExchangeName = serviceResponseExchangeName(conn.serviceName);
    await conn.exchangeDeclare(resExchangeName, "headers");
    return conn.messageHandlerBindQueueToExchange(
      queueName,
      exchangeName,
      routingKey,
      "direct",
      handler,
      {}
    );
  };
}

function requestResponseHandler(routingKey: string, handler: Handler): Setup {
  return async (conn: Connection) => {
    return serviceRequestListener(routingKey, (msg, headers) => {
      return handler(msg, headers).then((resp) => {
        if (resp) {
          const service = headers["service"];
          if (!service) {
            return Promise.reject(new Error("failed to extract service name"));
          }
          const content = Buffer.from(JSON.stringify(resp));
          const success = conn.channel?.publish(
            serviceResponseExchangeName(conn.serviceName),
            routingKey,
            content,
            {
              headers: { service: service },
              contentType: "application/json",
            }
          );
          if (success) {
            return Promise.resolve();
          }
          return Promise.reject(new Error("unable to publish message"));
        } else {
          return Promise.resolve();
        }
      });
    })(conn);
  };
}

export {
  Connection,
  Publisher,
  withPrefetchLimit,
  closeListener,
  eventStreamListener,
  transientEventStreamListener,
  eventStreamPublisher,
  servicePublisher,
  serviceResponseListener,
  serviceRequestListener,
  requestResponseHandler,
  useLogger,
  useMessageLogger,
};
