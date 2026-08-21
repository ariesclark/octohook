export type SerializedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
  /** When the event happened, which the Discord request itself no longer knows. */
  occurredAt?: number;
};

export async function toSerializedRequest(
  request: Request,
  occurredAt?: number,
): Promise<SerializedRequest> {
  return {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: new Uint8Array(await request.arrayBuffer()),
    occurredAt,
  };
}

export function fromSerializedRequest({ url, method, headers, body }: SerializedRequest): Request {
  // A queue that serialized the message as JSON rather than v8 hands the body back as a plain
  // object, and reading that as "no body" drops the payload: the empty request then fails far
  // from its cause, as a JSON parse error while merging.
  if (!(body instanceof Uint8Array))
    throw new TypeError(
      `Serialized request body must be a Uint8Array, got ${body === null ? "null" : typeof body}.`,
    );

  return new Request(url, {
    method,
    headers,
    body: body.byteLength > 0 ? body : null,
  });
}
