import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import type { ListItem, Nodes, Parent, PhrasingContent, RootContent, Table } from "mdast";

/**
 * Discord renders a subset of GitHub's markdown, so a pull request body has to be
 * rewritten rather than escaped. Each transform edits the parsed tree in place.
 */
export type Transform = (tree: Nodes) => void;

export function parseMarkdown(body: string): Nodes {
  return fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

/**
 * Discord's subtext has no markdown equivalent, so it is a node of our own with a
 * printer handler rather than a string smuggled through an `html` node.
 */
export interface Subtext extends Parent {
  type: "subtext";
  children: PhrasingContent[];
}

declare module "mdast" {
  interface RootContentMap {
    subtext: Subtext;
  }
}

export function printMarkdown(tree: Nodes): string {
  return (
    toMarkdown(tree, {
      extensions: [gfmToMarkdown()],
      // Discord has no thematic breaks or `*` emphasis nesting rules to lean on:
      // a printed `***` reads as an opening bold marker, and `*` bullets can pair
      // with one another, so both default markers are replaced with dashes.
      bullet: "-",
      rule: "-",
      // Markdown puts a blank line between every block, which Discord renders as a real
      // gap. Only prose earns one: a heading belongs against what it introduces, list
      // items belong together, and inside a quote a blank line shows as a lone `>`.
      join: [
        (left, right, parent) => {
          if (parent.type === "blockquote") return 0;

          return left.type === "paragraph" &&
            (right.type === "paragraph" || right.type === "blockquote")
            ? 1
            : 0;
        },
      ],
      handlers: {
        // A newline is a line break in Discord; markdown's trailing backslash would show.
        break: () => "\n",
        subtext: (node, _parent, state, info) =>
          `-# ${state.containerPhrasing(node as Subtext, info)}`,
      },
    })
      .trimEnd()
      // The printer escapes for CommonMark and GFM, but Discord parses neither entities
      // nor single tildes, and ignores an underscore inside a word — so those backslashes
      // would be visible for nothing. `<` keeps its escape: unescaping could form a mention.
      .replaceAll(/(?<=\w)\\_(?=\w)/g, "_")
      .replaceAll("\\&", "&")
      .replaceAll(/\\~(?!~)/g, "~")
  );
}

export function subtext(value: string): Subtext {
  return { type: "subtext", children: [{ type: "text", value }] };
}

function omittedNote(count: number): Subtext {
  return subtext(`… ${count} more block${count === 1 ? "" : "s"}`);
}

/**
 * Comments are addressed to whoever edits the source: templates leave instructions in
 * them, and tools hide state. Discord shows them verbatim.
 */
export function dropComments(tree: Nodes): void {
  visitParents(tree, (parent) => {
    const kept: RootContent[] = [];

    for (const child of parent.children as RootContent[]) {
      if (child.type !== "html") {
        kept.push(child);
        continue;
      }

      const value = child.value.replaceAll(/<!--[\s\S]*?-->/g, "").trim();
      if (value) kept.push({ ...child, value });
    }

    parent.children = kept as typeof parent.children;
  });
}

/**
 * Raw html keeps its character references, since markdown never parses inside it —
 * so `&#8203;`, which GitHub uses to stop autolinking, reaches Discord as literal text.
 */
export function decodeEntities(tree: Nodes): void {
  visitParents(tree, (parent) => {
    for (const child of parent.children as RootContent[]) {
      if (child.type !== "html") continue;

      child.value = child.value.replaceAll(
        /&(?:#(\d+)|#[xX]([\da-fA-F]+)|([a-zA-Z][a-zA-Z\d]*));/g,
        (reference, decimal, hexadecimal, name) => {
          if (decimal) return String.fromCodePoint(Number(decimal));
          if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));

          return decodeNamedCharacterReference(name) || reference;
        },
      );
    }
  });
}

/**
 * GitHub renders `> [!NOTE]` as a titled callout. Discord has no such thing, and the
 * printer escapes the bracket into `\[!NOTE]`, so the marker becomes a bold heading.
 */
const alertLabels: Record<string, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

export function labelAlerts(tree: Nodes): void {
  visitParents(tree, (parent) => {
    for (const child of parent.children as RootContent[]) {
      if (child.type !== "blockquote") continue;

      const [first] = child.children;
      if (first?.type !== "paragraph") continue;

      const [marker] = first.children;
      if (marker?.type !== "text") continue;

      const label = alertLabels[/^\[!([A-Z]+)]\s*/.exec(marker.value)?.[1] ?? ""];
      if (!label) continue;

      // Only the marker and its trailing spaces go; the line break belongs to the body.
      const rest = marker.value.replace(/^\[![A-Z]+][ \t]*/, "");
      first.children = [
        { type: "strong", children: [{ type: "text", value: label }] },
        ...(rest ? [{ type: "text", value: rest } as PhrasingContent] : []),
        ...first.children.slice(1),
      ];
    }
  });
}

/**
 * GFM checkboxes render as literal `[x]` in Discord, so the state becomes a character
 * that carries the same meaning at a glance.
 */
const taskMarks = { true: "✅", false: "⬜" } as const;

export function taskLists(tree: Nodes): void {
  visitParents(tree, (parent) => {
    for (const child of parent.children as RootContent[]) {
      if (child.type !== "listItem" || child.checked === null || child.checked === undefined)
        continue;

      const [first] = child.children;
      if (first?.type !== "paragraph") continue;

      first.children = [
        { type: "text", value: `${taskMarks[`${child.checked}`]} ` },
        ...first.children,
      ];

      child.checked = null;
    }
  });
}

/**
 * Markdown has no way to break a line inside a table cell, so bodies use `<br>`. Discord
 * prints the tag verbatim, while a real break node prints as the newline it stands for.
 */
export function lineBreaks(tree: Nodes): void {
  visitParents(tree, (parent) => {
    parent.children = parent.children.map((child) => {
      if (child.type !== "html" || !/^<br\s*\/?>$/i.test(child.value.trim())) return child;

      return { type: "break" } as RootContent;
    }) as typeof parent.children;

    // The spaces that surrounded the tag would otherwise pad the new line.
    for (const [index, child] of parent.children.entries()) {
      if (child.type !== "break") continue;

      const before = parent.children[index - 1];
      const after = parent.children[index + 1];

      if (before?.type === "text") before.value = before.value.replace(/[ \t]+$/, "");
      if (after?.type === "text") after.value = after.value.replace(/^[ \t]+/, "");
    }
  });
}

/**
 * GitHub's `<sub>` and `<sup>` are how authors write an aside in a body. Discord has no
 * subscript, but it does have subtext, which is what the markup was reaching for.
 */
const smallTags = new Set(["sub", "sup"]);

export function smallText(tree: Nodes): void {
  visitParents(tree, (parent) => {
    parent.children = parent.children.map((child) => {
      if (child.type !== "paragraph" || child.children.length < 3) return child;

      const [first] = child.children;
      const last = child.children.at(-1);
      if (first?.type !== "html" || last?.type !== "html") return child;

      const opening = /^<([a-z]+)>$/i.exec(first.value.trim())?.[1]?.toLowerCase();
      const closing = /^<\/([a-z]+)>$/i.exec(last.value.trim())?.[1]?.toLowerCase();
      if (!opening || opening !== closing || !smallTags.has(opening)) return child;

      return { type: "subtext", children: child.children.slice(1, -1) } as RootContent;
    }) as typeof parent.children;
  });
}

/** Discord renders no horizontal rules, so a break is only a source of stray markers. */
export function dropRules(tree: Nodes): void {
  visitParents(tree, (parent) => {
    parent.children = parent.children.filter(
      (child) => child.type !== "thematicBreak",
    ) as typeof parent.children;
  });
}

export function transformMarkdown(body: string, transforms: Transform[]): string {
  const tree = parseMarkdown(body);
  for (const transform of transforms) transform(tree);

  return printMarkdown(tree);
}

function visitParents(node: Nodes, visit: (parent: Parent) => void): void {
  if (!("children" in node)) return;

  visit(node as Parent);
  for (const child of (node as Parent).children) visitParents(child as Nodes, visit);
}

/** Column headers become plain labels, so their inline markup is printed out flat. */
function cellText(cell: { children: PhrasingContent[] }): string {
  return printMarkdown({ type: "paragraph", children: cell.children } as Nodes).trim();
}

/** Discord renders `#` through `###`; deeper levels print their hashes literally. */
const deepestRenderedHeading = 3;

export function boldDeepHeadings(tree: Nodes): void {
  visitParents(tree, (parent) => {
    parent.children = parent.children.map((child) => {
      if (child.type !== "heading" || child.depth <= deepestRenderedHeading) return child;

      return {
        type: "paragraph",
        children: [{ type: "strong", children: child.children }],
      };
    }) as typeof parent.children;
  });
}

/**
 * Markdown keeps raw HTML as opaque blocks, so an opener and its closer are separate
 * nodes: dropping the tail can strand `<details>` without its `</details>`.
 */
function closeDanglingTags(blocks: RootContent[]): RootContent[] {
  const open: string[] = [];

  for (const block of blocks) {
    if (block.type !== "html") continue;

    for (const [, closing, name] of block.value.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
      if (closing) {
        const index = open.lastIndexOf(name.toLowerCase());
        if (index !== -1) open.splice(index, 1);
      } else if (!/\/>$/.test(block.value)) {
        open.push(name.toLowerCase());
      }
    }
  }

  return open.reverse().map((name) => ({ type: "html", value: `</${name}>` }) as RootContent);
}

/**
 * Discord caps a message, and slicing printed markdown cuts mid-sentence and strands
 * unclosed tags. Whole blocks are dropped from the end instead, and the count of what
 * went missing takes the place of the last one that fit.
 */
export function limit(characters: number): Transform {
  return (tree) => {
    if (!("children" in tree)) return;

    const root = tree as Parent;
    const blocks = root.children as RootContent[];

    if (printMarkdown(tree).length <= characters) return;

    const kept: RootContent[] = [];

    for (const block of blocks) {
      const candidate = [...kept, block];
      const omitted = blocks.length - candidate.length;

      const length = printMarkdown({
        ...root,
        children: omitted > 0 ? [...candidate, omittedNote(omitted)] : candidate,
      } as Nodes).length;

      if (length > characters) break;
      kept.push(block);
    }

    const omitted = blocks.length - kept.length;
    if (omitted === 0) return;

    root.children = [
      ...kept,
      ...closeDanglingTags(kept),
      omittedNote(omitted),
    ] as typeof root.children;
  };
}

/**
 * GitHub serves `redirect.github.com` as an interstitial so quoted URLs do not create
 * cross-reference backlinks. Discord readers just want the real page.
 */
export function unredirectLinks(tree: Nodes): void {
  visitParents(tree, (parent) => {
    for (const child of parent.children as RootContent[]) {
      if (child.type !== "link" && child.type !== "definition") continue;

      // Parsed rather than string-replaced, so a lookalike host cannot slip through.
      const url = URL.parse(child.url);
      if (url?.hostname !== "redirect.github.com") continue;

      const previous = child.url;
      url.hostname = "github.com";
      child.url = url.href;

      // An autolink repeats its target as the label; leaving it stale would print
      // the old host and turn `<url>` into `[url](other)`.
      if (child.type === "link")
        for (const inner of child.children)
          if (inner.type === "text" && inner.value === previous) inner.value = child.url;
    }
  });
}

/**
 * Discord shows no inline images in message text, so badges and shields are dead
 * weight — often the longest URLs in a body. A link wrapping only an image keeps
 * the link, using its alt text as the label.
 */
export function dropImages(tree: Nodes): void {
  visitParents(tree, (parent) => {
    const kept: RootContent[] = [];

    for (const child of parent.children as RootContent[]) {
      if (child.type === "image") continue;

      if (child.type === "link") {
        const remaining = child.children.filter((inner) => inner.type !== "image");
        const alt = child.children.find((inner) => inner.type === "image")?.alt;

        kept.push({
          ...child,
          children:
            remaining.length > 0
              ? remaining
              : [{ type: "text", value: alt || child.url } as PhrasingContent],
        });
        continue;
      }

      // A paragraph that held nothing but images has nothing left to say.
      if (
        "children" in child &&
        child.children.length > 0 &&
        child.children.every((inner) => inner.type === "image")
      )
        continue;

      kept.push(child);
    }

    parent.children = kept as typeof parent.children;

    // Removing an image leaves the spaces that surrounded it on either side.
    parent.children = parent.children.reduce<typeof parent.children>((kept, child) => {
      const previous = kept.at(-1);

      if (child.type === "text" && previous?.type === "text") {
        previous.value = `${previous.value}${child.value}`.replace(/[ \t]{2,}/g, " ");
        return kept;
      }

      return [...kept, child];
    }, []);
  });
}

/**
 * A body's later sections are its detail — release notes, configuration, checklists. The
 * first heading that follows real content starts them, so everything from there is dropped.
 * Headings the body opens with are its own title and survive.
 */
export function leadingSection(tree: Nodes): void {
  if (!("children" in tree)) return;

  const blocks = (tree as Parent).children as RootContent[];
  let seenContent = false;

  for (const [index, block] of blocks.entries()) {
    if (block.type === "heading") {
      if (!seenContent) continue;

      (tree as Parent).children = blocks.slice(0, index) as typeof tree.children;
      return;
    }

    seenContent = true;
  }
}

/**
 * A cell has nowhere to put an image: no gallery reaches inside a row, and Discord prints
 * `![age](url)` as the literal `!age`. Badges are decoration, so the cell keeps its words.
 */
function cellContent(cell: { children: PhrasingContent[] } | undefined): PhrasingContent[] {
  const kept = (cell?.children ?? []).filter((child) => {
    if (child.type === "image") return false;

    return !(
      child.type === "link" &&
      child.children.length > 0 &&
      child.children.every((inner) => inner.type === "image")
    );
  });

  if (!kept.some((child) => child.type !== "text" || child.value.trim())) return [];

  // A removed badge leaves whitespace behind, which the printer would escape as `&#x20;`.
  const first = kept.at(0);
  if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");

  const last = kept.at(-1);
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");

  return kept.filter((child) => child.type !== "text" || child.value);
}

/** Both ways of losing a table, so a message can pick one. */
export const tableFormats = { flat: flattenTables, list: listTables } satisfies Record<
  string,
  Transform
>;

export type TableFormat = keyof typeof tableFormats;

export let tableFormat: TableFormat = "list";

export function setTableFormat(format: TableFormat) {
  tableFormat = format;
}

/** Defers to {@link tableFormat}, so the choice travels with the message rather than the caller. */
export function formatTables(tree: Nodes): void {
  tableFormats[tableFormat](tree);
}

/**
 * The other way to lose a table: each row becomes a bullet led by its first column,
 * with the remaining cells nested beneath it as their own items. Taller than
 * {@link flattenTables}, but a row with many columns stays readable.
 */
export function listTables(tree: Nodes): void {
  visitParents(tree, (parent) => {
    parent.children = parent.children.flatMap((child) => {
      if (child.type !== "table") return [child];

      const [header, ...rows] = (child as Table).children;
      const labels = header?.children.map(cellText) ?? [];

      const items = rows.map((row): ListItem => {
        const [lead, ...rest] = row.children;

        const nested = rest.flatMap((cell, column): ListItem[] => {
          const content = cellContent(cell);
          if (content.length === 0) return [];

          const label = labels[column + 1];

          return [
            {
              type: "listItem",
              spread: false,
              children: [
                {
                  type: "paragraph",
                  children: [
                    ...(label
                      ? ([
                          { type: "strong", children: [{ type: "text", value: `${label}:` }] },
                          { type: "text", value: " " },
                        ] as PhrasingContent[])
                      : []),
                    ...content,
                  ],
                },
              ],
            },
          ];
        });

        return {
          type: "listItem",
          spread: false,
          children: [
            { type: "paragraph", children: [{ type: "strong", children: cellContent(lead) }] },
            ...(nested.length > 0
              ? [{ type: "list", ordered: false, spread: false, children: nested } as const]
              : []),
          ],
        };
      });

      return [{ type: "list", ordered: false, spread: false, children: items } as RootContent];
    }) as typeof parent.children;
  });
}

/**
 * Discord has no table support, so each row becomes one line: the first column
 * leads in bold, and the rest are labelled with their headers.
 */
export function flattenTables(tree: Nodes): void {
  visitParents(tree, (parent) => {
    parent.children = parent.children.flatMap((child) => {
      if (child.type !== "table") return [child];

      const [header, ...rows] = (child as Table).children;
      const labels = header?.children.map(cellText) ?? [];

      const rendered = rows.flatMap((row, index): PhrasingContent[] => {
        const [lead, ...rest] = row.children;

        const described = rest.flatMap((cell, column): PhrasingContent[] => {
          const content = cellContent(cell);
          if (content.length === 0) return [];

          const label = labels[column + 1];
          return [
            { type: "text", value: `${label ? `${label}: ` : ""}` },
            ...content,
            { type: "text", value: " • " },
          ];
        });

        // Trailing separator belongs between cells, not after the last one.
        if (described.at(-1)?.type === "text") described.pop();

        return [
          ...(index > 0 ? [{ type: "break" } as PhrasingContent] : []),
          { type: "strong", children: cellContent(lead) },
          ...(described.length > 0
            ? [{ type: "text", value: " — " } as PhrasingContent, ...described]
            : []),
        ];
      });

      // One paragraph keeps the rows on consecutive lines rather than spaced apart.
      return [{ type: "paragraph", children: rendered } as RootContent];
    }) as typeof parent.children;
  });
}
