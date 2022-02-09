import { v4 } from "uuid";

const exchangeName = (svcName: string, kind: string): string =>
  `${svcName}.${kind}.exchange`;

const eventsExchangeName: string = exchangeName("events", "topic");

const serviceEventQueueName = (service: string): string =>
  `${eventsExchangeName}.queue.${service}`;

const randomString = () => v4().toString();

const serviceEventRandomQueueName = (service: string): string =>
  `${eventsExchangeName}.queue.${service}-${randomString()}`;

const serviceRequestExchangeName = (service: string): string =>
  `${service}.direct.exchange.request`;

const serviceResponseExchangeName = (service: string): string =>
  `${service}.headers.exchange.response`;

const serviceRequestQueueName = (service: string): string =>
  `${serviceRequestExchangeName(service)}.queue`;

export {
  exchangeName,
  eventsExchangeName,
  serviceEventQueueName,
  serviceEventRandomQueueName,
  serviceRequestExchangeName,
  serviceResponseExchangeName,
  serviceRequestQueueName,
};
