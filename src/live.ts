import { compose, type Composed } from "./compose";
import { getWebhookRequest } from "./discord";
import { runnerNoise } from "./discord/events/check-run/annotations.ts";
import {
  resolveAnnotations,
  resolveRun,
  runReferenceFrom,
  runReferenceFromSuite,
  setGithubToken,
  type Annotation,
  type RunReference,
} from "./discord/events/check-run/run";
import {
  characterCount,
  componentCount,
  maximumCharacters,
  splitComponents,
  type MessageComponent,
} from "./discord/limits.ts";
import { readDeliveries, toEvent } from "./replay";
import { fileTransport } from "./render.ts";
import { apply, emptyWorld, type Delivery } from "./state.ts";

/**
 * Fold, draw, send. An event only updates the world; the whole channel is drawn from that world
 * afterwards; delivery works out which of those messages actually changed and rewrites only
 * those. No event decides what a message looks like, and none has to know what came before it.
 *
 * A prototype against captured deliveries. Shipping it needs somewhere for the worker to keep
 * the world and the message ids drawn from it, which today it has nowhere to put.
 */

const secret =
  process.env.DISCORD_WEBHOOK ??
  "1538482839069266001/RGCrOCc49q4mA68vZ-ZqsHJm3LI97IWHTeSmA7htXAUi17Q438Z2wOBPsZsMJYMUiIeK";

type Content = { components?: unknown[]; [key: string]: unknown };

/** What `continued from [above](…)` costs: 114 characters measured, with room to spare. */
const continuation = 160;

type CheckRun = { id: number; status: string; output?: { annotations_count?: number } };

const dry = process.argv.includes("--dry");
const filePath = process.argv[process.argv.indexOf("--file") + 1];
const toFile = process.argv.includes("--file") && filePath ? filePath : undefined;
const file = toFile ? fileTransport(toFile, `octohook replay · ${toFile}`) : undefined;

let now = "";
let dryMessages = 0;

async function remove(messageId: string) {
  if (dry) return;

  await fetch(`https://discord.com/api/webhooks/${secret}/messages/${messageId}`, {
    method: "DELETE",
  });
}

async function send(content: Content, messageId?: string, _at = ""): Promise<string | undefined> {
  if (dry) return messageId ?? `dry-${++dryMessages}`;

  const base = `https://discord.com/api/webhooks/${secret}`;

  const url = messageId
    ? `${base}/messages/${messageId}?with_components=true`
    : `${base}?with_components=true&wait=true`;

  const response = await fetch(url, {
    method: messageId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(content),
  });

  if (response.status === 429) {
    const { retry_after: retryAfter } = (await response.json()) as { retry_after: number };
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.1) * 1000));

    return send(content, messageId);
  }

  if (!response.ok) {
    const components = (content.components ?? []) as MessageComponent[];
    console.log(
      `${response.status} ${await response.text()} ` +
        `[${componentCount(components)} components, ${characterCount(components)} characters]`,
    );

    return messageId;
  }

  const { id } = (await response.json()) as { id: string };
  return id;
}

let place: Promise<{ guild_id?: string; channel_id?: string }> | undefined;

/** Where this webhook posts, so a continuation can point back at what it continues. */
function whereItPosts() {
  place ??= fetch(`https://discord.com/api/webhooks/${secret}`)
    .then((response) => response.json() as Promise<{ guild_id?: string; channel_id?: string }>)
    .catch(() => ({}));

  return place;
}

/**
 * Where a composed message goes, and what that place can hold. Fitting under a ceiling is the
 * transport's business — Discord has one and cuts a long message into several; a file does not
 * and writes it whole.
 */
const transport = file ? file : { send, remove, split: splitComponents };

/** What each composed message holds: the messages it was given, and how it last drew. */
const sent = new Map<string, { ids: string[]; drawn: string }>();

/**
 * A composed message becomes as many Discord messages as its size demands, reusing the ids it
 * already holds. A webhook cannot reply — Discord accepts `message_reference` on execute and
 * silently drops it — so a continuation links back to the message it continues.
 */
async function deliver(key: string, content: Content): Promise<boolean> {
  const drawn = JSON.stringify(content);
  const held = sent.get(key);

  // Drawn from the world every time, most messages come back identical. Sending those again
  // spends a request to change nothing, against the same rate limit as a real edit.
  if (held?.drawn === drawn) return false;

  const components = (content.components ?? []) as MessageComponent[];

  // Every message after the first carries a line saying what it continues. Splitting to the very
  // limit leaves no room for it, so the message comes back rejected over the length of something
  // it was never measured with — once a split is needed at all, everything is cut to make room.
  const whole = transport.split(components);
  const parts =
    whole.length > 1 ? transport.split(components, maximumCharacters - continuation) : whole;

  const ids: string[] = [];

  for (const [index, components] of parts.entries()) {
    const continues = index > 0 ? ids[0] : undefined;
    const { guild_id: guild, channel_id: channel } = continues ? await whereItPosts() : {};

    const link =
      continues && guild && channel
        ? `https://discord.com/channels/${guild}/${channel}/${continues}`
        : undefined;

    const body = link
      ? {
          ...content,
          components: [{ type: 10, content: `-# continued from [above](${link})` }, ...components],
        }
      : { ...content, components };

    const id = await transport.send(body, held?.ids[index], now);
    if (id) ids.push(id);
  }

  for (const spare of (held?.ids ?? []).slice(parts.length)) await transport.remove(spare);

  sent.set(key, { ids, drawn });
  return true;
}

/**
 * Which run an event belongs to. A job names its run in a url; a suite has to be looked up; and
 * a check from an app with no workflow behind it falls back to its own suite as the thing to
 * gather under, so every check belongs somewhere.
 */
async function referenceFor(delivery: Delivery): Promise<RunReference | undefined> {
  const { payload, event } = delivery;

  const detailsUrl =
    event === "check_run"
      ? (payload.check_run as { details_url?: string })?.details_url
      : event === "deployment_status" || event === "deployment"
        ? ((payload.workflow_run as { html_url?: string })?.html_url ??
          (payload.deployment_status as { log_url?: string })?.log_url)
        : undefined;

  const direct = detailsUrl ? runReferenceFrom(detailsUrl) : undefined;
  if (direct) return direct;

  const repository = (payload.repository as { full_name?: string })?.full_name;
  const suite =
    (payload.check_run as { check_suite?: { id?: number } })?.check_suite?.id ??
    (payload.check_suite as { id?: number })?.id;

  if (!repository || !suite) return undefined;

  return (
    (await runReferenceFromSuite(repository, suite)) ?? { repository, runId: `suite-${suite}` }
  );
}

if (import.meta.main) {
  const [path, pace = "200"] = process.argv.slice(2);
  if (!path) throw new Error("usage: bun src/live.ts <deliveries.jsonl> [milliseconds] [--file p]");

  setGithubToken(process.env.GITHUB_TOKEN);

  const world = emptyWorld();
  let repository = { name: "", html_url: "" };

  for (const [index, delivery] of readDeliveries(path).entries()) {
    now = delivery.delivered_at.slice(11, 19);
    repository = (delivery.payload as { repository?: typeof repository }).repository ?? repository;

    const reference = await referenceFor(delivery as Delivery);

    // An event with nothing left to say is rendered once, here; everything else is folded into
    // the world and drawn from it below.
    let content: unknown;

    if (!reference) {
      const request = await getWebhookRequest(secret, toEvent(delivery), "organization");

      // A message carrying an avatar is multipart, with the message under `payload_json`.
      if (request)
        content = request.headers.get("content-type")?.startsWith("application/json")
          ? await request.json()
          : JSON.parse(String((await request.formData()).get("payload_json")));
    }

    // Only a check that has something to say is asked what it said, and only once it is done —
    // every lookup is a request, and a running check has no annotations yet.
    const check = (delivery.payload as { check_run?: CheckRun }).check_run;
    const says = (check?.output?.annotations_count ?? 0) > 0 && check?.status === "completed";

    const annotations: Annotation[] | undefined =
      says && reference && check
        ? (await resolveAnnotations(reference.repository, check.id)).filter(runnerNoise)
        : undefined;

    const changed = apply(world, delivery as Delivery, {
      runId: reference?.runId,
      run: reference ? await resolveRun(reference) : undefined,
      annotations,
      content,
    });

    const composed: Composed[] = compose(world, repository, "organization");
    let redrawn = 0;
    let removed = 0;

    for (const message of composed)
      if (await deliver(message.key, message.content as Content)) redrawn += 1;

    // A message the world no longer draws is taken down rather than left saying something that
    // is no longer true.
    for (const [key, held] of sent)
      if (!composed.some((message) => message.key === key)) {
        for (const id of held.ids) await transport.remove(id);
        sent.delete(key);
        removed += 1;
      }

    console.log(
      `${index} ${delivery.event}${delivery.action ? `.${delivery.action}` : ""} · ` +
        `${changed || "no change"} · redrew ${redrawn} of ${composed.length}` +
        `${removed > 0 ? `, took down ${removed}` : ""}`,
    );

    await new Promise((resolve) => setTimeout(resolve, Number(pace)));
  }
}
