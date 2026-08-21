import { markdownElements, type MarkdownElements } from "./elements.ts";

export {
  Fragment,
  flattenChildren,
  markdownElements,
  type Children,
  type MarkdownElements,
  type PropsWithChildren,
} from "./elements.ts";

export function jsx<Props>(type: ((props: Props) => unknown) | string, props: Props): unknown {
  if (typeof type !== "string") return type(props);

  const render = markdownElements[type];
  if (!render) throw new Error(`unknown intrinsic element <${type}>`);

  return render(props as never);
}

export const jsxs = jsx;

export namespace JSX {
  export type Element = any;

  export interface IntrinsicElements extends MarkdownElements {}

  export interface ElementChildrenAttribute {
    children: object;
  }
}
