import assert from "node:assert/strict";
import test from "node:test";
import { InfraiQueue } from "../src/infrai_queue.js";
import { handleMessage } from "../src/order_worker.js";

test("third receipt failure is published as a dead letter before the source is acknowledged", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown>; key: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      path: new URL(String(input)).pathname,
      body: JSON.parse(String(init?.body)),
      key: new Headers(init?.headers).get("Idempotency-Key")
    });
    return new Response(JSON.stringify({ ok: true, data: {}, error: null, metadata: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const queue = new InfraiQueue("test-key", fetcher);

  const outcome = await handleMessage(
    queue,
    {
      message_id: "msg-receipt-8",
      payload: {
        kind: "receipt",
        orderId: "order-8",
        attempt: 3,
        email: "buyer@example.com"
      }
    },
    async () => {
      throw new Error("mailbox rejected receipt");
    }
  );

  assert.equal(outcome, "dead-lettered");
  assert.deepEqual(calls.map((call) => call.path), [
    "/v1/queue/publish",
    "/v1/queue/ack"
  ]);
  assert.equal(calls[0]?.key, "dead-letter:msg-receipt-8");
  assert.equal(calls[0]?.body.queue, "ecommerce-jobs");
  assert.deepEqual(calls[1]?.body, {
    queue: "ecommerce-jobs",
    message_id: "msg-receipt-8"
  });
});

test("second fulfillment failure stays unacknowledged for another delivery", async () => {
  let called = false;
  const fetcher: typeof fetch = async () => {
    called = true;
    return new Response();
  };
  const queue = new InfraiQueue("test-key", fetcher);

  const outcome = await handleMessage(
    queue,
    {
      message_id: "msg-fulfillment-9",
      payload: { kind: "fulfillment", orderId: "order-9", attempt: 2, warehouse: "east" }
    },
    async () => {
      throw new Error("stock reservation declined");
    }
  );

  assert.equal(outcome, "retrying");
  assert.equal(called, false);
});
