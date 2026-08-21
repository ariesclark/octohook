import { MessageFormat } from "messageformat";

import catalogue from "../../messages/en-US.json" with { type: "json" };

/**
 * Everything the log says in words, kept where a translator can find it rather than spread
 * through the code that needed it. A sentence assembled from fragments only reads in the
 * language it was written in: which plural form to use, where a number goes, whether "3 of 4"
 * is even that order — all of it belongs to the message, not to the caller.
 *
 * `messages/<locale>.json` holds MessageFormat 2 sources. A `.match` is spelled out wherever a
 * form varies, including where English happens not to, so a translation has somewhere to put
 * forms English does not need.
 */

export type Phrase = keyof typeof catalogue;

/** The reader's language, not the repository's — named in one place for the day there are two. */
const locale = "en-US";

/**
 * One formatter per phrase, built the first time that phrase is said and kept. Parsing a message
 * is not free and a worker starts cold often, so the ones a delivery never reaches never cost
 * anything; the ones it does are parsed once for the life of the isolate.
 */
const formatters = new Map<Phrase, MessageFormat>();

function formatter(name: Phrase): MessageFormat {
  const known = formatters.get(name);
  if (known) return known;

  const made = new MessageFormat(locale, catalogue[name]);
  formatters.set(name, made);

  return made;
}

/**
 * What the log says. A phrase with nothing to fill in still goes through here: a word like
 * "passed" is as much a translation as a sentence is.
 */
export function t(name: Phrase, values: Record<string, number> = {}): string {
  return formatter(name).format(values);
}

/** Every phrase in the catalogue, for a caller that means to check them all. */
export const phrases = Object.keys(catalogue) as Phrase[];

/**
 * A phrase chosen by something GitHub said — a conclusion, a state, a trigger. GitHub adds to
 * these lists without warning, and an unknown one is repeated exactly as it arrived: a word the
 * catalogue has no phrase for is GitHub's, and tidying it up would be inventing a translation.
 */
export function tOf(prefix: string, key: string | null | undefined, fallback = ""): string {
  if (!key) return fallback;

  const name = `${prefix}.${key}` as Phrase;
  return name in catalogue ? t(name) : key;
}
