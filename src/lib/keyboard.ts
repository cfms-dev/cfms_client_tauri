export function isFindShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 'f'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
  );
}
