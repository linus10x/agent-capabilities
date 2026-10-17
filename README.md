# agent-capabilities

Typed capability proofs for a multi-step agent flow. A flow whose steps include `moves-money` does not typecheck unless the caller passes a human approval. Replay reads an append-only journal and does not run the step again. Each step emits an OpenTelemetry span.

This is a hands-on library. It is not a client runtime and it does not call a model.

## Problem

Tool-calling kits already infer input types from Zod, and durable retry is a runtime feature in Temporal, Inngest, Effect, and the Vercel AI SDK. The type system is doing almost no work there. The harder problem for a CIO or a banking platform is that a step which moves money should be uncallable unless the caller holds a proof that a person approved it.

Research notes from 2026-10-17: Grok said to replace a Zod tool wrapper with compile-time capability proofs, and cited https://github.com/TanStack/workflow. Claude said to keep the idea only if a money-moving step requires an explicit human approval and replay stays deterministic.

## Design

- Effects are `read`, `write`, `moves-money`, and `read-pii`.
- `defineFlow` collects the effect union of the steps.
- `runFlow(flow)` is legal only when that union does not include `moves-money`. `runFlow(flow, approval)` is the legal call when it does. The split is an overload, so the missing approval is a type error, and it is also a throw if a cast gets through.
- `approve(by, at)` mints the approval. A plain object is not an approval.
- A step idempotency key is written to the journal after success. A second `runFlow` with the same journal returns the stored output.
- `RetryableError` retries up to 3 attempts. Anything else throws on the first failure.
- Spans use `@opentelemetry/api`. With no SDK registered, the API no-op tracer is the default. Tests inject a recorder.

## Usage

```ts
import { approve, defineFlow, runFlow } from "agent-capabilities";

const readMemo = defineFlow("read-memo", [
  {
    name: "load-memo",
    effect: "read",
    idempotencyKey: "load-memo",
    run: async () => "memo",
  },
]);
await runFlow(readMemo);

const pay = defineFlow("pay", [
  {
    name: "send",
    effect: "moves-money",
    idempotencyKey: "send-funds",
    run: async () => "sent",
  },
]);
await runFlow(pay, approve("ada", "2026-10-17T13:00:00Z"));
```

## Build

```bash
npm ci
npm test
npm run build
npm run test:types
```

## Benchmark

On this machine (Node v25.9.0, 2026-10-17), `npm run bench` ran 5,000 read flows and 5,000 approved money flows in 5.6 ms. That is one local run. The steps return a constant. There is no network and no model call.

## Limits

The effect set is four tags. There is no Zod schema, no model client, and no distributed journal. The journal is in memory. Approval is a branded object, not a signature over a real identity provider. OpenTelemetry attributes are `tool.name`, `effect`, `attempt`, and `replay`.
