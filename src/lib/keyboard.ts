export function isFindShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 'f'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
  );
}

export function isAppLockShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 'l'
    && event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && !event.shiftKey
  );
}

export type FileManagerShortcut =
  | 'go-parent'
  | 'refresh'
  | 'create-folder'
  | 'select-all'
  | 'clear-selection'
  | 'delete-selection'
  | 'rename-selection';

/**
 * Maps desktop file-manager key conventions to semantic actions.
 * Whether an action is currently available (for example, at the navigation
 * root or with an empty selection) remains the page's responsibility.
 */
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
