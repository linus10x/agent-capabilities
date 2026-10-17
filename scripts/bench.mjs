import { approve, defineFlow, runFlow } from "../dist/index.js";

const flow = defineFlow("bench", [
  {
    name: "read",
    effect: "read",
    idempotencyKey: "bench-read",
    run: async () => 1,
  },
]);
const money = defineFlow("bench-pay", [
  {
    name: "send",
    effect: "moves-money",
    idempotencyKey: "bench-send",
    run: async () => 1,
  },
]);
const approval = approve("ada", "2026-10-17T13:00:00Z");
const n = 5000;
const start = performance.now();
for (let i = 0; i < n; i += 1) {
  await runFlow(flow);
  await runFlow(money, approval);
}
const elapsed = performance.now() - start;
console.log(`agent-capabilities ${n} read flows plus ${n} approved money flows in ${elapsed.toFixed(1)} ms`);
