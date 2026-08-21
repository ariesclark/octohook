import {
  ComponentType,
  MessageFlags,
  type APIComponentInContainer,
  type APIComponentInMessageActionRow,
  type APIMessageTopLevelComponent,
  type APISectionAccessoryComponent,
} from "discord-api-types/v10";

import {
  Fragment,
  flattenChildren,
  markdownElements,
  type Children,
  type MarkdownElements,
  type PropsWithChildren,
} from "@ariesclark/markdown-jsx";

import type { WebhookContent, WebhookFile } from "./types.ts";

export { Fragment, flattenChildren, type Children, type PropsWithChildren };

export const tagOverrides = {
  TextDisplay: "text",
  MediaGallery: "gallery",
} as const satisfies Partial<Record<keyof typeof ComponentType, string>>;

const componentTypeByTag = Object.fromEntries(
  Object.entries(ComponentType)
    .filter((entry): entry is [string, ComponentType] => typeof entry[1] === "number")
    .map(([name, type]) => [
      (tagOverrides as Partial<Record<string, string>>)[name] ?? name.toLowerCase(),
      type,
    ]),
);

const childrenSlots: Partial<Record<ComponentType, "components" | "items" | "content">> = {
  [ComponentType.ActionRow]: "components",
  [ComponentType.Container]: "components",
  [ComponentType.Section]: "components",
  [ComponentType.MediaGallery]: "items",
  [ComponentType.TextDisplay]: "content",
};

function messageElement({
  files,
  children,
  ...rest
}: PropsWithChildren<MessageProps>): WebhookContent {
  return {
    ...rest,
    flags: MessageFlags.IsComponentsV2,
    components: flattenChildren<APIMessageTopLevelComponent>(children),
    files,
  };
}

export function intrinsic(
  tag: string,
  props: PropsWithChildren<Record<string, unknown>>,
): unknown {
  if (tag === "message") return messageElement(props);

  const renderMarkdown = markdownElements[tag];
  if (renderMarkdown) return renderMarkdown(props as never);

  const type = componentTypeByTag[tag];
  if (type === undefined) throw new Error(`unknown intrinsic element <${tag}>`);

  const { children, ...rest } = props;
  const component: Record<string, unknown> = { type, ...rest };

  const slot = childrenSlots[type];
  if (slot === "content") component.content = flattenChildren<unknown>(children).join("");
  else if (slot && children !== undefined) component[slot] = flattenChildren(children);

  return component;
}

export function jsx<Props>(type: ((props: Props) => unknown) | string, props: Props): unknown {
  return typeof type === "string"
    ? intrinsic(type, props as PropsWithChildren<Record<string, unknown>>)
    : type(props);
}

export const jsxs = jsx;

export type AnyComponent =
  | APIMessageTopLevelComponent
  | APIComponentInContainer
  | APIComponentInMessageActionRow
  | APISectionAccessoryComponent;

export type ComponentName = keyof typeof ComponentType;

export type TagOf<Name extends ComponentName> = Name extends keyof typeof tagOverrides
  ? (typeof tagOverrides)[Name]
  : Lowercase<Name>;

export type ComponentOf<Name extends ComponentName> = Extract<
  AnyComponent,
  { type: (typeof ComponentType)[Name] }
>;

export type DerivedProps<Component> = Component extends unknown
  ? Omit<Component, "type" | "id" | "components" | "items" | "content"> &
      (Component extends { components: unknown } | { items: unknown } | { content: unknown }
        ? Children
        : object)
  : never;

export type MessageProps = Children & {
  files?: WebhookFile[];
  username?: string;
  avatar_url?: string;
};

type DerivedElements = {
  [Name in ComponentName as [ComponentOf<Name>] extends [never]
    ? never
    : TagOf<Name>]: DerivedProps<ComponentOf<Name>>;
};

interface MessageElements {
  message: MessageProps;
}

export namespace JSX {
  export type Element = any;

  export type IntrinsicElements = DerivedElements & MarkdownElements & MessageElements;

  export interface ElementChildrenAttribute {
    children: object;
  }
}
