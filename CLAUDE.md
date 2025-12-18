# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is `@opzkit/nodeamqp`, an opinionated TypeScript library for building event-driven architectures with RabbitMQ. It provides abstractions for topic-based event streaming and direct service-to-service request/response patterns.

## Development Commands

```bash
yarn test           # Run Jest tests with coverage
yarn build          # Compile TypeScript to dist/
```

To run a specific test:
```bash
yarn test -- --testNamePattern="naming"
yarn test -- lib/naming.test.ts
```

## Architecture

The library exposes a `Connection` class and composable setup functions that configure messaging patterns:

### Core Components

- **Connection** (`lib/index.ts`): Main AMQP connection manager. Handles channel creation, message consumption, and handler routing.
- **Publisher** (`lib/index.ts`): Sends messages to exchanges with routing keys and headers.
- **Setup functions**: Composable functions passed to `Connection.start()` that configure exchanges, queues, and bindings.

### Messaging Patterns

1. **Event Stream (Topic Exchange)**
   - `eventStreamPublisher(publisher)` - Publish events to `events.topic.exchange`
   - `eventStreamListener(routingKey, handler)` - Subscribe to events with persistent queue
   - `transientEventStreamListener(routingKey, handler)` - Subscribe with auto-delete queue

2. **Service Request/Response (Direct + Headers Exchanges)**
   - `servicePublisher(targetService, publisher)` - Send requests to a service
   - `serviceRequestListener(routingKey, handler)` - Handle incoming requests
   - `serviceResponseListener(targetService, routingKey, handler)` - Handle responses
   - `requestResponseHandler(routingKey, handler)` - Combined request handler with automatic response routing

### Naming Conventions (`lib/naming.ts`)

Exchange and queue names follow a consistent pattern:
- Events exchange: `events.topic.exchange`
- Event queue: `events.topic.exchange.queue.{serviceName}`
- Request exchange: `{serviceName}.direct.exchange.request`
- Response exchange: `{serviceName}.headers.exchange.response`

### Utility Functions

- `useLogger(logger)` - Inject custom logger (must implement `Logger` interface)
- `useMessageLogger(logger)` - Log message content for debugging
- `withPrefetchLimit(limit)` - Set channel prefetch count
- `closeListener(listener)` - Handle channel close events
