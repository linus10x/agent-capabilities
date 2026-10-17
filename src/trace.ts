import { trace, type Tracer } from "@opentelemetry/api";

export type StepAttributes = Record<string, string | number>;

export type StepSpan = {
  end(): void;
  fail(error: Error): void;
};

export type StepTracer = {
  start(name: string, attributes: StepAttributes): StepSpan;
};

export function otelTracer(source: Tracer = trace.getTracer("agent-capabilities", "0.1.0")): StepTracer {
  return {
    start(name, attributes) {
      const span = source.startSpan(name, { attributes });
      return {
        end() {
          span.end();
        },
        fail(error: Error) {
          span.recordException(error);
          span.end();
        },
      };
    },
  };
}

export function recordingTracer(): StepTracer & { readonly spans: { name: string; attributes: StepAttributes }[] } {
  const spans: { name: string; attributes: StepAttributes }[] = [];
  return {
    spans,
    start(name, attributes) {
      const record = { name, attributes: { ...attributes } };
      spans.push(record);
      return {
        end() {
          return undefined;
        },
        fail(error: Error) {
          record.attributes["error"] = error.name;
        },
      };
    },
  };
}
