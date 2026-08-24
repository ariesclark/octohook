import { compose, type Composed } from "./compose";
import {
  deliverAll,
  discordTransport,
  dryTransport,
  type Held,
  type Transport,
} from "./deliver.ts";
import { getWebhookRequest } from "./discord";
import { createGithub } from "./discord/events/check-run/run";
import { readDeliveries, toEvent } from "./replay";
import { fileTransport } from "./render.ts";
import { resolveFor } from "./resolve.ts";
import { apply, emptyWorld, type Delivery, type Repository } from "./state.ts";

const secret =
  process.env.DISCORD_WEBHOOK ??
  "1538482839069266001/RGCrOCc49q4mA68vZ-ZqsHJm3LI97IWHTeSmA7htXAUi17Q438Z2wOBPsZsMJYMUiIeK";

if (import.meta.main) {
  const [path, pace = "200"] = process.argv.slice(2);
  if (!path) throw new Error("usage: bun src/live.ts <deliveries.jsonl> [milliseconds] [--file p]");

  const filePath = process.argv[process.argv.indexOf("--file") + 1];
  const toFile = process.argv.includes("--file") && filePath ? filePath : undefined;

  const transport: Transport = toFile
    ? fileTransport(toFile, `Octohook replay · ${toFile}`)
    : process.argv.includes("--dry")
      ? dryTransport()
      : discordTransport(secret);

  const github = createGithub(process.env.GITHUB_TOKEN);

  const world = emptyWorld();
  const held = new Map<string, Held>();

  let repository: Repository = { name: "", html_url: "" };

  for (const [index, delivery] of readDeliveries(path).entries()) {
    const now = delivery.delivered_at.slice(11, 19);
    repository = (delivery.payload as { repository?: Repository }).repository ?? repository;

    const resolved = await resolveFor(delivery as Delivery, github, async () => {
      const request = await getWebhookRequest(secret, toEvent(delivery), "organization");
      if (!request) return undefined;

      return request.headers.get("content-type")?.startsWith("application/json")
        ? await request.json()
        : JSON.parse(String((await request.formData()).get("payload_json")));
    });

    const changed = apply(world, delivery as Delivery, resolved);

    const composed: Composed[] = compose(world, repository, "organization");
    const { redrawn, removed } = await deliverAll(composed, transport, held, () => {}, now);

    console.log(
      `${index} ${delivery.event}${delivery.action ? `.${delivery.action}` : ""} · ` +
        `${changed || "no change"} · redrew ${redrawn} of ${composed.length}` +
        `${removed > 0 ? `, took down ${removed}` : ""}`,
    );

    await new Promise((resolve) => setTimeout(resolve, Number(pace)));
  }
}
