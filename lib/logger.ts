interface Logger {
  info(msg: string): void;

  debug(msg: string): void;

  error(msg: string): void;
}

class NoOpLogger implements Logger {
  debug(): void {}

  error(): void {}

  info(): void {}
}

export { Logger, NoOpLogger };
