import { tOf } from "../../messages.ts";

/** A workflow reports itself as a path when it was never given a name of its own. */
export function workflowName(name: string): string {
  return name.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
}

export function triggerLabel(trigger: string): string {
  return tOf("trigger", trigger, trigger);
}

