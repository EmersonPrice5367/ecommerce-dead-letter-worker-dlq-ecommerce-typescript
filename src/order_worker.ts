import { z } from "zod";
import { InfraiQueue, infrai, type QueueMessage } from "./infrai_queue.js";

export const CommerceJobSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("checkout"),
    orderId: z.string().min(1),
    attempt: z.number().int().min(1),
    cartTotalCents: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal("fulfillment"),
    orderId: z.string().min(1),
    attempt: z.number().int().min(1),
    warehouse: z.string().min(1)
  }),
  z.object({
    kind: z.literal("receipt"),
    orderId: z.string().min(1),
    attempt: z.number().int().min(1),
    email: z.string().email()
  }),
  z.object({
    kind: z.literal("customer-order-update"),
    orderId: z.string().min(1),
    attempt: z.number().int().min(1),
    status: z.enum(["paid", "packing", "shipped"])
  })
]);

export type CommerceJob = z.infer<typeof CommerceJobSchema>;
export type JobHandler = (job: CommerceJob) => Promise<void>;
export type JobOutcome = "completed" | "retrying" | "dead-lettered";

const MAX_ATTEMPTS = 3;
export const ORDER_QUEUE = "ecommerce-jobs";

export async function handleMessage(
  queue: InfraiQueue,
  message: QueueMessage,
  run: JobHandler
): Promise<JobOutcome> {
  const job = CommerceJobSchema.parse(message.payload);
  try {
    await run(job);
    await infrai.queue.ack(queue, ORDER_QUEUE, message.message_id);
    return "completed";
  } catch (cause) {
    if (job.attempt < MAX_ATTEMPTS) return "retrying";

    const reason = cause instanceof Error ? cause.message : "job rejected";
    await infrai.queue.publish(
      queue,
      { queue: ORDER_QUEUE, payload: {
          type: "ecommerce-job-dead-lettered",
          failedJob: job,
          sourceMessageId: message.message_id,
          reason
        }
      },
      `dead-letter:${message.message_id}`
    );
    await infrai.queue.ack(queue, ORDER_QUEUE, message.message_id);
    return "dead-lettered";
  }
}

export async function drainOrders(
  queue: InfraiQueue,
  run: JobHandler
): Promise<JobOutcome[]> {
  const messages = await infrai.queue.consume(queue, ORDER_QUEUE);
  return Promise.all(messages.map((message) => handleMessage(queue, message, run)));
}
