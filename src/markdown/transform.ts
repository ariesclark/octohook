import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import type { ListItem, Nodes, Parent, PhrasingContent, RootContent, Table } from "mdast";

export type Transform = (tree: Nodes) => void;

export function parseMarkdown(body: string): Nodes {
  return fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

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
      // Discord reads a printed `***` as an opening bold marker, and pairs `*` bullets.
      bullet: "-",
      rule: "-",
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
        break: () => "\n",
        subtext: (node, _parent, state, info) =>
          `-# ${state.containerPhrasing(node as Subtext, info)}`,
      },
    })
      .trimEnd()
      // Discord parses neither entities nor single tildes; `<` keeps its escape, since
      // unescaping could form a mention.
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

      const rest = marker.value.replace(/^\[![A-Z]+][ \t]*/, "");
      first.children = [
        { type: "strong", children: [{ type: "text", value: label }] },
        ...(rest ? [{ type: "text", value: rest } as PhrasingContent] : []),
        ...first.children.slice(1),
      ];
    }
  });
}

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

export function lineBreaks(tree: Nodes): void {
  visitParents(tree, (parent) => {
    parent.children = parent.children.map((child) => {
      if (child.type !== "html" || !/^<br\s*\/?>$/i.test(child.value.trim())) return child;

      return { type: "break" } as RootContent;
    }) as typeof parent.children;

    for (const [index, child] of parent.children.entries()) {
      if (child.type !== "break") continue;

      const before = parent.children[index - 1];
      const after = parent.children[index + 1];

      if (before?.type === "text") before.value = before.value.replace(/[ \t]+$/, "");
      if (after?.type === "text") after.value = after.value.replace(/^[ \t]+/, "");
    }
  });
}

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

function cellText(cell: { children: PhrasingContent[] }): string {
  return printMarkdown({ type: "paragraph", children: cell.children } as Nodes).trim();
}

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

      if (child.type === "link")
        for (const inner of child.children)
          if (inner.type === "text" && inner.value === previous) inner.value = child.url;
    }
  });
}

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

      if (
        "children" in child &&
        child.children.length > 0 &&
        child.children.every((inner) => inner.type === "image")
      )
        continue;

      kept.push(child);
    }

    parent.children = kept as typeof parent.children;

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

  const first = kept.at(0);
  if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");

  const last = kept.at(-1);
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");

  return kept.filter((child) => child.type !== "text" || child.value);
}

const tableFormats = { flat: flattenTables, list: listTables } satisfies Record<string, Transform>;

export type TableFormat = keyof typeof tableFormats;

let tableFormat: TableFormat = "list";

export function formatTables(tree: Nodes): void {
  tableFormats[tableFormat](tree);
}

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

        if (described.at(-1)?.type === "text") described.pop();

        return [
          ...(index > 0 ? [{ type: "break" } as PhrasingContent] : []),
          { type: "strong", children: cellContent(lead) },
          ...(described.length > 0
            ? [{ type: "text", value: " — " } as PhrasingContent, ...described]
            : []),
        ];
      });

      return [{ type: "paragraph", children: rendered } as RootContent];
    }) as typeof parent.children;
  });
}
