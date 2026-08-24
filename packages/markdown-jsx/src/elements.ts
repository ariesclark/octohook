export type PropsWithChildren<Props = object> = Props & { children?: unknown };

export type Children = { children?: unknown };

export function flattenChildren<Child>(children: unknown): Child[] {
  if (children === null || children === undefined) return [];

  return (Array.isArray(children) ? children.flat(Infinity) : [children]).filter(
    (child) => child !== null && child !== undefined && child !== false,
  ) as Child[];
}

function text(children: unknown): string {
  return flattenChildren<unknown>(children).join("");
}

const wrapping = {
  b: "**",
  i: "*",
  u: "__",
  s: "~~",
  spoiler: "||",
  code: "`",
} as const;

const prefixed = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  small: "-# ",
} as const;

export type TimeFormat = "t" | "T" | "d" | "D" | "f" | "F" | "R";

export const markdownElements: Record<string, (props: never) => string> = {
  ...Object.fromEntries(
    Object.entries(wrapping).map(([tag, marker]) => [
      tag,
      ({ children }: PropsWithChildren) => `${marker}${text(children)}${marker}`,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(prefixed).map(([tag, prefix]) => [
      tag,
      ({ children }: PropsWithChildren) => `${prefix}${text(children)}`,
    ]),
  ),
  br: () => "\n",
  quote: ({ children }: PropsWithChildren) =>
    text(children)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
  time: ({ at, format = "R" }: { at: string | number | Date; format?: TimeFormat }) =>
    `<t:${Math.floor(new Date(at).getTime() / 1000)}:${format}>`,
  a: ({ href, children }: PropsWithChildren<{ href: string }>) => `[${text(children)}](${href})`,
  codeblock: ({ language = "", children }: PropsWithChildren<{ language?: string }>) =>
    `\`\`\`${language}\n${text(children)}\n\`\`\``,
};

export interface MarkdownElements {
  b: Children;
  i: Children;
  u: Children;
  s: Children;
  spoiler: Children;
  code: Children;
  codeblock: Children & { language?: string };
  a: Children & { href: string };
  h1: Children;
  h2: Children;
  h3: Children;
  small: Children;
  br: object;
  quote: Children;
  time: { at: string | number | Date; format?: TimeFormat };
}

export function Fragment({ children }: PropsWithChildren): unknown {
  const flattened = flattenChildren<unknown>(children);

  return flattened.every((child) => typeof child === "string" || typeof child === "number")
    ? flattened.join("")
    : flattened;
}
