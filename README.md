# nodeamqp

Nodeamqp provides an opinionated way of using [RabbitMQ](https://www.rabbitmq.com/) for event-driven architectures.

Getting Started
===============

Add the dependency

```shell
yarn add @opzkit/nodeamqp
```

## Usage

See the 'examples' subdirectory.

## Contributing

TODO

## References

* Official ampq [documentation](https://www.rabbitmq.com/tutorials/amqp-concepts.html)

## License

MIT - see [LICENSE](./LICENSE) for more details.

## Developing

TODO

## Tests

```bash
yarn run test
```

## Example message logger

An example message logger which dumps messages to console.

```typescript
const StdOutMessageLogger = (
  content: Buffer,
  routingKey: string,
  outgoing: boolean
) => {
  let out: string = content.toString("utf-8");
  try {
    out = JSON.stringify(JSON.parse(out), null, 2);
  } catch (e) {
    // Ignore errors since out is already set
  }
  if (outgoing) {
    console.log(
      `Sending using routingkey: '${routingKey}' with content:\n${out}\n`
    );
  } else {
    console.log(
      `Received from routingkey '${routingKey}' with content:\n${out}\n`
    );
  }
};
```
