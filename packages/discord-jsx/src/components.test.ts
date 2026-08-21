import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComponentType, MessageFlags } from "discord-api-types/v10";

import { Container, MediaGallery, Message, Section, TextDisplay, Thumbnail } from "./components.ts";

describe("discord components", () => {
  it("builds a text display from children", () => {
    assert.deepEqual(TextDisplay({ children: ["hello", " ", "world"] }), {
      type: ComponentType.TextDisplay,
      content: "hello world",
    });
  });

  it("builds nested containers", () => {
    assert.deepEqual(Container({ accent_color: 1, children: TextDisplay({ children: "x" }) }), {
      type: ComponentType.Container,
      accent_color: 1,
      components: [{ type: ComponentType.TextDisplay, content: "x" }],
    });
  });

  it("builds sections with accessories", () => {
    const thumbnail = Thumbnail({ media: { url: "https://example.com/a.png" } });
    assert.deepEqual(thumbnail, {
      type: ComponentType.Thumbnail,
      media: { url: "https://example.com/a.png" },
    });

    const section = Section({ accessory: thumbnail, children: TextDisplay({ children: "t" }) });
    assert.equal(section.type, ComponentType.Section);
    assert.deepEqual(section.accessory, thumbnail);
  });

  it("routes gallery children into items", () => {
    const gallery = MediaGallery({ children: [{ media: { url: "https://example.com/a.png" } }] });
    assert.equal(gallery.type, ComponentType.MediaGallery);
    assert.deepEqual(gallery.items, [{ media: { url: "https://example.com/a.png" } }]);
  });

  it("builds a components-v2 message with files", () => {
    const file = { name: "authors.png", data: new Uint8Array([1]) };
    const message = Message({ files: [file], children: TextDisplay({ children: "m" }) });

    assert.equal(message.flags, MessageFlags.IsComponentsV2);
    assert.deepEqual(message.components, [{ type: ComponentType.TextDisplay, content: "m" }]);
    assert.deepEqual(message.files, [file]);
  });
});
