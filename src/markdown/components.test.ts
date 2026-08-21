import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComponentType } from "discord-api-types/v10";

import { toComponents } from "./components.ts";

describe("toComponents", () => {
  it("returns a single text component when there is no rule", () => {
    const components = toComponents("one\n\ntwo");

    assert.equal(components.length, 1);
    assert.equal(components[0].type, ComponentType.TextDisplay);
  });

  it("splits at a thematic break and renders it as a divider", () => {
    const components = toComponents("before\n\n---\n\nafter");

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.TextDisplay, ComponentType.Separator, ComponentType.TextDisplay],
    );
    assert.equal((components[1] as { divider?: boolean }).divider, true);
  });

  it("keeps the text either side of the rule", () => {
    const [before, , after] = toComponents("before\n\n---\n\nafter") as {
      content?: string;
    }[];

    assert.equal(before.content, "before");
    assert.equal(after.content, "after");
  });

  it("drops a rule with nothing after it rather than ending on a divider", () => {
    const components = toComponents("only\n\n---");

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.TextDisplay],
    );
  });

  it("drops a leading rule rather than starting on a divider", () => {
    const components = toComponents("---\n\nonly");

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.TextDisplay],
    );
  });

  it("never emits an empty text component", () => {
    for (const component of toComponents("a\n\n---\n\n---\n\nb"))
      if (component.type === ComponentType.TextDisplay)
        assert.ok((component as { content: string }).content.trim().length > 0);
  });
});

describe("images", () => {
  const url = "https://github.com/user-attachments/assets/1a5dc752";

  it("renders a standalone html image as a gallery", () => {
    const components = toComponents(`<img width="220" alt="image" src="${url}" />`);

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.MediaGallery],
    );
    assert.deepEqual((components[0] as { items: { media: { url: string } }[] }).items, [
      { media: { url } },
    ]);
  });

  it("renders a standalone markdown image as a gallery", () => {
    const components = toComponents(`![shot](${url})`);

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.MediaGallery],
    );
  });

  it("groups adjacent images into one gallery", () => {
    const components = toComponents(`![a](${url}/a.png)\n\n![b](${url}/b.png)`);

    assert.equal(components.length, 1);
    assert.equal((components[0] as { items: unknown[] }).items.length, 2);
  });

  it("keeps the text around an image", () => {
    const components = toComponents(`before\n\n![a](${url}/a.png)\n\nafter`);

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.TextDisplay, ComponentType.MediaGallery, ComponentType.TextDisplay],
    );
  });

  it("ignores an image that has no source", () => {
    assert.deepEqual(toComponents('<img alt="broken" />'), []);
  });
});

describe("link buttons", () => {
  const badge = "https://storage.googleapis.com/coderabbit_public_assets/review-stack.svg";
  const target = "https://app.coderabbit.ai/change-stack/oven-sh/bun/pull/33864";

  it("renders an image-only link as a link button", () => {
    const components = toComponents(`[![Review Change Stack](${badge})](${target})`);

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.ActionRow],
    );

    const [button] = (components[0] as { components: { label: string; url: string }[] }).components;
    assert.equal(button.label, "Review Change Stack");
    assert.equal(button.url, target);
  });

  it("groups adjacent buttons into one row", () => {
    const components = toComponents(
      `[![One](${badge})](${target}/1)\n\n[![Two](${badge})](${target}/2)`,
    );

    assert.equal(components.length, 1);
    assert.equal((components[0] as { components: unknown[] }).components.length, 2);
  });

  it("falls back to the host when the image has no alt text", () => {
    const [row] = toComponents(`[![](${badge})](${target})`) as {
      components: { label: string }[];
    }[];

    assert.equal(row.components[0].label, "app.coderabbit.ai");
  });

  it("keeps a text link as text", () => {
    const components = toComponents(`[read the docs](${target})`);

    assert.deepEqual(
      components.map(({ type }) => type),
      [ComponentType.TextDisplay],
    );
  });

  it("truncates a label past Discord's limit", () => {
    const long = "x".repeat(120);
    const [row] = toComponents(`[![${long}](${badge})](${target})`) as {
      components: { label: string }[];
    }[];

    assert.ok(row.components[0].label.length <= 80, `label was ${row.components[0].label.length}`);
  });
});
