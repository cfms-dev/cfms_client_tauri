import { describe, expect, it } from 'vitest';
import {
  dispatchKeyboardCommand,
  fileManagerShortcutFor,
  formatShortcut,
  registerKeyboardCommands,
  shortcutMatches,
} from './keyboard';

function key(key: string, modifiers: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...modifiers });
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

describe('keyboard command registry', () => {
  it('maps the primary modifier for Windows and macOS', () => {
    const windowsEvent = key('1', { ctrlKey: true });
    const macEvent = key('1', { metaKey: true });
    expect(shortcutMatches(windowsEvent, { key: '1', primary: true }, false)).toBe(true);
    expect(shortcutMatches(macEvent, { key: '1', primary: true }, true)).toBe(true);
    expect(shortcutMatches(windowsEvent, { key: '1', primary: true }, true)).toBe(false);
    expect(formatShortcut({ key: '/', primary: true }, false)).toBe('Ctrl+/');
    expect(formatShortcut({ key: '/', primary: true }, true)).toBe('⌘/');
  });

  it('dispatches the highest-priority active scope', () => {
    const calls: string[] = [];
    const unregisterGlobal = registerKeyboardCommands({
      id: 'test.global', label: 'Global', shortcuts: [{ key: 'F5' }], scope: 'global',
      handler: () => { calls.push('global'); },
    });
    const unregisterPage = registerKeyboardCommands({
      id: 'test.page', label: 'Page', shortcuts: [{ key: 'F5' }], scope: 'page',
      handler: () => { calls.push('page'); },
    });

    const event = key('F5');
    expect(dispatchKeyboardCommand(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(calls).toEqual(['page']);
    unregisterPage();
    unregisterGlobal();
  });

  it('preserves text editing unless a command explicitly opts in', () => {
    const calls: string[] = [];
    const unregisterBlocked = registerKeyboardCommands({
      id: 'test.blocked', label: 'Blocked', shortcuts: [{ key: 'k', primary: true }], scope: 'page',
      handler: () => { calls.push('blocked'); },
    });
    const unregisterAllowed = registerKeyboardCommands({
      id: 'test.allowed', label: 'Allowed', shortcuts: [{ key: '/', primary: true }], scope: 'global',
      allowInEditable: true,
      handler: () => { calls.push('allowed'); },
    });
    const input = document.createElement('input');
    document.body.append(input);
    input.addEventListener('keydown', (event) => dispatchKeyboardCommand(event));

    input.dispatchEvent(key('k', { ctrlKey: true, bubbles: true }));
    input.dispatchEvent(key('/', { ctrlKey: true, bubbles: true }));
    expect(calls).toEqual(['allowed']);

    unregisterAllowed();
    unregisterBlocked();
    input.remove();
  });
});
