import app from "./app";
import { queue, SerializedRequest } from "./queue";

export default {
  ...app,
  queue,
} satisfies ExportedHandler<CloudflareBindings, SerializedRequest>;
