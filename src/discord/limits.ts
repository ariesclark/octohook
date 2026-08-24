export const maximumComponents = 40;
export const maximumCharacters = 4000;

export type MessageComponent = {
  content?: string;
  components?: MessageComponent[];
  accessory?: MessageComponent;
};

function flattenComponents(components: MessageComponent[]): MessageComponent[] {
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

export function splitComponents(
  components: MessageComponent[],
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
