import { runnerNoise } from "./discord/events/check-run/annotations.ts";
import {
  runReferenceFrom,
  type Github,
  type RunReference,
} from "./discord/events/check-run/run.ts";
import type { Delivery, Resolved } from "./state.ts";

/**
 * Everything an event needs looked up before it can be folded in. `apply` does no I/O — it is
 * pure so that it can be run synchronously, which is the whole reason a Durable Object can fold
 * a delivery without another one interleaving. Every request lives here instead, in front of it.
 */

type CheckRun = { id: number; status: string; output?: { annotations_count?: number } };

/**
 * Which run an event belongs to. A job names its run in a url; a suite has to be looked up; and
 * a check from an app with no workflow behind it falls back to its own suite as the thing to
 * gather under, so every check belongs somewhere.
 *
 * The url is the answer for every check Actions posts, and it can be read without asking anyone
 * — which is what lets the edge know, before it spends a render, that this event will be a row
 * in a board rather than a message of its own.
 */
export function localReferenceFor(delivery: Delivery): RunReference | undefined {
  const { payload, event } = delivery;

  const detailsUrl =
    event === "check_run"
      ? (payload.check_run as { details_url?: string })?.details_url
      : event === "deployment_status" || event === "deployment"
        ? ((payload.workflow_run as { html_url?: string })?.html_url ??
          (payload.deployment_status as { log_url?: string })?.log_url)
        : undefined;

  return detailsUrl ? runReferenceFrom(detailsUrl) : undefined;
}

export async function referenceFor(
  delivery: Delivery,
  github: Github,
): Promise<RunReference | undefined> {
  const direct = localReferenceFor(delivery);
  if (direct) return direct;

  const { payload } = delivery;

  const repository = (payload.repository as { full_name?: string })?.full_name;
  const suite =
    (payload.check_run as { check_suite?: { id?: number } })?.check_suite?.id ??
    (payload.check_suite as { id?: number })?.id;

  if (!repository || !suite) return undefined;

  return (
    (await github.runReferenceFromSuite(repository, suite)) ?? {
      repository,
      runId: `suite-${suite}`,
    }
  );
}

/**
 * An event that belongs to no run says one thing and is done, and is rendered as its own message
 * — which costs a render, so it is only asked for once nothing else has claimed the event.
 */
export type RenderNote = () => Promise<unknown>;

export async function resolveFor(
  delivery: Delivery,
  github: Github,
  renderNote: RenderNote,
): Promise<Resolved> {
  const reference = await referenceFor(delivery, github);
  if (!reference) return { content: await renderNote() };

  // Only a check that has something to say is asked what it said, and only once it is done —
  // every lookup is a request, and a running check has no annotations yet.
  const check = (delivery.payload as { check_run?: CheckRun }).check_run;
  const says = (check?.output?.annotations_count ?? 0) > 0 && check?.status === "completed";

  return {
    runId: reference.runId,
    run: await github.resolveRun(reference),
    annotations:
      says && check
        ? (await github.resolveAnnotations(reference.repository, check.id)).filter(runnerNoise)
        : undefined,
  };
}
