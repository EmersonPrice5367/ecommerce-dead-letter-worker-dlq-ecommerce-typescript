import { z } from "zod";
import { InfraiQueue } from "../src/infrai_queue.js";
import { handleMessage } from "../src/order_worker.js";

const key = z.string().min(1).parse(process.env.INFRAI_API_KEY);
const queue = new InfraiQueue(key);

const outcome = await handleMessage(
  queue,
  {
    message_id: "checkout-order-1042-attempt-3",
    payload: {
      kind: "checkout",
      orderId: "order-1042",
      attempt: 3,
      cartTotalCents: 12900
    }
  },
  async () => {
    throw new Error("payment authorization declined");
  }
);

console.log({ orderId: "order-1042", outcome });
