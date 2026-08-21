import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MessageComponent } from "./limits.ts";
import {
  characterCount,
  componentCount,
  maximumCharacters,
  maximumComponents,
  splitComponents,
} from "./limits.ts";

const line = (content: string): MessageComponent => ({ content });

describe("componentCount", () => {
  test("counts a component and everything inside it", () => {
    assert.equal(componentCount([line("a")]), 1);
    assert.equal(componentCount([{ components: [line("a"), line("b")] }]), 3);
    assert.equal(componentCount([{ accessory: line("a") }]), 2);
  });
});

describe("characterCount", () => {
  test("counts the content of every component, however deep", () => {
    assert.equal(characterCount([line("abc")]), 3);
    assert.equal(characterCount([{ components: [line("ab"), { accessory: line("c") }] }]), 3);
  });
});

describe("splitComponents", () => {
  test("leaves a message that fits as one message", () => {
    const split = splitComponents([line("a"), line("b")]);

    assert.equal(split.length, 1);
    assert.deepEqual(split[0], [line("a"), line("b")]);
  });

  test("splits when the characters would not fit", () => {
    const half = "x".repeat(maximumCharacters - 10);
    const split = splitComponents([line(half), line(half)]);

    assert.equal(split.length, 2);
    assert.deepEqual(split[0], [line(half)]);
    assert.deepEqual(split[1], [line(half)]);
  });

  test("splits when the components would not fit", () => {
    const many = Array.from({ length: maximumComponents + 1 }, (_, index) => line(`${index}`));
    const split = splitComponents(many);

    assert.equal(split.length, 2);
    assert.equal(split[0]!.length, maximumComponents);
    assert.equal(split[1]!.length, 1);
  });

  // Splitting inside a component would tear a quote or a container in half.
  test("keeps a component whole even when it cannot fit alone", () => {
    const huge = line("x".repeat(maximumCharacters + 100));
    const split = splitComponents([line("a"), huge]);

    assert.equal(split.length, 2);
    assert.deepEqual(split[1], [huge]);
  });

  // Delivery adds a line to every message after the first, saying what it continues; splitting
  // to the very limit leaves no room for it and the message comes back rejected.
  test("splits to a smaller budget when asked", () => {
    const line = (content: string): MessageComponent => ({ content });
    const half = "x".repeat(maximumCharacters / 2);

    assert.equal(splitComponents([line(half), line(half)]).length, 1);
    assert.equal(splitComponents([line(half), line(half)], maximumCharacters - 200).length, 2);
  });

  test("makes no messages out of nothing", () => {
    assert.deepEqual(splitComponents([]), []);
  });
});
