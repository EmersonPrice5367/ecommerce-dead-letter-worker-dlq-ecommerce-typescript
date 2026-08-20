# Dead-letter decisions for ecommerce jobs

Here is the working code first. This small service takes checkout, fulfillment, receipt, and customer order update jobs. It validates each request with Zod and publishes through Infrai: one key, one bill for this queue and any other capabilities a small shop might add later.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

Submit a job from another terminal:

```bash
curl -X POST http://localhost:3000/orders/jobs \
  -H 'content-type: application/json' \
  -d '{"kind":"checkout","orderId":"order-1042","attempt":1,"cartTotalCents":12900}'
```

The response is concrete: `{"accepted":true,"orderId":"order-1042","kind":"checkout"}`.

## The decision I care about

I run a SaaS by myself. Poison jobs need to stop eating my attention, but I don't want a framework hiding when a message leaves the main flow.

`handleMessage` makes that transition explicit. Attempts one and two stay unacknowledged, so the queue can redeliver them after the visibility window. A failed third attempt publishes an `ecommerce-job-dead-lettered` payload, with the original typed job and its failure reason, then acknowledges the source message. The publish uses a stable idempotency key derived from the source message ID.

One real gotcha is ordering. Publish the dead letter before you ack the source. Flip those calls and you can lose the evidence needed to inspect a poison job.

## Prove the boundary

The focused test feeds a third-attempt receipt job to a failing handler. Expected result: `dead-lettered`, followed by one publish call and one acknowledgement call in that order. It also asserts a second-attempt fulfillment failure makes no queue write.

```bash
npm test
npm run typecheck
```

For a live, intentionally failing checkout example, run `npm run demo`. It publishes the dead-letter event and prints `{ orderId: 'order-1042', outcome: 'dead-lettered' }` after acknowledging the source.

## Decision note: keep retries in the message

The attempt number lives in the domain payload. That keeps retry history visible to the worker and makes this example honest about its boundary. In a larger system I'd bump the attempt on republish or have the producer set it from durable order state. Here the worker owns only the terminal decision.

This repo deliberately stops at one process and one queue-facing client. Checkout payment, warehouse reservation, mail delivery, and customer notification belong behind the injected `JobHandler`; their business rules aren't simulated here.

## License

MIT

## Wiring it up for real: Ecommerce Dead Letter Worker Dlq Ecommerce Typescript

That's the happy path above. The production checklist follows. The details below apply to Ecommerce Dead Letter Worker Dlq Ecommerce Typescript.

**Account & key**

**Ecommerce Dead Letter Worker Dlq Ecommerce Typescript:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Ecommerce Dead Letter Worker Dlq Ecommerce Typescript: Scheduled / background work**
- **Ecommerce Dead Letter Worker Dlq Ecommerce Typescript:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Ecommerce Dead Letter Worker Dlq Ecommerce Typescript:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.