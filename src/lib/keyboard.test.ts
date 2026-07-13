import { describe, expect, it } from 'vitest';
import { fileManagerShortcutFor } from './keyboard';

function key(key: string, modifiers: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, ...modifiers });
}

describe('fileManagerShortcutFor', () => {
  it.each([
    ['Backspace', {}, 'go-parent'],
    ['ArrowUp', { altKey: true }, 'go-parent'],
    ['F5', {}, 'refresh'],
    ['r', { ctrlKey: true }, 'refresh'],
    ['r', { metaKey: true }, 'refresh'],
    ['n', { ctrlKey: true, shiftKey: true }, 'create-folder'],
    ['a', { ctrlKey: true }, 'select-all'],
    ['Escape', {}, 'clear-selection'],
    ['Delete', {}, 'delete-selection'],
    ['F2', {}, 'rename-selection'],
  ] as const)('maps %s to %s', (eventKey, modifiers, action) => {
    expect(fileManagerShortcutFor(key(eventKey, modifiers))).toBe(action);
  });

  it.each([
    ['Backspace', { ctrlKey: true }],
    ['ArrowUp', {}],
    ['r', { ctrlKey: true, shiftKey: true }],
    ['n', { ctrlKey: true }],
    ['a', { altKey: true, ctrlKey: true }],
  ] as const)('ignores modified or unrelated shortcut %s', (eventKey, modifiers) => {
    expect(fileManagerShortcutFor(key(eventKey, modifiers))).toBeNull();
  });
});
