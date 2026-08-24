import { writeFileSync } from "node:fs";

import type { MessageComponent } from "./discord/limits.ts";

export type Message = {
  id: string;
  username?: string;
  components: MessageComponent[];
  edits: number;
  at: string;
};

const marks: Record<string, string> = {
  ":small_blue_diamond:": "🔹",
  ":small_red_triangle:": "🔺",
  ":small_red_triangle_down:": "🔻",
  ":small_orange_diamond:": "🔸",
  ":black_small_square:": "▪️",
  ":white_small_square:": "▫️",
};

function toMarkdown(components: MessageComponent[]): string {
  const lines: string[] = [];

  const walk = (list: MessageComponent[]) => {
    for (const component of list) {
      if (component.content) lines.push(component.content);
      walk(component.components ?? []);
      walk(component.accessory ? [component.accessory] : []);
    }
  };

  walk(components);

  const rendered = lines
    .join("\n")
    .split("\n")
    .map((line) => {
      const marked = Object.entries(marks).reduce(
        (text, [shortcode, emoji]) => text.replaceAll(shortcode, emoji),
        line,
      );

      // Discord indents a line inside a quote with spaces and keeps them; markdown throws them
      // away.
      const nested = marked.replace(/^> {2,}/, "> > ");

      // `-# ` is Discord's small text and means nothing to markdown.
      if (nested.startsWith("-# ")) return `_${nested.slice(3)}_`;
      if (nested.startsWith("> -# ")) return `> _${nested.slice(5)}_`;
      if (nested.startsWith("> > -# ")) return `> > _${nested.slice(7)}_`;

      return nested;
    });

  // Markdown folds newlines into one paragraph unless each line ends in two spaces, and a quote
  // swallows the line after it.
  const spaced: string[] = [];

  for (const [index, line] of rendered.entries()) {
    const previous = rendered[index - 1];
    if (previous?.startsWith("> ") && !line.startsWith("> ")) spaced.push("");

    spaced.push(line.length > 0 ? `${line}  ` : line);
  }

  return spaced.join("\n");
}

export function fileTransport(path: string, title: string) {
  const messages: Message[] = [];
  let next = 0;

  const write = () => {
    const body = messages
      .map(
        (message) =>
          `### ${message.id} · ${message.username ?? "webhook"} · ${message.at}` +
          `${message.edits > 0 ? ` · edited ×${message.edits}` : ""}\n\n` +
          `${toMarkdown(message.components)}\n`,
      )
      .join("\n---\n\n");

    writeFileSync(path, `# ${title}\n\n${messages.length} messages\n\n---\n\n${body}`);
  };

  write();

  return {
    split: (components: MessageComponent[], _budget?: number) =>
      components.length > 0 ? [components] : [],

    async send(
      content: { components?: unknown[]; username?: unknown },
      messageId?: string,
      at = "",
    ): Promise<string> {
      const components = (content.components ?? []) as MessageComponent[];
      const username = typeof content.username === "string" ? content.username : undefined;

      const existing = messages.find((message) => message.id === messageId);

      if (existing) {
        existing.components = components;
        existing.username = username ?? existing.username;
        existing.edits += 1;
        write();

        return existing.id;
      }

      const id = `m${++next}`;
      messages.push({ id, username, components, edits: 0, at });
      write();

      return id;
    },

    async remove(messageId: string) {
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;

      messages.splice(index, 1);
      write();
    },
  };
}
