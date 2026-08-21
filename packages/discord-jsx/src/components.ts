import {
  intrinsic,
  tagOverrides,
  type ComponentName,
  type ComponentOf,
  type DerivedProps,
  type MessageProps,
} from "./jsx-runtime.ts";
import type { WebhookContent } from "./types.ts";

type DiscordComponents = {
  [Name in ComponentName as [ComponentOf<Name>] extends [never] ? never : Name]: (
    props: DerivedProps<ComponentOf<Name>>,
  ) => ComponentOf<Name>;
} & {
  Message: (props: MessageProps) => WebhookContent;
};

function tagFor(name: string): string {
  return (tagOverrides as Partial<Record<string, string>>)[name] ?? name.toLowerCase();
}

export const components = new Proxy({} as DiscordComponents, {
  get(_, name: string) {
    return (props: object) => intrinsic(tagFor(name), props as never);
  },
});

export const {
  ActionRow,
  Button,
  Container,
  File,
  MediaGallery,
  Message,
  Section,
  Separator,
  TextDisplay,
  Thumbnail,
} = components;
