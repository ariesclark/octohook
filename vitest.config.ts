import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * `discord-api-types`' module build is a shim whose default import lands as `undefined` in this
 * pool, so the CommonJS file is resolved instead. Rewriting the pool's own resolve conditions
 * breaks `photon`, which asks for `workerd` and would be handed `node`.
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
