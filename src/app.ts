import { waitUntil } from "cloudflare:workers";
import { Hono } from "hono";

import { queueRequest } from "./queue";
import { optionsMiddleware } from "./options";
import { getWebhookRequest } from "./discord";
import { occurredAt } from "./occurred";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", ({ redirect }) => redirect("https://github.com/ariesclark/octohook"));

app.post("/:secret{.+}", optionsMiddleware, async ({ req, get, json }) => {
  const { secret } = req.param();

  const event = get("event");
  const request = await getWebhookRequest(secret, event, get("hook"));
  if (!request) return json({ message: "Event dropped." });

  waitUntil(queueRequest(request, occurredAt(event)));

  return json({ message: "Event queued." }, { status: 202 });
});

export default app;
