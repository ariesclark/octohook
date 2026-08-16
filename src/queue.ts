export type WebhookQueueMessage = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

export async function serializeRequest(request: Request): Promise<WebhookQueueMessage> {
  return {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: new Uint8Array(await request.arrayBuffer()),
  };
}

export function deserializeRequest({ url, method, headers, body }: WebhookQueueMessage): Request {
  return new Request(url, {
    method,
    headers,
    body: body.byteLength > 0 ? body : null,
  });
}

export async function queue({ messages }: MessageBatch<WebhookQueueMessage>) {
  for (const message of messages) {
    const response = await fetch(deserializeRequest(message.body));

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      message.retry(retryAfter > 0 ? { delaySeconds: Math.ceil(retryAfter) } : undefined);
    }
  }
}
