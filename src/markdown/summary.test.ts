import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarise } from "./summary.ts";

describe("summarise", () => {
  it("takes the opening prose", () => {
    assert.equal(
      summarise("Fixes the resolver so end-of-year parses.\n\nMore detail below."),
      "Fixes the resolver so end-of-year parses.",
    );
  });

  it("strips markup down to plain text", () => {
    assert.equal(
      summarise("**Fix:** the [resolver](https://example.com) now uses `clone_utf8`."),
      "Fix: the resolver now uses clone_utf8.",
    );
  });

  it("skips a leading badge and finds the prose", () => {
    assert.equal(
      summarise("[![build](https://img.example/b.svg)](https://ci.example)\n\nActual description."),
      "Actual description.",
    );
  });

  it("skips a leading heading", () => {
    assert.equal(summarise("## Summary\n\nWhat it does."), "What it does.");
  });

  it("truncates at a word boundary", () => {
    const body = "The quick brown fox jumps over the lazy dog and keeps running for miles.";
    const summary = summarise(body, 30);

    assert.ok(summary!.length <= 30, `too long: ${summary}`);
    assert.ok(summary!.endsWith("…"), `expected an ellipsis: ${summary}`);
    assert.ok(!/\s…$/.test(summary!), `should not end on a space: ${summary}`);
    assert.ok(body.startsWith(summary!.slice(0, -1)), `should be a prefix: ${summary}`);
  });

  it("drops inline html but keeps the text it wraps", () => {
    assert.equal(summarise("Handles <b>bold</b> &amp; entities."), "Handles bold & entities.");
  });

  it("collapses line breaks inside a paragraph", () => {
    assert.equal(summarise("one line\nand its continuation"), "one line and its continuation");
  });

  it("folds a table into a paragraph that introduces it", () => {
    const body = [
      "This PR contains the following updates:",
      "",
      "| Package | Update | Change |",
      "|---|---|---|",
      "| tidewave | patch | ~>0.8.0 → ~>0.8.4 |",
    ].join("\n");

    assert.equal(
      summarise(body),
      "This PR contains the following updates: tidewave — Update: patch • Change: ~>0.8.0 → ~>0.8.4",
    );
  });

  it("separates multiple rows of a folded table", () => {
    const body = [
      "Updates:",
      "",
      "| Package | Change |",
      "|---|---|",
      "| react | 18 → 19 |",
      "| vite | 5 → 6 |",
    ].join("\n");

    assert.equal(summarise(body), "Updates: react — Change: 18 → 19; vite — Change: 5 → 6");
  });

  it("folds a list into a paragraph that introduces it", () => {
    assert.equal(
      summarise("Run one of:\n\n- `/benchmark`\n- `/review`"),
      "Run one of: /benchmark; /review",
    );
  });

  it("leaves the following block alone when the paragraph is not an introduction", () => {
    const body = [
      "Bumps the resolver.",
      "",
      "| Package | Change |",
      "|---|---|",
      "| react | 18 → 19 |",
    ].join("\n");

    assert.equal(summarise(body), "Bumps the resolver.");
  });

  it("summarises a table when the body has no prose at all", () => {
    const body = ["| Package | Change |", "|---|---|", "| react | 18 → 19 |"].join("\n");

    assert.equal(summarise(body), "react — Change: 18 → 19");
  });

  it("truncates a folded table at a word boundary", () => {
    const body =
      "Updates:\n\n| Package | Change |\n|---|---|\n| some-very-long-package-name | 1.0.0 → 2.0.0 |";
    const summary = summarise(body, 40);

    assert.ok(summary!.length <= 40, `too long: ${summary}`);
    assert.ok(summary!.endsWith("…"), `expected an ellipsis: ${summary}`);
  });

  it("returns nothing for a body with no prose", () => {
    assert.equal(summarise("![shot](https://img.example/a.png)"), undefined);
    assert.equal(summarise(""), undefined);
  });

  it("ignores a code block when looking for prose", () => {
    assert.equal(
      summarise("```ts\nconst a = 1;\n```\n\nExplains the change."),
      "Explains the change.",
    );
  });
});
