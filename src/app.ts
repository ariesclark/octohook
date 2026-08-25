import { env } from "cloudflare:workers";
import { Hono } from "hono";

import { getWebhookRequest } from "./discord";
import type { Batch } from "./channel.ts";
import { factsOf, foldablePayload, shaOf, type Folded } from "./foldable.ts";
import { occurredAt } from "./occurred";
import { optionsMiddleware, unreadable } from "./options";
import { localReferenceFor } from "./resolve.ts";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", ({ redirect }) => redirect("https://github.com/ariesclark/octohook"));

async function contentOf(request: Request): Promise<unknown> {
  return request.headers.get("content-type")?.startsWith("application/json")
    ? await request.json()
    : JSON.parse(String((await request.formData()).get("payload_json")));
}

/** GitHub does not send an event twice once it has a 2xx, so this is awaited before answering. */
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
  const query = get("query");

  const token = req.query("token");
  if (!token)
    return json(
      { message: "No GitHub token on this hook's url. Add ?token=… to it." },
      { status: 400 },
    );

  const [name = ""] = event.type.split(".");
  const payload = event as unknown as Record<string, unknown>;
  const at = occurredAt(event);

  const delivery: Folded = {
    event: name,
    action: "action" in event ? String(event.action) : null,
    delivered_at: new Date(at ?? Date.now()).toISOString(),
    received_at: new Date().toISOString(),
    facts: factsOf(payload),
    payload: foldablePayload(name, payload),
  };

  const request = localReferenceFor(delivery) ? null : await getWebhookRequest(secret, event, hook);
  if (request) delivery.content = await contentOf(request);

  if (!request && !shaOf(name, payload)) return json({ message: "Event dropped." });

  try {
    const outcome = await fold(secret.split("/")[0]!, {
      secret,
      hook,
      token,
      query,
      deliveries: [delivery],
    });

    const refused = unreadable(query);

    return json(
      {
        message: "Event accepted.",
        ...outcome,
        ...(refused.length > 0 ? { refused } : {}),
      },
      { status: 202 },
    );
  } catch (error) {
    return json(
      { message: "The channel would not take it.", reason: String(error) },
      { status: 503 },
    );
  }
});

export default app;
