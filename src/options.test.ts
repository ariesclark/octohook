import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getQuery } from "./options.ts";

const push = { type: "push", repository: { name: "octohook" } };

describe("getQuery", () => {
  test("matches every event when no filter is given", () => {
    const { matches, queryString } = getQuery({});

    assert.equal(queryString, "");
    assert.equal(matches(push), true);
  });

  test("keeps an event the include names", () => {
    assert.equal(getQuery({ include: "type:push" }).matches(push), true);
  });

  test("drops an event the include does not name", () => {
    assert.equal(getQuery({ include: "type:star.created" }).matches(push), false);
  });

  test("drops an event the exclude names", () => {
    assert.equal(getQuery({ exclude: "type:push" }).matches(push), false);
  });

  test("keeps an event the exclude does not name", () => {
    assert.equal(getQuery({ exclude: "type:star.created" }).matches(push), true);
  });
});
