import * as amqp from "amqplib";
import { ConsumeMessage } from "amqplib";
import {
  closeListener,
  Connection,
  eventStreamListener,
  eventStreamPublisher,
  Publisher,
  servicePublisher,
  serviceResponseListener,
  transientEventStreamListener,
  useLogger,
  useMessageLogger,
  withPrefetchLimit,
} from "./index";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-0000-0000-000000000000" }));

jest.mock("amqplib");

describe("Publisher", () => {
  it("should reject with error if no connection has been set", async () => {
    const publisher = new Publisher();
    return expect(
      publisher.publish({ a: true }, "testing")
    ).rejects.toThrowError(
      "calling publish before start is completed is not possible"
    );
  });

  it("should reject with error if connection has not been started ", async () => {
    const publisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");
    publisher.setup(connection, "test");
    return expect(
      publisher.publish({ a: true }, "testing")
    ).rejects.toThrowError(
      "calling publish before start is completed is not possible"
    );
  });

  it("should reject with error if publish fails ", async () => {
    const publisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockPublish = jest.fn();
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      publish: mockPublish,
    }));

    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });
    await connection.start(eventStreamPublisher(publisher));
    await expect(
      publisher.publish({ a: true }, "testing")
    ).rejects.toThrowError("unable to publish message");
    expect(mockCreateChannel).toHaveBeenCalledWith();
    expect(mockPrefetch).toHaveBeenCalledWith(20, true);
    expect(mockAssertExchange).toHaveBeenCalledWith(
      "events.topic.exchange",
      "topic",
      {
        autoDelete: false,
        durable: true,
        internal: false,
      }
    );
    expect(mockPublish).toHaveBeenCalledWith(
      "events.topic.exchange",
      "testing",
      Buffer.from('{"a":true}'),
      {
        contentType: "application/json",
        headers: {},
      }
    );
  });

  it("should resolve if publish succeeds ", async () => {
    const publisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockPublish = jest.fn(() => true);
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      publish: mockPublish,
    }));

    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });
    await connection.start(eventStreamPublisher(publisher));
    await expect(
      publisher.publish({ a: true }, "testing")
    ).resolves.toBeUndefined();
  });
});

describe("Connection", () => {
  it("should reject with error if already started", async () => {
    const connection = new Connection("dummy", "amqp-url");
    connection.started = true;
    await expect(connection.start()).rejects.toThrowError("already started");
  });

  it("should reject with error if connect fails", async () => {
    (amqp.connect as jest.Mock).mockRejectedValue(new Error("connect error"));
    const connection = new Connection("dummy", "amqp-url");
    await expect(connection.start()).rejects.toThrowError("connect error");
  });

  it("should reject with error if create channel fails", async () => {
    const mockCreateChannel = jest.fn(() =>
      Promise.reject(new Error("create channel error"))
    );
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const connection = new Connection("dummy", "amqp-url");
    await expect(connection.start()).rejects.toThrowError(
      "create channel error"
    );
  });

  it("should reject with error if setting prefetch fails", async () => {
    const mockPrefetch = jest.fn(() =>
      Promise.reject(new Error("prefetch error"))
    );
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const connection = new Connection("dummy", "amqp-url");
    await expect(connection.start()).rejects.toThrowError("prefetch error");
  });

  it("should reject with error if any setup fails", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() =>
      Promise.reject(new Error("setup error"))
    );
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const publisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");
    await expect(
      connection.start(eventStreamPublisher(publisher))
    ).rejects.toThrowError("setup error");
  });

  it("should resolve on setup success", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() => Promise.resolve());
    const mockBindQueue = jest.fn(() => Promise.resolve());
    const mockConsume = jest.fn(() => Promise.resolve());
    const mockOn = jest.fn(() => Promise.resolve());
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
      bindQueue: mockBindQueue,
      consume: mockConsume,
      on: mockOn,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const publisher = new Publisher();
    const svcPublisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");

    const logger = jest.fn();
    await expect(
      connection.start(
        useLogger({ info: logger, error: logger, debug: logger }),
        useMessageLogger(() => {}),
        closeListener(() => {}),
        withPrefetchLimit(100),
        eventStreamPublisher(publisher),
        servicePublisher("target", svcPublisher),
        serviceResponseListener("target", "some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledWith(
      "Successfully connected to dummy test-cluster 0.0.1"
    );
    expect(logger).toHaveBeenCalledWith("nodeamqp started");
    expect(mockPrefetch).toHaveBeenCalledWith(100, true);
    expect(mockOn).toHaveBeenCalledWith("close", expect.any(Function));
    expect(mockAssertQueue).toHaveBeenCalledWith(
      "dummy.headers.exchange.response",
      {
        autoDelete: false,
        durable: true,
        exclusive: false,
        expires: 432000000,
      }
    );
    expect(mockBindQueue).toHaveBeenCalledWith(
      "dummy.headers.exchange.response",
      "target.headers.exchange.response",
      "some.key",
      { service: "dummy" }
    );
  });

  it("should reject with error if any setup queue fails", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() =>
      Promise.reject(new Error("setup queue error"))
    );
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const connection = new Connection("dummy", "amqp-url");
    await expect(
      connection.start(
        eventStreamListener("some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).rejects.toThrowError("setup queue error");
    expect(mockAssertQueue).toHaveBeenCalledWith(
      "events.topic.exchange.queue.dummy",
      {
        autoDelete: false,
        durable: true,
        exclusive: false,
        expires: 432000000,
      }
    );
  });

  it("should reject with error if any setup transient queue fails", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() =>
      Promise.reject(new Error("setup queue error"))
    );
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const connection = new Connection("dummy", "amqp-url");
    await expect(
      connection.start(
        transientEventStreamListener("some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).rejects.toThrowError("setup queue error");
    expect(mockAssertQueue).toHaveBeenCalledWith(
      "events.topic.exchange.queue.dummy-00000000-0000-0000-0000-000000000000",
      {
        autoDelete: true,
        durable: false,
        exclusive: false,
        expires: 432000000,
      }
    );
  });

  it("should reject with error if trying to add two listeners with the same routing key", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() => Promise.resolve());
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const connection = new Connection("dummy", "amqp-url");
    await expect(
      connection.start(
        eventStreamListener("some.key", () =>
          Promise.reject(new Error("handler error"))
        ),
        eventStreamListener("some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).rejects.toThrowError(
      "routingkey some.key for queue events.topic.exchange.queue.dummy already assigned to handler, can't reassign"
    );
  });

  it("should reject with error if trying to add two transient listeners with the same routing key", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() => Promise.resolve());
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const connection = new Connection("dummy", "amqp-url");
    await expect(
      connection.start(
        transientEventStreamListener("some.key", () =>
          Promise.reject(new Error("handler error"))
        ),
        transientEventStreamListener("some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).rejects.toThrowError(
      "routingkey some.key for queue events.topic.exchange.queue.dummy-00000000-0000-0000-0000-000000000000 already assigned to handler, can't reassign"
    );
  });

  it("should do nothing if msg is null", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() => Promise.resolve());
    const mockBindQueue = jest.fn(() => Promise.resolve());
    const mockConsume = jest.fn(() => Promise.resolve());
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
      bindQueue: mockBindQueue,
      consume: mockConsume,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const svcPublisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");

    const logger = jest.fn();
    const msgLogger = jest.fn();
    await expect(
      connection.start(
        useLogger({ info: logger, error: logger, debug: logger }),
        useMessageLogger(msgLogger),
        servicePublisher("target", svcPublisher),
        serviceResponseListener("target", "some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).resolves.toBeUndefined();

    connection.handleMsg({})(null);
  });

  it("should reject message if no handler is found for routing key", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() => Promise.resolve());
    const mockBindQueue = jest.fn(() => Promise.resolve());
    const mockConsume = jest.fn(() => Promise.resolve());
    const mockReject = jest.fn();
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
      bindQueue: mockBindQueue,
      consume: mockConsume,
      reject: mockReject,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const svcPublisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");

    const logger = jest.fn();
    const msgLogger = jest.fn();
    await expect(
      connection.start(
        useLogger({ info: logger, error: logger, debug: logger }),
        useMessageLogger(msgLogger),
        servicePublisher("target", svcPublisher),
        serviceResponseListener("target", "some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).resolves.toBeUndefined();

    const msg: ConsumeMessage = {
      content: Buffer.from('{"a":"b"}'),
      fields: {
        consumerTag: "",
        exchange: "dummy",
        routingKey: "some.key",
        deliveryTag: 1,
        redelivered: false,
      },
      properties: {
        headers: {},
        contentType: "application/json",
        contentEncoding: "utf-8",
        appId: "",
        clusterId: "",
        correlationId: "",
        deliveryMode: "",
        expiration: "",
        type: "",
        messageId: "",
        replyTo: "",
        priority: "",
        userId: "",
        timestamp: "",
      },
    };
    connection.handleMsg({})(msg);
    expect(mockReject).toHaveBeenCalledWith(msg, false);
    expect(logger).toHaveBeenCalledWith(
      "no handler found for routingkey: 'some.key', rejecting message with requeue=false"
    );
    expect(msgLogger).toHaveBeenCalledWith(msg.content, "some.key", false);
  });

  it("should nack message on handler error", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() => Promise.resolve());
    const mockBindQueue = jest.fn(() => Promise.resolve());
    const mockConsume = jest.fn(() => Promise.resolve());
    const mockNack = jest.fn();
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
      bindQueue: mockBindQueue,
      consume: mockConsume,
      nack: mockNack,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const svcPublisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");

    const logger = jest.fn();
    const msgLogger = jest.fn();
    await expect(
      connection.start(
        useLogger({ info: logger, error: logger, debug: logger }),
        useMessageLogger(msgLogger),
        servicePublisher("target", svcPublisher),
        serviceResponseListener("target", "some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).resolves.toBeUndefined();

    const msg: ConsumeMessage = {
      content: Buffer.from('{"a":"b"}'),
      fields: {
        consumerTag: "",
        exchange: "dummy",
        routingKey: "some.key",
        deliveryTag: 1,
        redelivered: false,
      },
      properties: {
        headers: {},
        contentType: "application/json",
        contentEncoding: "utf-8",
        appId: "",
        clusterId: "",
        correlationId: "",
        deliveryMode: "",
        expiration: "",
        type: "",
        messageId: "",
        replyTo: "",
        priority: "",
        userId: "",
        timestamp: "",
      },
    };
    await connection.handleMsg({
      "some.key": {
        handler: () => Promise.reject(new Error("handler error")),
        queueRoutingKey: "test<->some.key",
      },
    })(msg);
    expect(mockNack).toHaveBeenCalledWith(msg, false, true);
  });

  it("should ack message on handler success", async () => {
    const mockPrefetch = jest.fn();
    const mockAssertExchange = jest.fn(() => Promise.resolve({}));
    const mockAssertQueue = jest.fn(() => Promise.resolve());
    const mockBindQueue = jest.fn(() => Promise.resolve());
    const mockConsume = jest.fn(() => Promise.resolve());
    const mockAck = jest.fn();
    const mockCreateChannel = jest.fn(() => ({
      prefetch: mockPrefetch,
      assertExchange: mockAssertExchange,
      assertQueue: mockAssertQueue,
      bindQueue: mockBindQueue,
      consume: mockConsume,
      ack: mockAck,
    }));
    (amqp.connect as jest.Mock).mockResolvedValue({
      connection: {
        serverProperties: {
          product: "dummy",
          cluster_name: "test-cluster",
          version: "0.0.1",
        },
      },
      createChannel: mockCreateChannel,
    });

    const svcPublisher = new Publisher();
    const connection = new Connection("dummy", "amqp-url");

    const logger = jest.fn();
    const msgLogger = jest.fn();
    await expect(
      connection.start(
        useLogger({ info: logger, error: logger, debug: logger }),
        useMessageLogger(msgLogger),
        servicePublisher("target", svcPublisher),
        serviceResponseListener("target", "some.key", () =>
          Promise.reject(new Error("handler error"))
        )
      )
    ).resolves.toBeUndefined();

    const msg: ConsumeMessage = {
      content: Buffer.from('{"a":"b"}'),
      fields: {
        consumerTag: "",
        exchange: "dummy",
        routingKey: "some.key",
        deliveryTag: 1,
        redelivered: false,
      },
      properties: {
        headers: {},
        contentType: "application/json",
        contentEncoding: "utf-8",
        appId: "",
        clusterId: "",
        correlationId: "",
        deliveryMode: "",
        expiration: "",
        type: "",
        messageId: "",
        replyTo: "",
        priority: "",
        userId: "",
        timestamp: "",
      },
    };
    await connection.handleMsg({
      "some.key": {
        handler: (msg) => {
          expect(msg).toEqual({ a: "b" });
          return Promise.resolve();
        },
        queueRoutingKey: "test<->some.key",
      },
    })(msg);
    expect(mockAck).toHaveBeenCalledWith(msg, false);
  });
});
