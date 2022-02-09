jest.mock("uuid", () => ({ v4: () => "00000000-0000-0000-0000-000000000000" }));
import {
  eventsExchangeName,
  exchangeName,
  serviceEventQueueName,
  serviceEventRandomQueueName,
  serviceRequestExchangeName,
  serviceRequestQueueName,
  serviceResponseExchangeName,
} from "./naming";

jest.mock("uuid");

describe("naming", () => {
  it("exchangeName", () => {
    expect(exchangeName("test", "direct")).toBe("test.direct.exchange");
  });

  it("eventsExchangeName", () => {
    expect(eventsExchangeName).toBe("events.topic.exchange");
  });

  it("serviceEventQueueName", () => {
    expect(serviceEventQueueName("test")).toBe(
      "events.topic.exchange.queue.test"
    );
  });

  it("serviceEventRandomQueueName", () => {
    expect(serviceEventRandomQueueName("test")).toBe(
      "events.topic.exchange.queue.test-00000000-0000-0000-0000-000000000000"
    );
  });

  it("serviceRequestExchangeName", () => {
    expect(serviceRequestExchangeName("test")).toBe(
      "test.direct.exchange.request"
    );
  });

  it("serviceResponseExchangeName", () => {
    expect(serviceResponseExchangeName("test")).toBe(
      "test.headers.exchange.response"
    );
  });

  it("serviceRequestQueueName", () => {
    expect(serviceRequestQueueName("test")).toBe(
      "test.direct.exchange.request.queue"
    );
  });
});
