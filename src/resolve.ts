import { worthSaying } from "./discord/events/check-run/annotations.ts";
import {
  runReferenceFrom,
  type Github,
  type RunReference,
} from "./discord/events/check-run/run.ts";
import type { Delivery, Resolved } from "./state.ts";

type CheckRun = { id: number; status: string; output?: { annotations_count?: number } };

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

export type RenderNote = () => Promise<unknown>;

export async function resolveFor(
  delivery: Delivery,
  github: Github,
  renderNote: RenderNote,
): Promise<Resolved> {
  const reference = await referenceFor(delivery, github);
  if (!reference) return { content: await renderNote() };

  // A running check has no annotations yet.
  const check = (delivery.payload as { check_run?: CheckRun }).check_run;
  const says = (check?.output?.annotations_count ?? 0) > 0 && check?.status === "completed";

  return {
    runId: reference.runId,
    run: await github.resolveRun(reference),
    annotations:
      says && check
        ? worthSaying(await github.resolveAnnotations(reference.repository, check.id))
        : undefined,
  };
}
