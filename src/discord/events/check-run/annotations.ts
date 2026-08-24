import { severity, type Annotation } from "./run.ts";

const longest = 110;

export type Counted = Annotation & { count: number };

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

export function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= longest) return collapsed;

  return `${collapsed.slice(0, longest - 1).trimEnd()}…`;
}

export function annotationText({ title, message }: Annotation): string {
  return oneLine(title || message);
}

/** The runner files workflow-level warnings against `.github`, which is a directory. */
export function fileUrl(
  annotation: Annotation,
  repositoryUrl: string,
  sha: string,
): string | undefined {
  const named = annotation.path.includes("/") || annotation.path.lastIndexOf(".") > 0;
  if (!named) return undefined;

  return `${repositoryUrl}/blob/${sha}/${annotation.path}#L${annotation.startLine}`;
}

export function runnerNoise(annotation: Annotation): boolean {
  return !annotation.message.startsWith("Process completed with exit code");
}

export function worthSaying(annotations: Annotation[]): Annotation[] {
  const news = annotations.filter(runnerNoise);

  return news.length > 0 ? news : annotations;
}

export function bySeverity(left: Annotation, right: Annotation): number {
  return severity(right.level) - severity(left.level);
}
