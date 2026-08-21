import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import type {
  APIActionRowComponent,
  APIButtonComponentWithURL,
  APIMediaGalleryComponent,
  APISeparatorComponent,
  APITextDisplayComponent,
} from "discord-api-types/v10";
import { parseDocument } from "htmlparser2";
import type { Element } from "domhandler";
import type { Nodes, Parent, RootContent } from "mdast";

import { parseMarkdown, printMarkdown, type Transform } from "./transform.ts";

export type MarkdownComponent =
  | APITextDisplayComponent
  | APISeparatorComponent
  | APIMediaGalleryComponent
  | APIActionRowComponent<APIButtonComponentWithURL>;

const divider: APISeparatorComponent = {
  type: ComponentType.Separator,
  divider: true,
  spacing: 1,
};

/** Raw html is opaque to markdown, so `<img>` needs parsing rather than pattern matching. */
function htmlImageSources(value: string): string[] {
  const sources: string[] = [];

  const walk = (nodes: ReturnType<typeof parseDocument>["children"]): void => {
    for (const node of nodes) {
      const element = node as Element;
      if (element.name === "img" && element.attribs?.src) sources.push(element.attribs.src);
      if (element.children?.length) walk(element.children);
    }
  };

  walk(parseDocument(value).children);
  return sources;
}

/** Discord truncates past this, and a button labelled with an essay helps nobody. */
const labelLimit = 80;

/**
 * A link whose whole visible content is an image is a button in everything but markup —
 * a shield, a badge, a "click here". Discord has that as a component.
 */
function linkButtons(block: RootContent): APIButtonComponentWithURL[] | undefined {
  if (block.type !== "paragraph" || block.children.length === 0) return undefined;

  const links = block.children.filter((child) => child.type !== "text" || child.value.trim());
  if (links.length === 0) return undefined;

  const buttons: APIButtonComponentWithURL[] = [];

  for (const child of links) {
    if (child.type !== "link") return undefined;
    if (child.children.length === 0 || !child.children.every((inner) => inner.type === "image"))
      return undefined;

    const alt = child.children.find((inner) => inner.type === "image")?.alt?.trim();
    const label = alt || URL.parse(child.url)?.hostname || "Open";

    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      url: child.url,
      label: label.length > labelLimit ? `${label.slice(0, labelLimit - 1)}…` : label,
    });
  }

  return buttons;
}

/** Only a block that is nothing but images is content; an image beside text is decoration. */
function imageSources(block: RootContent): string[] | undefined {
  if (block.type === "html") {
    // An `<img>` without a source cannot render anywhere; printing its markup is worse.
    const isOnlyImages = parseDocument(block.value).children.every(
      (node) => (node as Element).name === "img" || !(node as { data?: string }).data?.trim(),
    );

    return isOnlyImages ? htmlImageSources(block.value) : undefined;
  }

  if (block.type !== "paragraph" || block.children.length === 0) return undefined;

  return block.children.every((child) => child.type === "image")
    ? block.children.map((child) => (child as { url: string }).url)
    : undefined;
}

function textComponent(blocks: RootContent[], root: Parent): APITextDisplayComponent | undefined {
  if (blocks.length === 0) return undefined;

  const content = printMarkdown({ ...root, children: blocks } as Nodes);
  if (!content.trim()) return undefined;

  return { type: ComponentType.TextDisplay, content };
}

/**
 * A message is a component tree, not one blob of text: a thematic break becomes a real
 * separator, and images Discord would otherwise print as markup become a gallery.
 */
export function toComponents(body: string, transforms: Transform[] = []): MarkdownComponent[] {
  const tree = parseMarkdown(body);
  for (const transform of transforms) transform(tree);

  if (!("children" in tree)) return [];

  const root = tree as Parent;
  const components: MarkdownComponent[] = [];

  let pending: RootContent[] = [];
  let images: string[] = [];
  let buttons: APIButtonComponentWithURL[] = [];

  const flushText = () => {
    const text = textComponent(pending, root);
    pending = [];

    if (text) components.push(text);
    return Boolean(text);
  };

  const flushButtons = () => {
    if (buttons.length === 0) return;

    // Discord fits five buttons to a row.
    for (let index = 0; index < buttons.length; index += 5)
      components.push({
        type: ComponentType.ActionRow,
        components: buttons.slice(index, index + 5),
      });

    buttons = [];
  };

  const flushImages = () => {
    if (images.length === 0) return;

    components.push({
      type: ComponentType.MediaGallery,
      items: images.map((url) => ({ media: { url } })),
    });
    images = [];
  };

  for (const block of root.children as RootContent[]) {
    const row = linkButtons(block);

    if (row) {
      flushText();
      flushImages();
      buttons.push(...row);
      continue;
    }

    flushButtons();

    const sources = imageSources(block);

    if (sources) {
      flushText();
      images.push(...sources);
      continue;
    }

    flushImages();

    if (block.type !== "thematicBreak") {
      pending.push(block);
      continue;
    }

    // A divider only means something between two pieces of content.
    if (components.length === 0 && pending.length === 0) continue;
    if (flushText() || components.length > 0) components.push(divider);
  }

  flushButtons();
  flushImages();
  const trailing = flushText();

  if (!trailing && components.at(-1)?.type === ComponentType.Separator) components.pop();

  return components;
}
