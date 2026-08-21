/**
 * What `wrangler types` cannot know. A secret is set with `wrangler secret put` and appears in no
 * config file, so nothing generates a type for it.
 */
interface CloudflareBindings {
  /**
   * A check run says nothing about the workflow that ran it. Without this the boards still draw,
   * with no run names, numbers, triggers or annotations in them.
   */
  GITHUB_TOKEN?: string;
}
