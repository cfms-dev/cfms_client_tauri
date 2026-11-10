import type { Action } from 'svelte/action';

// Checkable Fluent controls distinguish their disabled property from the
// disabled HTML attribute. Set the attribute so connectedCallback cannot reset
// an initially disabled control when Svelte upgrades/connects it.
export const disabledAttribute: Action<HTMLElement, boolean> = (node, disabled) => {
  node.toggleAttribute('disabled', disabled);
  return { update(value) { node.toggleAttribute('disabled', value); } };
};
