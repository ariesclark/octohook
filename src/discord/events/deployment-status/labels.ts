import { tOf } from "../../messages.ts";

export function deploymentVerb(state: string): string {
  return tOf("deploy", state, state);
}

export function namesRef(state: string): boolean {
  return state !== "inactive";
}
