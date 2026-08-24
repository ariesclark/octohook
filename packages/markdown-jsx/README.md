# @ariesclark/markdown-jsx

Write Discord-flavored markdown with JSX. Elements evaluate directly to plain strings: no
virtual DOM, no reconciler, no dependencies.

```tsx
const line = (
  <b>
    <a href="https://github.com/ariesclark/octohook">Octohook</a>
  </b>
);
// "**[Octohook](https://github.com/ariesclark/octohook)**"
```

## Consuming as intrinsics

Point your `jsxImportSource` at this package and the elements become lowercase tags, typed via
`JSX.IntrinsicElements`:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@ariesclark/markdown-jsx"
  }
}
```

```tsx
const changelog = (
  <>
    <h2>What changed</h2>
    <br />
    fixed <code>escaped</code> backticks — see <a href={compareUrl}>the diff</a>
    <br />
    <small>released by {sender}</small>
  </>
);
```

A fragment whose children are all strings or numbers joins into a single string, so composing
lines with `<br />` between them just works.

## Consuming as imports

Most elements are also exported as a PascalCase component, a plain function from props to a
string, usable under any JSX runtime (including React) or with no JSX at all:

```ts
import { Bold, Code, Link, Subtext } from "@ariesclark/markdown-jsx";

Bold({ children: Link({ href: url, children: "repo" }) }); // "**[repo](url)**"
Subtext({ children: "variant: classic" }); // "-# variant: classic"
```

## Elements

| Intrinsic   | Import      | Output              |
| ----------- | ----------- | ------------------- |
| `b`         | `Bold`      | `**…**`             |
| `i`         | `Italic`    | `*…*`               |
| `u`         | `Underline` | `__…__`             |
| `s`         | `Strike`    | `~~…~~`             |
| `spoiler`   | `Spoiler`   | `\|\|…\|\|`         |
| `code`      | `Code`      | `` `…` ``           |
| `codeblock` | `CodeBlock` | ` ```lang\n…\n``` ` |
| `a`         | `Link`      | `[…](href)`         |
| `h1`–`h3`   | `H1`–`H3`   | `# …` / `## …` / `### …` |
| `small`     | `Subtext`   | `-# …`              |
| `br`        | `LineBreak` | `\n`                |
| `quote`     | none        | `> …` on every line |
| `time`      | none        | `<t:1755740000:R>`  |

`quote` and `time` are intrinsics only. `time` takes `at` (a `string`, `number`, or `Date`) and
an optional `format`, one of Discord's `t T d D f F R`, defaulting to `R`.

## Caveats

- JSX whitespace rules apply when using intrinsics: spaces between elements across line breaks
  need an explicit `{" "}`, and newlines are `<br />`. Indentation-only lines are trimmed.
- Nothing is escaped: children are joined verbatim, so sanitize untrusted input (backticks
  inside `code`, brackets inside link text) yourself.
