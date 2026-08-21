import { env } from "cloudflare:workers";

import { mergeRequestsWithSources } from "./merge";
import type { SerializedRequest } from "./serialize";
import { fromSerializedRequest, toSerializedRequest } from "./serialize";

export type { SerializedRequest } from "./serialize";

export async function queueRequest(request: Request, occurredAt?: number) {
  const serializedRequest = await toSerializedRequest(request, occurredAt);

  // The body is a Uint8Array, which only the structured clone survives; JSON turns it into a
  // plain object and the request arrives with no body at all.
  await env.WEBHOOK_QUEUE.send(serializedRequest, { contentType: "v8" });
}

/** Events further apart than this describe separate moments, so they never share a message. */
const mergeWindow = 60_000;

export async function queue({ messages }: MessageBatch<SerializedRequest>) {
  // A batch arrives in whatever order the queue drained it, and delivery can lag the event by
  // hours. Ordering by when things actually happened is what a reader is owed; the queue's own
  // clock only breaks ties and covers events that carry no time of their own.
  const order = messages
    .map((message, source) => ({
      source,
      at: message.body.occurredAt ?? message.timestamp.getTime(),
      queued: message.timestamp.getTime(),
    }))
    .sort((left, right) => left.at - right.at || left.queued - right.queued);

  const merged = await mergeRequestsWithSources(
    order.map(({ source }) => fromSerializedRequest(messages[source]!.body)),
    {
      timestamps: order.map(({ at }) => at),
      window: mergeWindow,
    },
  );

  for (const { request, sources: positions } of merged) {
    // Sources index the sorted batch; retries need the message they came from.
    const sources = positions.map((position) => order[position]!.source);
    const response = await fetch(request);
    if (response.status !== 429 && response.status < 500) continue;

    const retryAfter = Number(response.headers.get("retry-after"));
    const options = retryAfter > 0 ? { delaySeconds: Math.ceil(retryAfter) } : undefined;

    for (const source of sources) messages[source].retry(options);
  }
}
