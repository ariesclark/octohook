import type { RESTPostAPIWebhookWithTokenJSONBody } from "discord-api-types/rest";

export type WebhookFile = {
  name: string;
  data: Uint8Array;
};

export type WebhookContent = RESTPostAPIWebhookWithTokenJSONBody & {
  files?: WebhookFile[];
};
