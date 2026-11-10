export function formatPathFilename(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}
