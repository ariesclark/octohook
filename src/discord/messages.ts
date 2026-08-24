import { MessageFormat } from "messageformat";

import catalogue from "../../messages/en-US.json" with { type: "json" };

export type Phrase = keyof typeof catalogue;

const locale = "en-US";

const formatters = new Map<Phrase, MessageFormat>();

function formatter(name: Phrase): MessageFormat {
  const known = formatters.get(name);
  if (known) return known;

  // MessageFormat wraps values in bidi isolating characters by default, which arrive in Discord
  // as invisible control codes in the middle of a link.
  const made = new MessageFormat(locale, catalogue[name], { bidiIsolation: "none" });
  formatters.set(name, made);

  return made;
}

export function t(name: Phrase, values: Record<string, number | string> = {}): string {
  return formatter(name).format(values);
}

export const phrases = Object.keys(catalogue) as Phrase[];

/** GitHub adds conclusions, states and triggers without warning, so an unknown one is repeated. */
export function tOf(prefix: string, key: string | null | undefined, fallback = ""): string {
  if (!key) return fallback;

  const name = `${prefix}.${key}` as Phrase;
  return name in catalogue ? t(name) : key;
}
