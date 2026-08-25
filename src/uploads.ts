type Component = {
  type?: number;
  accessory?: { media?: { url?: string } };
  components?: Component[];
  [key: string]: unknown;
};

type Content = { attachments?: unknown; components?: Component[]; [key: string]: unknown };

function uploaded(component: Component): boolean {
  return Boolean(component.accessory?.media?.url?.startsWith("attachment://"));
}

function without(components: Component[]): Component[] {
  return components.flatMap((component) => {
    const inner = component.components ? without(component.components) : undefined;

    // A section is only there to sit beside its thumbnail, so what it held stands on its own.
    if (uploaded(component)) return inner ?? [];

    return [{ ...component, ...(inner ? { components: inner } : {}) }];
  });
}

/**
 * The channel keeps a rendered message and sends it as JSON, so a file that came with it is gone
 * by then. Discord answers 400 to an `attachments` entry with nothing behind it.
 */
export function withoutUploads<T extends Content>(content: T): T {
  if (!content.attachments) return content;

  const { attachments, ...rest } = content;
  void attachments;

  return {
    ...rest,
    ...(content.components ? { components: without(content.components) } : {}),
  } as T;
}
