export function shortIdentifier(value: string | number | null | undefined, length = 7): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.length <= length) return text;
  return text.slice(0, Math.max(1, length));
}
