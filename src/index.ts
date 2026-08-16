import app from "./app";
import { queue, WebhookQueueMessage } from "./queue";

export default {
  ...app,
  queue,
} satisfies ExportedHandler<CloudflareBindings, WebhookQueueMessage>;
