import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Bold, Code, CodeBlock, H2, Link, Subtext } from "./components.ts";

describe("markdown components", () => {
  it("renders inline markdown from props", () => {
    assert.equal(Bold({ children: "hi" }), "**hi**");
    assert.equal(Code({ children: "main" }), "`main`");
    assert.equal(
      Link({ href: "https://example.com", children: "site" }),
      "[site](https://example.com)",
    );
  });

  it("renders block markdown from props", () => {
    assert.equal(H2({ children: ["canary", ": ", "succeeded"] }), "## canary: succeeded");
    assert.equal(Subtext({ children: "variant: classic" }), "-# variant: classic");
    assert.equal(CodeBlock({ language: "ts", children: "let a = 1;" }), "```ts\nlet a = 1;\n```");
  });

  it("composes nested components", () => {
    assert.equal(
      Bold({ children: Link({ href: "https://example.com", children: "repo" }) }),
      "**[repo](https://example.com)**",
    );
  });
});
