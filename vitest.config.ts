import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * The Durable Object tests, and only those. Everything pure runs under `node --test`, which is
 * faster and needs no runtime; what is left is the part that cannot be tested without one —
 * storage that survives hibernation, and an alarm that is the whole delivery mechanism.
 */

/**
 * `discord-api-types`' module build is a shim over its CommonJS one — `import mod from "./v10.js"`
 * and then `export const X = mod.X` for every name. That default import lands as `undefined` in
 * this pool, so every name it re-exports is undefined too, and the JSX runtime meets
 * `Object.entries(undefined)` before a single test runs. The CommonJS file imports correctly;
 * this points at it. Rewriting the pool's own resolve conditions instead breaks `photon`, which
 * asks for `workerd` and would be handed `node`.
 */
const commonBuild = {
  name: "discord-api-types-common-build",
  enforce: "pre" as const,
  resolveId(source: string) {
    if (source !== "discord-api-types/v10") return null;

    return fileURLToPath(new URL("node_modules/discord-api-types/v10.js", import.meta.url).href);
  },
};

export default defineConfig({
  plugins: [
    commonBuild,
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // A secret, so no config file declares it and the pool would otherwise leave it unset —
      // which is the tokenless path, where a run has no trigger and belongs to no push.
      miniflare: { bindings: { GITHUB_TOKEN: "test-token" } },
    }),
  ],
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "@ariesclark/discord-jsx",
      development: false,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
