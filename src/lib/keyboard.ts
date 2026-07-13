import { readable } from 'svelte/store';

export type KeyboardScope = 'global' | 'page' | 'modal' | 'menu';
export type KeyboardRegion = 'navigation' | 'toolbar' | 'main' | 'details';

export interface ShortcutSpec {
  key: string;
  primary?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface KeyboardCommand {
  id: string;
  label: string | (() => string);
  shortcuts: readonly ShortcutSpec[];
  scope: KeyboardScope;
  group?: string | (() => string);
  priority?: number;
  enabled?: boolean | (() => boolean);
  allowInEditable?: boolean;
  allowInModal?: boolean;
  allowInMenu?: boolean;
  repeatable?: boolean;
  preventDefault?: boolean;
  handler: (event: KeyboardEvent) => void | Promise<void>;
}

export interface KeyboardMenuAnchor {
  x: number;
  y: number;
  sourceElement: HTMLElement | null;
}

interface RegisteredCommand extends KeyboardCommand {
  registrationOrder: number;
  registrationId: number;
}

const SCOPE_PRIORITY: Record<KeyboardScope, number> = {
  global: 0,
  page: 100,
  modal: 200,
  menu: 300,
};

let nextRegistrationId = 1;
let nextRegistrationOrder = 1;
const registeredCommands = new Map<number, RegisteredCommand>();
const commandSubscribers = new Set<(commands: KeyboardCommand[]) => void>();

export const keyboardCommands = readable<KeyboardCommand[]>([], (set) => {
  const subscriber = (commands: KeyboardCommand[]) => set(commands);
  commandSubscribers.add(subscriber);
  subscriber(getRegisteredKeyboardCommands());
  return () => commandSubscribers.delete(subscriber);
});

export function registerKeyboardCommands(
  commands: KeyboardCommand | readonly KeyboardCommand[],
): () => void {
  const registrations = (Array.isArray(commands) ? commands : [commands]).map((command) => {
    const registrationId = nextRegistrationId++;
    registeredCommands.set(registrationId, {
      ...command,
      registrationId,
      registrationOrder: nextRegistrationOrder++,
    });
    return registrationId;
  });
  notifyCommandSubscribers();

  return () => {
    for (const registrationId of registrations) registeredCommands.delete(registrationId);
    notifyCommandSubscribers();
  };
}

export function getRegisteredKeyboardCommands(): KeyboardCommand[] {
  return [...registeredCommands.values()]
    .sort(compareRegisteredCommands)
    .map(({ registrationId: _registrationId, registrationOrder: _registrationOrder, ...command }) => command);
}

export function dispatchKeyboardCommand(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.key === 'Process') return false;

  const editable = isEditableTarget(event.target);
  const modalOpen = typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]');
  const menuOpen = typeof document !== 'undefined' && document.querySelector('[role="menu"]');
  const commands = [...registeredCommands.values()].sort(compareRegisteredCommands);
  for (const command of commands) {
    if (!isCommandEnabled(command)) continue;
    if (editable && !command.allowInEditable) continue;
    if (modalOpen && command.scope !== 'modal' && command.scope !== 'menu' && !command.allowInModal) continue;
    if (menuOpen && command.scope !== 'menu' && !command.allowInMenu) continue;
    if (event.repeat && !command.repeatable) continue;
    if (!command.shortcuts.some((shortcut) => shortcutMatches(event, shortcut))) continue;

    if (command.preventDefault !== false) event.preventDefault();
    void command.handler(event);
    return true;
  }

  return false;
}

export function shortcutMatches(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  shortcut: ShortcutSpec,
  macLike = isMacLikePlatform(),
): boolean {
  const expectedCtrl = shortcut.primary ? !macLike : Boolean(shortcut.ctrl);
  const expectedMeta = shortcut.primary ? macLike : Boolean(shortcut.meta);
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
    && event.ctrlKey === expectedCtrl
    && event.metaKey === expectedMeta
    && event.altKey === Boolean(shortcut.alt)
    && event.shiftKey === Boolean(shortcut.shift);
}

export function formatShortcut(shortcut: ShortcutSpec, macLike = isMacLikePlatform()): string {
  const parts: string[] = [];
  if (shortcut.primary) parts.push(macLike ? '⌘' : 'Ctrl');
  else {
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.meta) parts.push(macLike ? '⌘' : 'Meta');
  }
  if (shortcut.alt) parts.push(macLike ? '⌥' : 'Alt');
  if (shortcut.shift) parts.push(macLike ? '⇧' : 'Shift');
  parts.push(formatKey(shortcut.key));
  return parts.join(macLike ? '' : '+');
}

export function commandLabel(command: KeyboardCommand): string {
  return typeof command.label === 'function' ? command.label() : command.label;
}

export function commandGroup(command: KeyboardCommand): string {
  if (!command.group) return '';
  return typeof command.group === 'function' ? command.group() : command.group;
}

export function isCommandEnabled(command: KeyboardCommand): boolean {
  return typeof command.enabled === 'function' ? command.enabled() : command.enabled !== false;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

export function isMacLikePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function openKeyboardShortcutHelp(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cfms:keyboard-shortcuts'));
}

export function keyboardMenuAnchor(event: MouseEvent | KeyboardEvent): KeyboardMenuAnchor {
  const sourceElement = event instanceof KeyboardEvent && event.target instanceof HTMLElement
    ? event.target
    : event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY, sourceElement };
  }
  const bounds = sourceElement?.getBoundingClientRect();
  return {
    x: bounds ? bounds.left + Math.min(bounds.width / 2, 24) : window.innerWidth / 2,
    y: bounds ? bounds.top + Math.min(bounds.height / 2, 24) : window.innerHeight / 2,
    sourceElement,
  };
}

export function focusRovingItem(
  event: KeyboardEvent,
  container: HTMLElement,
  options: {
    selector?: string;
    orientation?: 'horizontal' | 'vertical' | 'both';
    wrap?: boolean;
  } = {},
): HTMLElement | null {
  const {
    selector = '[data-roving-item]',
    orientation = 'both',
    wrap = true,
  } = options;
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(isFocusableItem);
  if (items.length === 0) return null;

  const horizontal = orientation === 'horizontal' || orientation === 'both';
  const vertical = orientation === 'vertical' || orientation === 'both';
  let direction = 0;
  if (horizontal && event.key === 'ArrowRight') direction = 1;
  else if (horizontal && event.key === 'ArrowLeft') direction = -1;
  else if (vertical && event.key === 'ArrowDown') direction = 1;
  else if (vertical && event.key === 'ArrowUp') direction = -1;

  const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(selector) : null;
  let nextIndex: number;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = items.length - 1;
  else if (direction !== 0) {
    const currentIndex = Math.max(0, items.indexOf(current ?? items[0]));
    nextIndex = currentIndex + direction;
    if (wrap) nextIndex = (nextIndex + items.length) % items.length;
    else nextIndex = Math.max(0, Math.min(items.length - 1, nextIndex));
  } else {
    return null;
  }

  event.preventDefault();
  const next = items[nextIndex];
  for (const item of items) item.tabIndex = item === next ? 0 : -1;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return next;
}

export function cycleKeyboardRegion(event: KeyboardEvent, root: ParentNode = document): boolean {
  if (event.key !== 'F6' || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (
    typeof document !== 'undefined'
    && document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')
  ) {
    event.preventDefault();
    return true;
  }
  const regions = Array.from(root.querySelectorAll<HTMLElement>('[data-keyboard-region]'))
    .filter((region) => !region.hidden && region.getAttribute('aria-hidden') !== 'true');
  if (regions.length === 0) return false;

  const activeRegion = document.activeElement instanceof Element
    ? document.activeElement.closest<HTMLElement>('[data-keyboard-region]')
    : null;
  const currentIndex = regions.indexOf(activeRegion ?? regions[0]);
  const delta = event.shiftKey ? -1 : 1;
  const targetRegion = regions[(currentIndex + delta + regions.length) % regions.length];
  const target = targetRegion.matches(FOCUSABLE_SELECTOR)
    ? targetRegion
    : targetRegion.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? targetRegion;
  if (!targetRegion.hasAttribute('tabindex') && target === targetRegion) targetRegion.tabIndex = -1;
  event.preventDefault();
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

export const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function isFindShortcut(event: KeyboardEvent): boolean {
  return shortcutMatchesAnyPrimary(event, 'f');
}

export function isAppLockShortcut(event: KeyboardEvent): boolean {
  return shortcutMatchesAnyPrimary(event, 'l');
}

export type FileManagerShortcut =
  | 'go-parent'
  | 'refresh'
  | 'create-folder'
  | 'select-all'
  | 'clear-selection'
  | 'delete-selection'
  | 'rename-selection';

/** Maps desktop file-manager key conventions to semantic actions. */
export function fileManagerShortcutFor(event: KeyboardEvent): FileManagerShortcut | null {
  const primaryModifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key === 'Backspace') return 'go-parent';
    if (event.key === 'F5') return 'refresh';
    if (event.key === 'Escape') return 'clear-selection';
    if (event.key === 'Delete') return 'delete-selection';
    if (event.key === 'F2') return 'rename-selection';
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowUp') {
    return 'go-parent';
  }

  if (primaryModifier && !event.altKey) {
    if (!event.shiftKey && key === 'r') return 'refresh';
    if (!event.shiftKey && key === 'a') return 'select-all';
    if (event.shiftKey && key === 'n') return 'create-folder';
  }

  return null;
}

function compareRegisteredCommands(a: RegisteredCommand, b: RegisteredCommand): number {
  return (SCOPE_PRIORITY[b.scope] + (b.priority ?? 0))
    - (SCOPE_PRIORITY[a.scope] + (a.priority ?? 0))
    || b.registrationOrder - a.registrationOrder;
}

function notifyCommandSubscribers() {
  const commands = getRegisteredKeyboardCommands();
  for (const subscriber of commandSubscribers) subscriber(commands);
}

function shortcutMatchesAnyPrimary(event: KeyboardEvent, key: string): boolean {
  return event.key.toLowerCase() === key
    && (event.ctrlKey || event.metaKey)
    && !(event.ctrlKey && event.metaKey)
    && !event.altKey
    && !event.shiftKey;
}

function formatKey(key: string): string {
  const names: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Escape: 'Esc',
    ' ': 'Space',
    ',': ',',
    '/': '/',
  };
  return names[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

function isFocusableItem(element: HTMLElement): boolean {
  return !element.hidden
    && element.getAttribute('aria-hidden') !== 'true'
    && element.getAttribute('aria-disabled') !== 'true'
    && !(element instanceof HTMLButtonElement && element.disabled);
}
