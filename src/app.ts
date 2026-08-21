import { env, waitUntil } from "cloudflare:workers";
import { Hono } from "hono";

import { getWebhookRequest } from "./discord";
import type { Batch } from "./channel.ts";
import { foldablePayload, shaOf, type Folded } from "./foldable.ts";
import { occurredAt } from "./occurred";
import { optionsMiddleware } from "./options";
import { localReferenceFor } from "./resolve.ts";
import { excessScopes, neededScopes } from "./token.ts";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", ({ redirect }) => redirect("https://github.com/ariesclark/octohook"));

/** A message carrying an avatar is multipart, with the message itself under `payload_json`. */
async function contentOf(request: Request): Promise<unknown> {
  return request.headers.get("content-type")?.startsWith("application/json")
    ? await request.json()
    : JSON.parse(String((await request.formData()).get("payload_json")));
}

/**
 * GitHub does not send an event twice once it has a 2xx, so a delivery dropped here is gone. The
 * channel is one object and a call to it fails only transiently — long enough to be worth asking
 * again, not long enough to be worth a queue in front of it.
 */
async function fold(channel: string, batch: Batch) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await env.CHANNEL.getByName(channel).deliver(batch);
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

app.post("/:secret{.+}", optionsMiddleware, async ({ req, get, json }) => {
  const { secret } = req.param();

  const event = get("event");
  const hook = get("hook");

  // Refused here rather than further in, because this is the only answer GitHub shows anybody:
  // a red delivery on the hook's own page, saying which scopes to take off.
  const token = req.query("token");
  const excess = token ? await excessScopes(token) : [];

  if (excess.length > 0)
    return json(
      {
        message: "Token carries more than octohook asks of it.",
        remove: excess,
        keep: neededScopes,
      },
      { status: 400 },
    );

  const [name = ""] = event.type.split(".");
  const payload = event as unknown as Record<string, unknown>;
  const at = occurredAt(event);

  const delivery: Folded = {
    event: name,
    action: "action" in event ? String(event.action) : null,
    delivered_at: new Date(at ?? Date.now()).toISOString(),
    payload: foldablePayload(name, payload),
  };

  // A check whose own url already names its run is a row in a board and will never be a message
  // of its own, so it is not rendered. Anything else might be, and rendering costs no request.
  const request = localReferenceFor(delivery) ? null : await getWebhookRequest(secret, event, hook);
  if (request) delivery.content = await contentOf(request);

  // Nothing renders it and nothing will gather it: there is no message in this event.
  if (!request && !shaOf(name, payload)) return json({ message: "Event dropped." });

  // A hook carries its own token rather than the worker holding one for everybody, so two hooks
  // pointing here can read two different organisations.
  waitUntil(
    fold(secret.split("/")[0]!, {
      secret,
      hook,
      token,
      deliveries: [delivery],
    }),
  );

  return json({ message: "Event accepted." }, { status: 202 });
});

export default app;
