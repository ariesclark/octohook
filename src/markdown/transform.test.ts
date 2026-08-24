import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boldDeepHeadings,
  decodeEntities,
  dropComments,
  dropImages,
  dropRules,
  flattenTables,
  labelAlerts,
  leadingSection,
  limit,
  lineBreaks,
  listTables,
  smallText,
  taskLists,
  transformMarkdown,
  unredirectLinks,
} from "./transform.ts";

describe("dropComments", () => {
  it("removes a comment-only block", () => {
    assert.equal(
      transformMarkdown("before\n\n<!-- a note to maintainers -->\n\nafter", [dropComments]),
      "before\n\nafter",
    );
  });

  it("removes a comment spanning several lines", () => {
    const body = ["before", "", "<!--", "hidden", "instructions", "-->", "", "after"].join("\n");
    assert.equal(transformMarkdown(body, [dropComments]), "before\n\nafter");
  });

  it("keeps the markup around an inline comment", () => {
    assert.equal(
      transformMarkdown("<summary>Notes<!-- hi --></summary>", [dropComments]),
      "<summary>Notes</summary>",
    );
  });

  it("leaves bodies without comments alone", () => {
    assert.equal(transformMarkdown("just prose", [dropComments]), "just prose");
  });
});

describe("decodeEntities", () => {
  it("decodes a numeric reference inside raw html", () => {
    assert.equal(
      transformMarkdown("<summary>Cap-go (@&#8203;capgo/browser)</summary>", [decodeEntities]),
      "<summary>Cap-go (@​capgo/browser)</summary>",
    );
  });

  it("decodes a named reference", () => {
    assert.equal(
      transformMarkdown("<summary>a &amp; b</summary>", [decodeEntities]),
      "<summary>a & b</summary>",
    );
  });

  it("decodes hexadecimal references", () => {
    assert.equal(
      transformMarkdown("<summary>&#x200B;x</summary>", [decodeEntities]),
      "<summary>​x</summary>",
    );
  });

  it("leaves an unknown reference as written", () => {
    assert.equal(
      transformMarkdown("<summary>&notarealentity;</summary>", [decodeEntities]),
      "<summary>&notarealentity;</summary>",
    );
  });
});

describe("dropRules", () => {
  it("removes a thematic break", () => {
    assert.equal(transformMarkdown("before\n\n---\n\nafter", [dropRules]), "before\n\nafter");
  });

  it("never prints `***`, which Discord reads as an opening bold marker", () => {
    const output = transformMarkdown("a\n\n***\n\nb", [dropRules]);
    assert.ok(!output.includes("***"), `found a rule in: ${output}`);
  });

  it("keeps bold markers balanced around a rule", () => {
    const body = ["**one**", "", "---", "", "#### two", "", "three"].join("\n");
    const output = transformMarkdown(body, [dropRules, boldDeepHeadings]);

    assert.equal((output.match(/\*\*/g) ?? []).length % 2, 0, `unbalanced: ${output}`);
  });
});

describe("printMarkdown", () => {
  it("uses dashes for bullets so they cannot pair with bold markers", () => {
    assert.equal(transformMarkdown("* one\n* two", []), "- one\n- two");
  });
});

describe("boldDeepHeadings", () => {
  it("leaves headings Discord renders alone", () => {
    for (const level of ["#", "##", "###"]) {
      const body = `${level} Release Notes`;
      assert.equal(transformMarkdown(body, [boldDeepHeadings]), body);
    }
  });

  it("turns a fourth-level heading into bold text", () => {
    assert.equal(transformMarkdown("#### Fixed", [boldDeepHeadings]), "**Fixed**");
  });

  it("turns fifth and sixth levels into bold too", () => {
    assert.equal(transformMarkdown("##### Deep", [boldDeepHeadings]), "**Deep**");
    assert.equal(transformMarkdown("###### Deeper", [boldDeepHeadings]), "**Deeper**");
  });

  it("keeps inline markup inside the heading", () => {
    assert.equal(
      transformMarkdown("#### [v0.8.4](https://example.com) fixes", [boldDeepHeadings]),
      "**[v0.8.4](https://example.com) fixes**",
    );
  });

  it("leaves body text that merely starts with hashes alone", () => {
    assert.equal(
      transformMarkdown("issue #### 1234 was fixed", [boldDeepHeadings]),
      "issue #### 1234 was fixed",
    );
  });
});

describe("limit", () => {
  const paragraphs = (count: number) =>
    Array.from({ length: count }, (_, index) => `Paragraph number ${index} of the body.`).join(
      "\n\n",
    );

  it("keeps whole blocks rather than cutting mid-sentence", () => {
    const body = paragraphs(6);
    const output = transformMarkdown(body, [limit(120)]);

    for (const line of output.split("\n").filter(Boolean))
      assert.ok(
        line.endsWith(".") || line.startsWith("-#"),
        `expected a whole block, got: ${line}`,
      );
  });

  it("stays within the budget", () => {
    const output = transformMarkdown(paragraphs(20), [limit(200)]);
    assert.ok(output.length <= 200, `expected ≤ 200 characters, got ${output.length}`);
  });

  it("says how much it left out", () => {
    const output = transformMarkdown(paragraphs(10), [limit(150)]);
    assert.match(output, /-# … \d+ more (block|blocks)/);
  });

  it("closes a details block whose opener fit but whose closer did not", () => {
    const body = [
      "Intro paragraph that comfortably fits.",
      "",
      "<details>",
      "<summary>Release notes</summary>",
      "",
      "First changelog entry.",
      "",
      "Second changelog entry that pushes us past the budget entirely.",
      "",
      "</details>",
    ].join("\n");

    const output = transformMarkdown(body, [limit(150)]);

    assert.equal(
      (output.match(/<details>/g) ?? []).length,
      (output.match(/<\/details>/g) ?? []).length,
      `unbalanced: ${output}`,
    );
  });

  it("never leaves an html block unclosed", () => {
    const body = [
      "Intro paragraph.",
      "",
      "<details>",
      "<summary>Release notes</summary>",
      "",
      "A very long changelog entry that will not fit inside the budget at all.",
      "",
      "</details>",
    ].join("\n");

    const output = transformMarkdown(body, [limit(60)]);
    const opens = (output.match(/<details>/g) ?? []).length;
    const closes = (output.match(/<\/details>/g) ?? []).length;

    assert.equal(opens, closes);
  });

  it("leaves a body that already fits untouched", () => {
    assert.equal(transformMarkdown("short enough", [limit(500)]), "short enough");
  });
});

describe("unredirectLinks", () => {
  it("rewrites a redirect host back to github.com", () => {
    assert.equal(
      transformMarkdown("[notes](https://redirect.github.com/owner/repo/releases)", [
        unredirectLinks,
      ]),
      "[notes](https://github.com/owner/repo/releases)",
    );
  });

  it("rewrites bare autolinks too", () => {
    assert.equal(
      transformMarkdown("<https://redirect.github.com/owner/repo>", [unredirectLinks]),
      "<https://github.com/owner/repo>",
    );
  });

  it("keeps the path, query and fragment", () => {
    assert.equal(
      transformMarkdown(
        "[x](https://redirect.github.com/o/r/blob/HEAD/CHANGELOG.md?plain=1#v084-2026-08-14)",
        [unredirectLinks],
      ),
      "[x](https://github.com/o/r/blob/HEAD/CHANGELOG.md?plain=1#v084-2026-08-14)",
    );
  });

  it("leaves other hosts alone", () => {
    assert.equal(
      transformMarkdown("[hex](https://hex.pm/packages/tidewave)", [unredirectLinks]),
      "[hex](https://hex.pm/packages/tidewave)",
    );
  });

  it("does not touch a lookalike host", () => {
    assert.equal(
      transformMarkdown("[x](https://redirect.github.com.evil.example/o/r)", [unredirectLinks]),
      "[x](https://redirect.github.com.evil.example/o/r)",
    );
  });
});

describe("dropImages", () => {
  it("removes an inline image", () => {
    assert.equal(
      transformMarkdown("before ![age](https://example.com/age.svg) after", [dropImages]),
      "before after",
    );
  });

  it("keeps the link when an image is the whole link body", () => {
    assert.equal(
      transformMarkdown("[![build](https://example.com/b.svg)](https://ci.example.com)", [
        dropImages,
      ]),
      "[build](https://ci.example.com)",
    );
  });

  it("drops a paragraph that was only images", () => {
    assert.equal(
      transformMarkdown("keep me\n\n![a](https://example.com/a.svg)\n\nkeep me too", [dropImages]),
      "keep me\n\nkeep me too",
    );
  });

  it("leaves bodies without images alone", () => {
    assert.equal(transformMarkdown("just prose", [dropImages]), "just prose");
  });
});

describe("leadingSection", () => {
  it("drops everything from the first heading that follows content", () => {
    const body = ["Updates the resolver.", "", "## Release Notes", "", "All the detail."].join(
      "\n",
    );

    assert.equal(transformMarkdown(body, [leadingSection]), "Updates the resolver.");
  });

  it("keeps a heading the body opens with, cutting at the next one", () => {
    const body = ["## Summary", "", "What it does.", "", "## Test plan", "", "How to check."].join(
      "\n",
    );

    assert.equal(transformMarkdown(body, [leadingSection]), "## Summary\nWhat it does.");
  });

  it("keeps consecutive opening headings together", () => {
    const body = [
      "# Title",
      "",
      "## Summary",
      "",
      "What it does.",
      "",
      "## Detail",
      "",
      "More.",
    ].join("\n");

    assert.equal(transformMarkdown(body, [leadingSection]), "# Title\n## Summary\nWhat it does.");
  });

  it("leaves a body with no headings alone", () => {
    const body = "Just prose.\n\nAnd more prose.";

    assert.equal(transformMarkdown(body, [leadingSection]), body);
  });
});

describe("listTables", () => {
  it("nests each row's remaining cells under its leading cell", () => {
    const body = [
      "| Package | Type | Change |",
      "|---|---|---|",
      "| tidewave | dev | `0.8.3` → `0.8.4` |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [listTables]),
      ["- **tidewave**", "  - **Type:** dev", "  - **Change:** `0.8.3` → `0.8.4`"].join("\n"),
    );
  });

  it("keeps one item per row", () => {
    const body = [
      "| Package | Change |",
      "|---|---|",
      "| tidewave | patch |",
      "| faker | minor |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [listTables]),
      ["- **tidewave**", "  - **Change:** patch", "- **faker**", "  - **Change:** minor"].join(
        "\n",
      ),
    );
  });

  it("keeps inline links and code intact", () => {
    const body = [
      "| Package | Change |",
      "|---|---|",
      "| [tidewave](https://hex.pm/packages/tidewave) | `0.8.3` |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [listTables]),
      ["- **[tidewave](https://hex.pm/packages/tidewave)**", "  - **Change:** `0.8.3`"].join("\n"),
    );
  });

  it("skips empty cells rather than printing bare labels", () => {
    const body = ["| Package | Type | Update |", "|---|---|---|", "| tidewave |  | patch |"].join(
      "\n",
    );

    assert.equal(
      transformMarkdown(body, [listTables]),
      ["- **tidewave**", "  - **Update:** patch"].join("\n"),
    );
  });

  it("skips a cell whose only content is a badge", () => {
    const body = [
      "| Package | Age | Update |",
      "|---|---|---|",
      "| tidewave | [![age](https://badges.example/age.svg)](https://docs.example/) | patch |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [listTables]),
      ["- **tidewave**", "  - **Update:** patch"].join("\n"),
    );
  });

  it("keeps the text of a cell that has a badge beside it", () => {
    const body = [
      "| Package | Change |",
      "|---|---|",
      "| ![icon](https://badges.example/i.svg) tidewave | patch |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [listTables]),
      ["- **tidewave**", "  - **Change:** patch"].join("\n"),
    );
  });

  it("leaves a row with no other cells as a plain item", () => {
    const body = ["| Package |", "|---|", "| tidewave |"].join("\n");

    assert.equal(transformMarkdown(body, [listTables]), "- **tidewave**");
  });

  it("leaves prose around the table alone", () => {
    const body = [
      "Updates:",
      "",
      "| Package | Change |",
      "|---|---|",
      "| tidewave | patch |",
      "",
      "Closing note.",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [listTables]),
      ["Updates:", "- **tidewave**", "  - **Change:** patch", "Closing note."].join("\n"),
    );
  });
});

describe("flattenTables", () => {
  it("turns a two-column table into labelled lines", () => {
    const body = [
      "| Package | Change |",
      "|---|---|",
      "| tidewave | `0.8.3` → `0.8.4` |",
      "| faker | `0.18.0` → `0.19.0` |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [flattenTables]),
      "**tidewave** — Change: `0.8.3` → `0.8.4`\n**faker** — Change: `0.18.0` → `0.19.0`",
    );
  });

  it("labels every column past the first", () => {
    const body = [
      "| Package | Type | Update |",
      "|---|---|---|",
      "| tidewave | dev | patch |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [flattenTables]),
      "**tidewave** — Type: dev • Update: patch",
    );
  });

  it("keeps inline links and code intact", () => {
    const body = [
      "| Package | Change |",
      "|---|---|",
      "| [tidewave](https://hex.pm/packages/tidewave) | `0.8.3` → `0.8.4` |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [flattenTables]),
      "**[tidewave](https://hex.pm/packages/tidewave)** — Change: `0.8.3` → `0.8.4`",
    );
  });

  it("skips empty cells rather than printing bare labels", () => {
    const body = ["| Package | Type | Update |", "|---|---|---|", "| tidewave |  | patch |"].join(
      "\n",
    );

    assert.equal(transformMarkdown(body, [flattenTables]), "**tidewave** — Update: patch");
  });

  it("skips a cell whose only content is a badge", () => {
    const body = [
      "| Package | Age | Update |",
      "|---|---|---|",
      "| tidewave | [![age](https://badges.example/age.svg)](https://docs.example/) | patch |",
    ].join("\n");

    assert.equal(transformMarkdown(body, [flattenTables]), "**tidewave** — Update: patch");
  });

  it("leaves prose around the table alone", () => {
    const body = [
      "This PR contains the following updates:",
      "",
      "| Package | Change |",
      "|---|---|",
      "| tidewave | patch |",
      "",
      "Some closing note.",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [flattenTables]),
      "This PR contains the following updates:\n\n**tidewave** — Change: patch\n\nSome closing note.",
    );
  });

  it("returns the body unchanged when there is no table", () => {
    assert.equal(transformMarkdown("just prose", [flattenTables]), "just prose");
  });
});

describe("labelAlerts", () => {
  it("turns a note alert into a bold label", () => {
    assert.equal(
      transformMarkdown("> [!NOTE]\n> Something worth knowing.", [labelAlerts]),
      "> **Note**\n> Something worth knowing.",
    );
  });

  it("handles every documented alert type", () => {
    for (const [marker, label] of [
      ["NOTE", "Note"],
      ["TIP", "Tip"],
      ["IMPORTANT", "Important"],
      ["WARNING", "Warning"],
      ["CAUTION", "Caution"],
    ])
      assert.equal(
        transformMarkdown(`> [!${marker}]\n> body`, [labelAlerts]),
        `> **${label}**\n> body`,
      );
  });

  it("never leaves the marker escaped", () => {
    const output = transformMarkdown("> [!WARNING]\n> careful", [labelAlerts]);
    assert.ok(!output.includes("\\["), `found an escaped bracket in: ${output}`);
  });

  it("leaves an ordinary quote alone", () => {
    assert.equal(transformMarkdown("> just a quote", [labelAlerts]), "> just a quote");
  });

  it("leaves an unknown marker alone", () => {
    assert.equal(
      transformMarkdown("> [!SOMETHING]\n> body", [labelAlerts]),
      "> \\[!SOMETHING]\n> body",
    );
  });
});

describe("block spacing", () => {
  it("keeps a blank line between prose paragraphs", () => {
    assert.equal(transformMarkdown("first para\n\nsecond para", []), "first para\n\nsecond para");
  });

  it("keeps a blank line before a quote", () => {
    assert.equal(transformMarkdown("intro\n\n> quoted", []), "intro\n\n> quoted");
  });

  it("sits a heading against what it introduces", () => {
    assert.equal(transformMarkdown("### Title\n\nbody", []), "### Title\nbody");
  });

  it("keeps list items together", () => {
    assert.equal(transformMarkdown("- one\n\n- two", []), "- one\n- two");
  });

  it("never leaves a lone `>` inside a quote", () => {
    const output = transformMarkdown("> one\n>\n> two", []);
    assert.ok(!/^>\s*$/m.test(output), `found a bare quote marker in: ${JSON.stringify(output)}`);
  });
});

describe("smallText", () => {
  it("turns a `<sub>` paragraph into subtext", () => {
    assert.equal(
      transformMarkdown("<sub>Comment @coderabbitai help.</sub>", [smallText]),
      "-# Comment @coderabbitai help.",
    );
  });

  it("treats `<sup>` the same way", () => {
    assert.equal(transformMarkdown("<sup>a footnote</sup>", [smallText]), "-# a footnote");
  });

  it("keeps inline markup inside the tag", () => {
    assert.equal(
      transformMarkdown("<sub>see [the docs](https://example.com)</sub>", [smallText]),
      "-# see [the docs](https://example.com)",
    );
  });

  it("leaves a paragraph that merely contains a tag alone", () => {
    const body = "text before <sub>small</sub> text after";
    assert.equal(transformMarkdown(body, [smallText]), body);
  });

  it("leaves other inline html alone", () => {
    assert.equal(transformMarkdown("<kbd>Ctrl</kbd>", [smallText]), "<kbd>Ctrl</kbd>");
  });
});

describe("lineBreaks", () => {
  it("turns `<br>` into a line break", () => {
    assert.equal(transformMarkdown("one <br> two", [lineBreaks]), "one\ntwo");
  });

  it("accepts the self-closing spellings", () => {
    for (const tag of ["<br/>", "<br />", "<BR>"])
      assert.equal(transformMarkdown(`one ${tag} two`, [lineBreaks]), "one\ntwo");
  });

  it("breaks inside a flattened table cell", () => {
    const body = [
      "| Cohort | Summary |",
      "|---|---|",
      "| Rust cache <br> src/jsc/store.rs | clones with clone_utf8 |",
    ].join("\n");

    assert.equal(
      transformMarkdown(body, [lineBreaks, flattenTables]),
      "**Rust cache\nsrc/jsc/store.rs** — Summary: clones with clone_utf8",
    );
  });

  it("leaves other inline html alone", () => {
    assert.equal(transformMarkdown("press <kbd>Ctrl</kbd>", [lineBreaks]), "press <kbd>Ctrl</kbd>");
  });
});

describe("intraword underscores", () => {
  it("does not escape an underscore inside an identifier", () => {
    assert.equal(transformMarkdown("call clone_utf8 here", []), "call clone_utf8 here");
  });

  it("handles several in one line", () => {
    assert.equal(
      transformMarkdown("clone_utf8 and clone_latin1", []),
      "clone_utf8 and clone_latin1",
    );
  });

  it("still escapes an underscore at a word boundary, where it could open emphasis", () => {
    assert.equal(transformMarkdown("_leading underscore", []), "\\_leading underscore");
    assert.equal(transformMarkdown("trailing_", []), "trailing\\_");
  });

  it("leaves every underscore in a snake_case identifier", () => {
    assert.equal(transformMarkdown("snake_case_name", []), "snake_case_name");
  });
});

describe("escapes Discord never needs", () => {
  it("keeps an ampersand in a query string", () => {
    assert.equal(
      transformMarkdown("https://example.com/x?a=1&b=2 and &c", []),
      "<https://example.com/x?a=1&b=2> and &c",
    );
  });

  it("keeps a lone tilde", () => {
    assert.equal(transformMarkdown("~18,500 passed", []), "~18,500 passed");
  });

  it("still renders strikethrough", () => {
    assert.equal(transformMarkdown("~~gone~~", []), "~~gone~~");
  });

  it("still escapes a character Discord does parse", () => {
    assert.match(transformMarkdown("\\# not a heading", []), /\\#/);
  });
});

describe("taskLists", () => {
  it("marks a completed item", () => {
    assert.equal(transformMarkdown("- [x] shipped", [taskLists]), "- ✅ shipped");
  });

  it("marks an outstanding item", () => {
    assert.equal(transformMarkdown("- [ ] pending", [taskLists]), "- ⬜ pending");
  });

  it("leaves an ordinary list alone", () => {
    assert.equal(transformMarkdown("- plain item", [taskLists]), "- plain item");
  });

  it("keeps inline markup in the item", () => {
    assert.equal(
      transformMarkdown("- [x] see [docs](https://example.com)", [taskLists]),
      "- ✅ see [docs](https://example.com)",
    );
  });
});
