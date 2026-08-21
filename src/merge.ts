import type { RESTPostAPIWebhookWithTokenJSONBody } from "discord-api-types/rest";

import {
  characterCount,
  componentCount,
  maximumCharacters,
  maximumComponents,
  type MessageComponent,
} from "./discord/limits.ts";

type WebhookMessage = RESTPostAPIWebhookWithTokenJSONBody & {
  components?: MessageComponent[];
  username?: string;
  avatar_url?: string;
};

type SourcedMessage = {
  message: WebhookMessage;
  source: number;
};

function chunkMessages(messages: SourcedMessage[]): SourcedMessage[][] {
  const chunks: SourcedMessage[][] = [];

  let current: SourcedMessage[] = [];
  let components = 0;
  let characters = 0;

  for (const entry of messages) {
    const messageComponents = componentCount(entry.message.components ?? []);
    const messageCharacters = characterCount(entry.message.components ?? []);

    if (
      current.length > 0 &&
      (components + messageComponents > maximumComponents ||
        characters + messageCharacters > maximumCharacters)
    ) {
      chunks.push(current);
      current = [];
      components = 0;
      characters = 0;
    }

    current.push(entry);
    components += messageComponents;
    characters += messageCharacters;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function isWebhookMessageRequest(request: Request): boolean {
  return (
    request.method === "POST" &&
    request.headers.get("content-type") === "application/json" &&
    new URL(request.url).searchParams.get("with_components") === "true"
  );
}

function toMergedRequest(url: string, messages: WebhookMessage[]): Request {
  const [first] = messages;

  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...first,
      components: messages.flatMap((message) => message.components ?? []),
    }),
  });
}

export type MergedRequest = {
  request: Request;
  sources: number[];
  at?: number;
};

/**
 * Messages to one webhook must keep their batch order, so a group only accepts a
 * message when it is still the newest entry for that webhook.
 */
function channelOf(url: string): string {
  const { origin, pathname } = new URL(url);
  return origin + pathname.replace(/\/github$/, "");
}

type Group = {
  url: string;
  key: string;
  messages: SourcedMessage[];
  at?: number;
};

export type MergeOptions = {
  /** Event times, parallel to `requests`; without them messages merge regardless of age. */
  timestamps?: number[];
  /** How far apart two events may be and still share a message. */
  window?: number;
};

export async function mergeRequestsWithSources(
  requests: Request[],
  { timestamps, window = Infinity }: MergeOptions = {},
): Promise<MergedRequest[]> {
  const output: Array<MergedRequest | Group> = [];
  const latest = new Map<string, MergedRequest | Group>();

  for (const [source, request] of requests.entries()) {
    const channel = channelOf(request.url);
    const at = timestamps?.[source];

    if (!isWebhookMessageRequest(request)) {
      const entry = { request, sources: [source], at };
      output.push(entry);
      latest.set(channel, entry);
      continue;
    }

    const message = await request.json<WebhookMessage>();
    const key = JSON.stringify([request.url, message.username, message.avatar_url]);

    const previous = latest.get(channel);
    const withinWindow =
      at === undefined || previous?.at === undefined || at - previous.at <= window;

    if (previous && "key" in previous && previous.key === key && withinWindow) {
      previous.messages.push({ message, source });
      previous.at = at ?? previous.at;
      continue;
    }

    const group: Group = { url: request.url, key, messages: [{ message, source }], at };
    output.push(group);
    latest.set(channel, group);
  }

  return output.flatMap((entry) => {
    if ("request" in entry) return entry;

    return chunkMessages(entry.messages).map((chunk) => ({
      request: toMergedRequest(
        entry.url,
        chunk.map(({ message }) => message),
      ),
      sources: chunk.map(({ source }) => source),
    }));
  });
}

export async function mergeRequests(
  requests: Request[],
  options?: MergeOptions,
): Promise<Request[]> {
  return (await mergeRequestsWithSources(requests, options)).map(({ request }) => request);
}
