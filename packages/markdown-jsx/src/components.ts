import { markdownElements, type MarkdownElements } from "./elements.ts";

const componentTags = {
  Bold: "b",
  Italic: "i",
  Underline: "u",
  Strike: "s",
  Spoiler: "spoiler",
  Code: "code",
  CodeBlock: "codeblock",
  Link: "a",
  H1: "h1",
  H2: "h2",
  H3: "h3",
  Subtext: "small",
  LineBreak: "br",
} as const satisfies Record<string, keyof MarkdownElements>;

type MarkdownComponents = {
  [Name in keyof typeof componentTags]: (
    props: MarkdownElements[(typeof componentTags)[Name]],
  ) => string;
};

export const {
  Bold,
  Italic,
  Underline,
  Strike,
  Spoiler,
  Code,
  CodeBlock,
  Link,
  H1,
  H2,
  H3,
  Subtext,
  LineBreak,
} = Object.fromEntries(
  Object.entries(componentTags).map(([name, tag]) => [name, markdownElements[tag]]),
) as MarkdownComponents;
