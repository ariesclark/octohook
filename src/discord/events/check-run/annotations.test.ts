import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  annotationText,
  bySeverity,
  fold,
  oneLine,
  runnerNoise,
  worthSaying,
} from "./annotations.ts";
import type { Annotation } from "./run.ts";

function annotation(partial: Partial<Annotation> = {}): Annotation {
  return { path: "a.ts", startLine: 1, level: "warning", title: null, message: "m", ...partial };
}

describe("annotationText", () => {
  test("says the title when there is one", () => {
    assert.equal(
      annotationText(annotation({ title: "casing does not match", message: "FromAsCasing: …" })),
      "casing does not match",
    );
  });

  test("falls back to the message when there is no title", () => {
    assert.equal(
      annotationText(annotation({ title: null, message: "no such member" })),
      "no such member",
    );
    assert.equal(
      annotationText(annotation({ title: "", message: "no such member" })),
      "no such member",
    );
  });
});

describe("oneLine", () => {
  test("folds a paragraph into a line", () => {
    assert.equal(oneLine("one\n  two   three\n"), "one two three");
  });

  test("cuts what is too long to read in a list", () => {
    const text = oneLine("x".repeat(400));

    assert.equal(text.length, 110);
    assert.ok(text.endsWith("…"));
  });
});

describe("fold", () => {
  // A rule broken at four places is four places, and a count that spans them points its link
  // and its line number at whichever came first.
  test("keeps the same complaint at different lines apart", () => {
    const folded = fold([annotation({ startLine: 5 }), annotation({ startLine: 17 })]);

    assert.equal(folded.length, 2);
    assert.equal(folded[0]!.count, 1);
    assert.equal(folded[1]!.count, 1);
  });

  test("counts an annotation repeated word for word", () => {
    const folded = fold([annotation(), annotation(), annotation({ message: "other" })]);

    assert.equal(folded.length, 2);
    assert.equal(folded[0]!.count, 2);
    assert.equal(folded[1]!.count, 1);
  });
});

describe("runnerNoise", () => {
  // The runner marks every failed job with this; the headline already said the job failed.
  test("drops the runner restating the exit code", () => {
    assert.equal(
      runnerNoise(annotation({ message: "Process completed with exit code 1." })),
      false,
    );
    assert.equal(runnerNoise(annotation({ message: "Property 'x' does not exist" })), true);
  });
});

describe("bySeverity", () => {
  // Only so many fit under a job, so the order decides which ones a reader ever sees.
  test("puts what broke above what merely complained", () => {
    const mixed = [
      annotation({ level: "notice", message: "a" }),
      annotation({ level: "warning", message: "b" }),
      annotation({ level: "failure", message: "c" }),
    ];

    assert.deepEqual(
      [...mixed].sort(bySeverity).map(({ message }) => message),
      ["c", "b", "a"],
    );
  });

  test("leaves the tool's own order alone within a level", () => {
    const same = [
      annotation({ level: "warning", message: "first", startLine: 9 }),
      annotation({ level: "warning", message: "second", startLine: 1 }),
    ];

    assert.deepEqual(
      [...same].sort(bySeverity).map(({ message }) => message),
      ["first", "second"],
    );
  });

  // A level the catalogue has never seen is more likely news than noise.
  test("ranks a level it does not know alongside a warning", () => {
    const mixed = [
      annotation({ level: "notice", message: "a" }),
      annotation({ level: "catastrophe", message: "b" }),
    ];

    assert.deepEqual(
      [...mixed].sort(bySeverity).map(({ message }) => message),
      ["b", "a"],
    );
  });
});

describe("worthSaying", () => {
  const noise = annotation({ message: "Process completed with exit code 2." });
  const news = annotation({ message: "Property 'x' does not exist" });

  test("drops the runner's exit code when a tool said something of its own", () => {
    assert.deepEqual(worthSaying([noise, news]), [news]);
  });

  // Dropped when it is all there is, a failing job draws with no reason under it at all — and
  // the exit code, restated or not, is the only thing anybody has to go on.
  test("keeps the exit code when it is the only thing said", () => {
    assert.deepEqual(worthSaying([noise]), [noise]);
  });

  test("says nothing when nothing was said", () => {
    assert.deepEqual(worthSaying([]), []);
  });
});
