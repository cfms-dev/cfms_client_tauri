export const IMAGE_DOCUMENT_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'svg',
]);

export function isImageDocumentName(filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension ? IMAGE_DOCUMENT_EXTENSIONS.has(extension) : false;
}
