import { Channel, connect, Connection as AMQPConn } from "amqplib";
import { hostname } from "os";
import {
  eventsExchangeName,
  serviceEventQueueName,
  serviceEventRandomQueueName,
  serviceRequestExchangeName,
  serviceResponseExchangeName,
} from "./naming";
import { LIB_VERSION } from "./version";

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

  setup(conn: Connection, exchange: string) {
    this.connection = conn;
    this.exchange = exchange;
    this.service = conn.serviceName;
  }

  publish(msg: any, routingKey: string, headers: Headers = {}): Promise<void> {
    if (!this.connection || !this.exchange) {
      return Promise.reject(
        "calling publish before start is completed is not possible"
      );
    }
    const success = this.connection.channel?.publish(
      this.exchange,
      routingKey,
      Buffer.from(JSON.stringify(msg)),
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

class Connection {
  readonly url: string;
  private started: boolean;
  readonly serviceName: string;
  connection?: AMQPConn;
  channel?: Channel;
  private handlers: {
    [key: string]: messageHandlerInvoker;
  } = {};

  constructor(serviceName: string, url: string) {
    this.url = url;
    this.started = false;
    this.serviceName = serviceName;
  }

  async start(opts: Setup[]): Promise<Error | void> {
    if (this.started) {
      return new Error("already started");
    }
    return connect(this.url, {
      clientProperties: {
        connection_name: `${this.serviceName}#v${LIB_VERSION}#@${hostname()}`,
      },
    })
      .then(async (conn: AMQPConn) => {
        this.connection = conn;
        const serverProperties = conn.connection.serverProperties;
        console.info(
          `Successfully connected to ${serverProperties.product} ${serverProperties["cluster_name"]} ${serverProperties.version}`
        );
        this.channel = await conn.createChannel();
        await this.channel.prefetch(20, true);
        await Promise.all(
          opts.map(async (fn: Setup) => {
            return fn(this);
          })
        );
        this.setup();
        this.started = true;
        console.log("nodeamqp started");
        return;
      })
      .catch((e: Error) => e);
  }

  private setup() {
    const queues = Object.keys(this.handlers).reduce(
      (acc: { [key: string]: messageHandlerInvoker[] }, k: string) => {
        const [q, _] = k.split("<->", 1);
        acc[q] = acc[q] || [];
        acc[q].push(this.handlers[k]);
        return acc;
      },
      {}
    );
    type queueHandlers = { [key: string]: messageHandlerInvoker };
    const promises = Object.keys(queues).map((q: string) => {
      const h = queues[q];
      const qh = h.reduce((acc: queueHandlers, handler) => {
        const [_, routingKey] = handler.queueRoutingKey.split("<->", 2);
        acc[routingKey] = handler;
        return acc;
      }, {});
      return new Promise((resolve, reject) => {
        this.channel
          ?.consume(
            q,
            (msg) => {
              if (msg) {
                const key: string | undefined = msg.fields.routingKey;
                if (!key || !qh[key]) {
                  // TODO: Log?
                  this.channel?.reject(msg, false);
                }
                const content = JSON.parse(msg.content.toString("utf8"));
                qh[key]
                  .handler(content, msg.properties.headers)
                  .then((response) => {
                    // TODO: Send response?
                    this.channel?.ack(msg, false);
                  })
                  .catch((e) => {
                    this.channel?.nack(msg, false, true);
                  });
              }
            },
            {
              exclusive: false,
              noLocal: false,
            }
          )
          .then((res) => resolve(res))
          .catch((e) => reject(e));
      });
    });
    return Promise.all(promises);
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

  exchangeDeclare(name: string, kind: kind): Promise<Error | undefined> {
    if (this.channel) {
      return this.channel
        ?.assertExchange(name, kind, {
          durable: true,
          autoDelete: false,
          internal: false,
        })
        .then(() => Promise.resolve(undefined))
        .catch((e) => new Error(e));
    }
    return Promise.reject(new Error("channel not connected"));
  }

  queueDeclare(queueName: string): Promise<Error | undefined> {
    if (this.channel) {
      return this.channel
        ?.assertQueue(queueName, {
          durable: true,
          autoDelete: false,
          exclusive: false,
          expires: QUEUE_EXPIRATION,
        })
        .then(() => undefined)
        .catch((e) => new Error(e));
    }
    return Promise.reject(new Error("channel not connected"));
  }

  transientQueueDeclare(queueName: string): Promise<Error | undefined> {
    if (this.channel) {
      return this.channel
        ?.assertQueue(queueName, {
          durable: false,
          autoDelete: true,
          exclusive: false,
          expires: QUEUE_EXPIRATION,
        })
        .then(() => undefined)
        .catch((e) => new Error(e));
    }
    return Promise.reject(new Error("channel not connected"));
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

    err = await this.exchangeDeclare(exchangeName, kind);
    if (err) {
      return Promise.reject(err);
    }

    err = await this.queueDeclare(queueName);
    if (err) {
      return Promise.reject(err);
    }
    if (this.channel) {
      return this.channel!!.bindQueue(
        queueName,
        exchangeName,
        routingKey,
        headers
      )
        .then(() => Promise.resolve())
        .catch((e) => Promise.reject(new Error(e)));
    }
    return Promise.reject(new Error("channel not connected"));
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

    err = await this.exchangeDeclare(exchangeName, kind);
    if (err) {
      return Promise.reject(err);
    }

    err = await this.transientQueueDeclare(queueName);
    if (err) {
      return Promise.reject(err);
    }
    if (this.channel) {
      return this.channel!!.bindQueue(
        queueName,
        exchangeName,
        routingKey,
        headers
      )
        .then(() => Promise.resolve())
        .catch((e) => Promise.reject(new Error(e)));
    }
    return Promise.reject(new Error("channel not connected"));
  }
}

function withPrefetchLimit(limit: number): Setup {
  return async (conn: Connection) => {
    conn.channel?.prefetch(limit, true);
    return Promise.resolve(undefined);
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
    let err = await conn.exchangeDeclare(eventsExchangeName, "topic");
    if (err) {
      return Promise.reject(err);
    }

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
};
