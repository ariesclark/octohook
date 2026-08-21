/**
 * What Discord will accept in one message. A renderer should not have to think about this: it
 * says what the event means, and delivery makes that fit — splitting into as many messages as
 * the limits demand, the way {@link ../merge} already chunks a batch.
 */

export const maximumComponents = 40;
export const maximumCharacters = 4000;

export type MessageComponent = {
  content?: string;
  components?: MessageComponent[];
  accessory?: MessageComponent;
};

export function flattenComponents(components: MessageComponent[]): MessageComponent[] {
  return components.flatMap((component) => [
    component,
    ...flattenComponents(component.components ?? []),
    ...flattenComponents(component.accessory ? [component.accessory] : []),
  ]);
}

export function componentCount(components: MessageComponent[]): number {
  return flattenComponents(components).length;
}

export function characterCount(components: MessageComponent[]): number {
  return flattenComponents(components).reduce(
    (total, { content }) => total + (content?.length ?? 0),
    0,
  );
}

/**
 * As many messages as it takes, splitting only between top-level components — a quote torn in
 * half is worse than a second message. A component too big to fit alone still gets its own
 * message and is left to Discord to reject, since silently dropping it would be worse.
 */
export function splitComponents(
  components: MessageComponent[],
  /** Lower than the ceiling when the caller means to add a line of its own to each message. */
  budget: number = maximumCharacters,
): MessageComponent[][] {
  const messages: MessageComponent[][] = [];

  let current: MessageComponent[] = [];
  let count = 0;
  let characters = 0;

  for (const component of components) {
    const componentSize = componentCount([component]);
    const characterSize = characterCount([component]);

    if (
      current.length > 0 &&
      (count + componentSize > maximumComponents || characters + characterSize > budget)
    ) {
      messages.push(current);
      current = [];
      count = 0;
      characters = 0;
    }

    current.push(component);
    count += componentSize;
    characters += characterSize;
  }

  if (current.length > 0) messages.push(current);
  return messages;
}
