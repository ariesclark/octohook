export { Fragment, type JSX, type PropsWithChildren } from "./jsx-runtime.ts";
import { jsx } from "./jsx-runtime.ts";

export function jsxDEV<Props>(type: ((props: Props) => unknown) | string, props: Props): unknown {
  return jsx(type, props);
}
