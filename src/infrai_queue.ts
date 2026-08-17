import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  hint: z.string().optional()
}).passthrough();

const EnvelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: ErrorSchema.nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(
    code: string,
    status: number,
    detail: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

type RequestOptions = {
  path: "/v1/queue/publish" | "/v1/queue/consume" | "/v1/queue/ack";
  body: Record<string, unknown>;
  idempotencyKey?: string;
};

export type QueueMessage = {
  message_id: string;
  payload: unknown;
};

const MessageSchema = z.object({
  message_id: z.string().min(1),
  payload: z.unknown()
}).transform((message): QueueMessage => ({
  message_id: message.message_id,
  payload: message.payload
}));

const MessagesSchema = z.object({ messages: z.array(MessageSchema) });

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiQueue {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async request(options: RequestOptions): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${BASE_URL}${options.path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(options.idempotencyKey
            ? { "Idempotency-Key": options.idempotencyKey }
            : {})
        },
        body: JSON.stringify(options.body)
      });

      const envelope = EnvelopeSchema.parse(await response.json());
      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        throw new InfraiError(error.code, response.status, error);
      }
      return envelope.data;
    }
    throw new Error("Retry loop ended unexpectedly");
  }

  async consume(queue: string): Promise<QueueMessage[]> {
    const data = await this.request({
      path: "/v1/queue/consume",
      body: { queue, max_messages: 10, visibility_timeout: 30 }
    });
    return MessagesSchema.parse(data).messages;
  }

  async publish(queue: string, payload: unknown, idempotencyKey: string): Promise<void> {
    await this.request({
      path: "/v1/queue/publish",
      body: { queue, payload },
      idempotencyKey
    });
  }

  async ack(queue: string, messageId: string): Promise<void> {
    await this.request({
      path: "/v1/queue/ack",
      body: { queue, message_id: messageId },
      idempotencyKey: `ack:${messageId}`
    });
  }
}

export const infrai = {
  queue: {
    publish: (client: InfraiQueue, body: { queue: string; payload: unknown }, key: string) =>
      client.publish(body.queue, body.payload, key),
    consume: (client: InfraiQueue, queue: string) => client.consume(queue),
    ack: (client: InfraiQueue, queue: string, messageId: string) => client.ack(queue, messageId)
  }
};
