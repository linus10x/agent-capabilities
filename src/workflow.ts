import { isApproval, type Approval, type Effect, type IncludesMoney } from "./effects.js";
import { Journal, RetryableError } from "./journal.js";
import { otelTracer, type StepTracer } from "./trace.js";

const MAX_ATTEMPTS = 3;

export type Step<E extends Effect, O> = {
  readonly name: string;
  readonly effect: E;
  readonly idempotencyKey: string;
  readonly run: (attempt: number) => Promise<O>;
};

export type AnyStep = Step<Effect, unknown>;

export type Flow<E extends Effect> = {
  readonly name: string;
  readonly steps: readonly AnyStep[];
  readonly effect?: E;
};

type EffectsIn<S extends readonly AnyStep[]> = S[number] extends Step<infer E, unknown> ? E : never;

export type FlowDeps = {
  readonly journal?: Journal;
  readonly tracer?: StepTracer;
};

export function defineFlow<const S extends readonly AnyStep[]>(name: string, steps: S): Flow<EffectsIn<S>> {
  if (name.trim().length === 0) {
    throw new Error("flow name is required");
  }
  if (steps.length === 0) {
    throw new Error("a flow needs at least one step");
  }
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.idempotencyKey.trim().length < 8) {
      throw new Error("step idempotency key must be at least 8 characters");
    }
    if (seen.has(step.idempotencyKey)) {
      throw new Error(`duplicate idempotency key ${step.idempotencyKey}`);
    }
    seen.add(step.idempotencyKey);
  }
  return { name, steps };
}

export function runFlow<E extends Effect>(
  flow: IncludesMoney<E> extends true ? never : Flow<E>,
  deps?: FlowDeps,
): Promise<unknown[]>;
export function runFlow<E extends Effect>(
  flow: Flow<E>,
  approval: Approval,
  deps?: FlowDeps,
): Promise<unknown[]>;
export async function runFlow<E extends Effect>(
  flow: Flow<E>,
  approvalOrDeps?: Approval | FlowDeps,
  maybeDeps?: FlowDeps,
): Promise<unknown[]> {
  const approval = isApproval(approvalOrDeps) ? approvalOrDeps : undefined;
  const deps: FlowDeps | undefined = isApproval(approvalOrDeps) ? maybeDeps : approvalOrDeps;
  const needsMoney = flow.steps.some((step) => step.effect === "moves-money");
  if (needsMoney && approval === undefined) {
    throw new Error("moves-money requires human approval");
  }
  const journal = deps?.journal ?? new Journal();
  const tracer = deps?.tracer ?? otelTracer();
  const outputs: unknown[] = [];
  for (const step of flow.steps) {
    outputs.push(await runStep(step, journal, tracer));
  }
  return outputs;
}

async function runStep(step: AnyStep, journal: Journal, tracer: StepTracer): Promise<unknown> {
  if (journal.has(step.idempotencyKey)) {
    const span = tracer.start(step.name, {
      "tool.name": step.name,
      effect: step.effect,
      attempt: 0,
      replay: 1,
    });
    span.end();
    return journal.get(step.idempotencyKey);
  }
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const span = tracer.start(step.name, {
      "tool.name": step.name,
      effect: step.effect,
      attempt,
      replay: 0,
    });
    try {
      const output = await step.run(attempt);
      journal.append(step.idempotencyKey, output);
      span.end();
      return output;
    } catch (error) {
      const asError = error instanceof Error ? error : new Error("step failed");
      span.fail(asError);
      lastError = asError;
      if (error instanceof RetryableError && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("step failed");
}
