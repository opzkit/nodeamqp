import { NoOpLogger } from "./logger";

describe("NoOpLogger", () => {
  it("should do nothing on debug", () => {
    new NoOpLogger().debug();
  });
  it("should do nothing on info", () => {
    new NoOpLogger().info();
  });
  it("should do nothing on error", () => {
    new NoOpLogger().error();
  });
});
