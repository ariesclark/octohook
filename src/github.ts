import { operations } from "@octokit/openapi-webhooks-types";

type ReplaceAll<
  Value extends string,
  From extends string,
  To extends string,
> = Value extends `${infer Before}${From}${infer After}`
  ? `${Before}${To}${ReplaceAll<After, From, To>}`
  : Value;

export type GithubEventId = keyof operations;

export type GithubEventType<Id extends GithubEventId = GithubEventId> = Id extends unknown
  ? ReplaceAll<ReplaceAll<Id, "-", "_">, "/", ".">
  : never;

export type GithubEventPayload<Id extends GithubEventId = GithubEventId> =
  operations[Id]["requestBody"]["content"]["application/json"];

export type GithubEvent = {
  [Id in GithubEventId]: Omit<GithubEventPayload<Id>, "type"> & {
    type: GithubEventType<Id>;
  };
}[GithubEventId];
