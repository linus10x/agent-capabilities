import { expectType } from "tsd";
import { approve, type IncludesMoney } from "../src/effects.js";
import { defineFlow, runFlow } from "../src/workflow.js";

const readOnly = defineFlow("read-memo", [
  {
    name: "load",
    effect: "read" as const,
    idempotencyKey: "load-memo",
    run: async () => "memo",
  },
]);

const moving = defineFlow("pay", [
  {
    name: "send",
    effect: "moves-money" as const,
    idempotencyKey: "send-funds",
    run: async () => "sent",
  },
]);

expectType<IncludesMoney<"read">>(false);
expectType<IncludesMoney<"read" | "moves-money">>(true);
expectType<Promise<unknown[]>>(runFlow(readOnly));

// @ts-expect-error a money-moving flow requires an approval argument
runFlow(moving);

expectType<Promise<unknown[]>>(runFlow(moving, approve("ada", "2026-10-17T13:00:00Z")));
