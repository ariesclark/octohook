import { severity, type Annotation } from "./run.ts";

/** Past this an annotation is a paragraph, and the job's own page reads better. */
const longest = 110;

export type Counted = Annotation & { count: number };

/**
 * A tool that warns once per occurrence warns many times — nineteen lines from one rule, every
 * one of them against the same place. Those fold into a count. The same complaint at a different
 * line does not: it is a second place to go and look, and a count spanning the two would take
 * its line number and its link from whichever happened to arrive first.
 */
export function fold(annotations: Annotation[]): Counted[] {
  const folded = new Map<string, Counted>();

  for (const annotation of annotations) {
    const key = JSON.stringify([
      annotation.path,
      annotation.startLine,
      annotation.title,
      annotation.message,
    ]);
    const seen = folded.get(key);

    if (seen) seen.count += 1;
    else folded.set(key, { ...annotation, count: 1 });
  }

  return [...folded.values()];
}

/**
 * An annotation is a paragraph as often as a sentence — a lint rule that appends a "More info"
 * link, a deprecation that lists every action it covers. One line each keeps a list a list.
 */
export function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= longest) return collapsed;

  return `${collapsed.slice(0, longest - 1).trimEnd()}…`;
}

/**
 * A title is the tool's own summary of what it found — shorter than the message and written to
 * be read at a glance, where the message is often the same thing plus a "More info" link. Where
 * a tool writes no title, the message is all there is.
 */
export function annotationText({ title, message }: Annotation): string {
  return oneLine(title || message);
}

/**
 * The runner files workflow-level warnings against `.github`, which is a directory — there is no
 * line of code to open, so those read as plain text rather than a link that would 404.
 */
export function fileUrl(
  annotation: Annotation,
  repositoryUrl: string,
  sha: string,
): string | undefined {
  const named = annotation.path.includes("/") || annotation.path.lastIndexOf(".") > 0;
  if (!named) return undefined;

  return `${repositoryUrl}/blob/${sha}/${annotation.path}#L${annotation.startLine}`;
}

/** The runner restates the exit code the headline already gave; everything else is news. */
export function runnerNoise(annotation: Annotation): boolean {
  return !annotation.message.startsWith("Process completed with exit code");
}

/**
 * What a check said, with the runner's own exit code dropped — unless that is the whole of it.
 * A job whose tool wrote no annotations has nothing else to offer, and a failing row with no
 * reason under it tells a reader less than a restated exit code does.
 */
export function worthSaying(annotations: Annotation[]): Annotation[] {
  const news = annotations.filter(runnerNoise);

  return news.length > 0 ? news : annotations;
}

/**
 * What broke, before what merely complained. Only so many annotations fit under a job, so the
 * order decides which ones a reader ever sees — and a tool that reports errors and warnings
 * together reports them in whatever order it walked the file.
 */
export function bySeverity(left: Annotation, right: Annotation): number {
  return severity(right.level) - severity(left.level);
}
