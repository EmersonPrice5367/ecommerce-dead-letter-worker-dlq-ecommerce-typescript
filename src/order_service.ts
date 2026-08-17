import { createServer } from "node:http";
import { z } from "zod";
import { InfraiError, InfraiQueue, infrai } from "./infrai_queue.js";
import { CommerceJobSchema, ORDER_QUEUE } from "./order_worker.js";

const PortSchema = z.coerce.number().int().min(1).max(65535);
const port = PortSchema.parse(process.env.PORT ?? 3000);
const apiKey = z.string().min(1).parse(process.env.INFRAI_API_KEY);
const queue = new InfraiQueue(apiKey);

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/orders/jobs") {
    send(response, 404, { error: "route not found" });
    return;
  }

  try {
    const job = CommerceJobSchema.parse(await readJson(request));
    await infrai.queue.publish(
      queue,
      { queue: ORDER_QUEUE, payload: job },
      `order:${job.orderId}:${job.kind}:${job.attempt}`
    );
    send(response, 202, { accepted: true, orderId: job.orderId, kind: job.kind });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "invalid job", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      send(response, error.status, { error: error.code });
      return;
    }
    send(response, 500, { error: "job submission failed" });
  }
}).listen(port, () => console.log(`Order job service listening on http://localhost:${port}`));
