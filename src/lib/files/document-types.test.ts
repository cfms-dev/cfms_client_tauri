import { describe, expect, it } from 'vitest';
import { classifyDocumentType } from './document-types';

describe('document type classification', () => {
  it('matches known extensions without regard to case', () => {
    expect(classifyDocumentType('Quarterly Report.DOCX')).toEqual({ kind: 'mapped', key: 'word' });
    expect(classifyDocumentType('backup.tar.GZ')).toEqual({ kind: 'mapped', key: 'gzipArchive' });
  });

  it('formats an unknown extension in uppercase', () => {
    expect(classifyDocumentType('design.prototype')).toEqual({
      kind: 'extension',
      extension: 'PROTOTYPE',
    });
  });

  it('keeps extensionless, trailing-dot, and dot-file names generic', () => {
    expect(classifyDocumentType('README')).toEqual({ kind: 'generic' });
    expect(classifyDocumentType('document.')).toEqual({ kind: 'generic' });
    expect(classifyDocumentType('.gitignore')).toEqual({ kind: 'generic' });
  });
});
