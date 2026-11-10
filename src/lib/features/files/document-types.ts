const DOCUMENT_TYPE_KEY_BY_EXTENSION = {
  txt: 'plainText',
  log: 'plainText',
  rtf: 'richText',
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  htm: 'html',
  epub: 'epub',
  odt: 'openDocumentText',
  ods: 'openDocumentSpreadsheet',
  odp: 'openDocumentPresentation',
  png: 'pngImage',
  jpg: 'jpegImage',
  jpeg: 'jpegImage',
  jpe: 'jpegImage',
  gif: 'gifImage',
  bmp: 'bitmapImage',
  webp: 'webpImage',
  svg: 'svgImage',
  tif: 'tiffImage',
  tiff: 'tiffImage',
  zip: 'zipArchive',
  rar: 'rarArchive',
  '7z': 'sevenZipArchive',
  tar: 'tarArchive',
  gz: 'gzipArchive',
  gzip: 'gzipArchive',
  mp3: 'mp3Audio',
  wav: 'waveAudio',
  flac: 'flacAudio',
  mp4: 'mp4Video',
  mkv: 'matroskaVideo',
  mov: 'quickTimeVideo',
  avi: 'aviVideo',
} as const;

export type DocumentTypeKey = (typeof DOCUMENT_TYPE_KEY_BY_EXTENSION)[keyof typeof DOCUMENT_TYPE_KEY_BY_EXTENSION];

export type DocumentTypeDescriptor =
  | { kind: 'generic' }
  | { kind: 'mapped'; key: DocumentTypeKey }
  | { kind: 'extension'; extension: string };

export function classifyDocumentType(filename: string): DocumentTypeDescriptor {
  const name = filename.replaceAll('\\', '/').split('/').at(-1) ?? filename;
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === name.length - 1) return { kind: 'generic' };

  const extension = name.slice(lastDot + 1).toLocaleLowerCase('en-US');
  const key = DOCUMENT_TYPE_KEY_BY_EXTENSION[extension as keyof typeof DOCUMENT_TYPE_KEY_BY_EXTENSION];
  if (key) return { kind: 'mapped', key };
  return { kind: 'extension', extension: extension.toLocaleUpperCase('en-US') };
}
