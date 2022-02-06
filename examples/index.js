const {
  Connection,
  Publisher,
  eventStreamListener,
  closeListener,
  transientEventStreamListener,
  eventStreamPublisher,
} = require("@opzkit/nodeamqp");

const publisher = new Publisher();

const conn = new Connection("test", "amqp://user:password@localhost:5672/");
conn
  .start(
    closeListener((args) => {
      console.log("args", args);
      process.exit(1);
    }),
    eventStreamListener("dummy.value", (msg, headers) => {
      console.log("dummy message", msg, "headers", headers);
      return Promise.resolve();
    }),
    eventStreamListener("blutti.dutti", (msg, headers) => {
      console.log("blutti message", msg, "headers", headers);
      return Promise.resolve();
    }),
    transientEventStreamListener("blutti.dutti", (msg, headers) => {
      console.log("transient message", msg, "headers", headers);
      return Promise.resolve();
    }),
    eventStreamPublisher(publisher)
  )
  .then(async () => {
    await publisher.publish(
      {
        recipients: ["joakim@unbound.se"],
        subject: "Test",
        text: "Blutti",
      },
      "blutti.dutti"
    );
  })
  .catch((e) => console.error("error", e));
