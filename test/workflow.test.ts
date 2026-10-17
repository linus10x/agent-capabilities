import { describe, expect, it } from "vitest";
import { approve } from "../src/effects.js";
import { Journal, RetryableError } from "../src/journal.js";
import { otelTracer, recordingTracer } from "../src/trace.js";
import { defineFlow, runFlow, type Step } from "../src/workflow.js";

const readStep: Step<"read", string> = {
  name: "load-memo",
  effect: "read",
  idempotencyKey: "load-memo",
  run: async () => "memo",
};

describe("flows", () => {
  it("runs a read-only flow without approval and records a span", async () => {
    const tracer = recordingTracer();
    const flow = defineFlow("read-memo", [readStep]);
    const outputs = await runFlow(flow, { tracer });
    expect(outputs).toEqual(["memo"]);
    expect(tracer.spans[0]).toMatchObject({
      name: "load-memo",
      attributes: { "tool.name": "load-memo", effect: "read", attempt: 1, replay: 0 },
    });
  });

  it("rejects a money-moving flow that has no approval, then accepts a real approval", async () => {
    let calls = 0;
    const flow = defineFlow("pay", [
      {
        name: "send",
        effect: "moves-money" as const,
        idempotencyKey: "send-funds",
        run: async () => {
          calls += 1;
          return "sent";
        },
      },
    ]);
    await expect(runFlow(flow)).rejects.toThrow(/human approval/);
    expect(calls).toBe(0);
    await expect(runFlow(flow, { journal: new Journal() })).rejects.toThrow(/human approval/);
    const done = await runFlow(flow, approve("ada", "2026-10-17T13:00:00Z"));
    expect(done).toEqual(["sent"]);
    expect(calls).toBe(1);
  });

  it("retries a retryable step and replays from the journal without calling it again", async () => {
    let calls = 0;
    const journal = new Journal();
    const tracer = recordingTracer();
    const flow = defineFlow("flaky", [
      {
        name: "post",
        effect: "write" as const,
        idempotencyKey: "post-once",
        run: async (attempt) => {
          calls += 1;
          if (attempt < 2) {
            throw new RetryableError("busy");
          }
          return attempt;
        },
      },
    ]);
    const first = await runFlow(flow, { journal, tracer });
    expect(first).toEqual([2]);
    expect(calls).toBe(2);
    const again = await runFlow(flow, { journal, tracer });
    expect(again).toEqual([2]);
    expect(calls).toBe(2);
    expect(journal.records()).toHaveLength(1);
    expect(tracer.spans.some((span) => span.attributes["replay"] === 1)).toBe(true);
  });

  it("stops after three retryable failures and records the error name", async () => {
    const tracer = recordingTracer();
    const flow = defineFlow("always-busy", [
      {
        name: "post",
        effect: "write" as const,
        idempotencyKey: "always-busy",
        run: async () => {
          throw new RetryableError("busy");
        },
      },
    ]);
    await expect(runFlow(flow, { tracer })).rejects.toThrow(/busy/);
    expect(tracer.spans).toHaveLength(3);
    expect(tracer.spans[2]?.attributes["error"]).toBe("RetryableError");
  });

  it("wraps a non-error throw and rejects a blank approval", async () => {
    const flow = defineFlow("bad-throw", [
      {
        name: "boom",
        effect: "read" as const,
        idempotencyKey: "bad-throw",
        run: async () => {
          throw "nope";
        },
      },
    ]);
    await expect(runFlow(flow, { tracer: recordingTracer() })).rejects.toBe("nope");
    expect(() => approve("  ", "2026-10-17T13:00:00Z")).toThrow(/approver/);
    expect(() => approve("ada", " ")).toThrow(/approval time/);
  });

  it("rejects an empty flow, a short key, and a duplicate key", () => {
    expect(() => defineFlow(" ", [readStep])).toThrow(/flow name/);
    expect(() => defineFlow("empty", [])).toThrow(/at least one step/);
    expect(() =>
      defineFlow("short", [{ ...readStep, idempotencyKey: "short" }]),
    ).toThrow(/at least 8/);
    expect(() => defineFlow("dup", [readStep, { ...readStep, name: "other" }])).toThrow(/duplicate/);
  });

  it("records an exception through the OpenTelemetry tracer", () => {
    const span = otelTracer().start("boom", {
      "tool.name": "boom",
      effect: "read",
      attempt: 1,
      replay: 0,
    });
    span.fail(new Error("boom"));
  });

  it("does not append twice when the journal already has the key", () => {
    const journal = new Journal();
    journal.append("load-memo", "cached");
    journal.append("load-memo", "other");
    expect(journal.get("load-memo")).toBe("cached");
    expect(journal.has("missing")).toBe(false);
  });
});
