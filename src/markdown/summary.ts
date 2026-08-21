import { toString } from "mdast-util-to-string";
import type { List, Nodes, Parent, RootContent, Table } from "mdast";

import { parseMarkdown } from "./transform.ts";

/** Enough to say what a change is about without becoming the message itself. */
const defaultLength = 200;

function plain(node: Nodes): string {
  return toString(node, { includeHtml: false }).replaceAll(/\s+/g, " ").trim();
}

function isDecoration(node: RootContent | { type: string; children?: unknown[] }): boolean {
  if (node.type === "image") return true;
  if (node.type === "text") return !("value" in node) || !String(node.value).trim();

  return (
    node.type === "link" &&
    Array.isArray(node.children) &&
    node.children.length > 0 &&
    (node.children as { type: string }[]).every((child) => child.type === "image")
  );
}

/** Each row as its leading cell, then the remaining cells under their column headings. */
function tableText(table: Table): string {
  const [header, ...rows] = table.children;
  const labels = header?.children.map(plain) ?? [];

  return rows
    .map((row) => {
      const [lead, ...rest] = row.children;

      const described = rest
        .map((cell, column) => {
          const value = plain(cell);
          if (!value) return "";

          const label = labels[column + 1];
          return label ? `${label}: ${value}` : value;
        })
        .filter(Boolean)
        .join(" • ");

      const leadText = lead ? plain(lead) : "";
      return described ? `${leadText} — ${described}` : leadText;
    })
    .filter(Boolean)
    .join("; ");
}

function listText(list: List): string {
  return list.children.map(plain).filter(Boolean).join("; ");
}

function blockText(block: RootContent): string {
  if (block.type === "table") return tableText(block);
  if (block.type === "list") return listText(block);

  return "";
}

function clip(text: string, characters: number): string {
  if (text.length <= characters) return text;

  const clipped = text.slice(0, characters - 1);
  const boundary = clipped.lastIndexOf(" ");

  return `${(boundary > 0 ? clipped.slice(0, boundary) : clipped).trimEnd()}…`;
}

/**
 * Bodies open with whatever the author or their tooling put first — a badge, a heading,
 * a template's boilerplate table. The summary is the first real sentence beneath that,
 * as plain text: formatting competes with the message that carries it.
 *
 * A paragraph ending in a colon only promises what comes next, so the block it introduces
 * is folded in behind it; on its own it would describe nothing.
 */
export function summarise(body: string, characters = defaultLength): string | undefined {
  if (!body.trim()) return undefined;

  const tree = parseMarkdown(body);
  if (!("children" in tree)) return undefined;

  const blocks = (tree as Parent).children as RootContent[];

  for (const [index, block] of blocks.entries()) {
    if (block.type !== "paragraph") continue;
    // A badge carries alt text, which reads as prose but says nothing about the change.
    if (block.children.every(isDecoration)) continue;

    const text = plain(block);
    if (!text) continue;

    if (!text.endsWith(":")) return clip(text, characters);

    const detail = blockText(blocks[index + 1]!);
    return clip(detail ? `${text} ${detail}` : text, characters);
  }

  // No prose at all: the structure is the content.
  for (const block of blocks) {
    const detail = blockText(block);
    if (detail) return clip(detail, characters);
  }

  return undefined;
}
