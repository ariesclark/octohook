import { getWebhookRequest } from "./discord";
import { GithubEvent } from "./github";
import { mergeRequests } from "./merge";

type Delivery = {
  id: string;
  event: string;
  action: string | null;
  delivered_at: string;
  payload: Record<string, unknown>;
};

type Component = {
  content?: string;
  components?: Component[];
  accessory?: Component;
};

export function readDeliveries(path: string): Delivery[] {
  const lines = require("node:fs").readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines.map((line: string) => JSON.parse(line) as Delivery);
}

export function toEvent({ event, action, payload }: Delivery): GithubEvent {
  return { ...payload, type: `${event}${action ? `.${action}` : ""}` } as GithubEvent;
}

function lines(components: Component[]): string[] {
  return components.flatMap((component) => [
    ...(component.content ? [component.content] : []),
    ...lines(component.components ?? []),
    ...lines(component.accessory ? [component.accessory] : []),
  ]);
}

const secret =
  process.env.DISCORD_WEBHOOK ??
  "1538482839069266001/RGCrOCc49q4mA68vZ-ZqsHJm3LI97IWHTeSmA7htXAUi17Q438Z2wOBPsZsMJYMUiIeK";

if (import.meta.main) {
  const [path, mode = "preview"] = process.argv.slice(2);
  if (!path) throw new Error("usage: bun src/replay.ts <deliveries.jsonl> [preview|post]");

  const requests: Request[] = [];
  for (const delivery of readDeliveries(path)) {
    const request = await getWebhookRequest(secret, toEvent(delivery), "organization");
    if (request) requests.push(request);
  }

  const merged = await mergeRequests(requests);
  console.log(`${requests.length} messages merged into ${merged.length}`);

  if (mode === "preview") {
    for (const request of merged) {
      const { components = [] } = (await request.json()) as { components?: Component[] };
      for (const line of lines(components)) console.log(line);
    }

    process.exit(0);
  }

  const heading = new Request(`https://discord.com/api/webhooks/${secret}?with_components=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "octohook",
      flags: 1 << 15,
      components: [{ type: 10, content: `# replay` }],
    }),
  });

  // A webhook cannot ask a channel what it holds, so `wait=true` is the only way to its ids.
  for (const request of [heading, ...merged]) {
    const url = new URL(request.url);
    url.searchParams.set("wait", "true");

    let response = await fetch(new Request(url, request.clone()));

    while (response.status === 429) {
      const { retry_after: retryAfter } = (await response.json()) as { retry_after: number };
      await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.1) * 1000));
      response = await fetch(new Request(url, request.clone()));
    }

    if (!response.ok) {
      console.log(`${response.status} ${await response.text()}`);
      continue;
    }

    const { id } = (await response.json()) as { id: string };
    console.log(id);
  }
}
