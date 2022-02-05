import * as Buffer from "buffer";

type MessageLogger = (
  content: Buffer,
  routingKey: string,
  outgoing: boolean
) => void;

const NoOpMessageLogger = (
  content: Buffer,
  routingKey: string,
  outgoing: boolean
) => {};

export { MessageLogger, NoOpMessageLogger };
