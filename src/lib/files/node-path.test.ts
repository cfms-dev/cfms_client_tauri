import { describe, expect, it, vi } from 'vitest';
import {
  decodeResolvedNodePath,
  classifyNodePathTerminal,
  encodeNodePathSegment,
  formatAbsoluteNodePath,
  knownAbsoluteNodePath,
} from './node-path';

describe('node path wire helpers', () => {
  it('round-trips readable Unicode, spaces, slashes, and percent signs', () => {
    const labels = ['项目 A', 'teams/security', '100%', '%2F'];
    const path = formatAbsoluteNodePath(labels);

    expect(path).toBe('/项目 A/teams%2Fsecurity/100%25/%252F');
    expect(decodeResolvedNodePath(path, ['/', 'a', 'b', 'c', 'd'])).toEqual([
      { id: 'a', label: '项目 A' },
      { id: 'b', label: 'teams/security' },
      { id: 'c', label: '100%' },
      { id: 'd', label: '%2F' },
    ]);
  });

  it('preserves the root path and only exposes known absolute paths', () => {
    expect(formatAbsoluteNodePath([])).toBe('/');
    expect(decodeResolvedNodePath('/', ['/'])).toEqual([]);
    expect(knownAbsoluteNodePath(null, ['Projects'])).toBe('/Projects');
    expect(knownAbsoluteNodePath('search-root', ['Projects'])).toBeNull();
  });

  it('escapes percent before slash to avoid double-decoding', () => {
    expect(encodeNodePathSegment('%/')).toBe('%25%2F');
  });

  it('rejects malformed or mismatched successful responses', () => {
    expect(() => decodeResolvedNodePath('/a', ['not-root', 'a'])).toThrow(/root/);
    expect(() => decodeResolvedNodePath('/a', ['/'])).toThrow(/match/);
    expect(() => decodeResolvedNodePath('/a/', ['/', 'a', 'b'])).toThrow(/empty/);
    expect(() => decodeResolvedNodePath('/%zz', ['/', 'a'])).toThrow(URIError);
  });
});

describe('node path terminal classification', () => {
  const terminal = { id: 'target', label: 'Target' };
  const serverError = (status: number) => new Error(`Server returned ${status}: failure`);
  const errorStatus = (error: unknown) => {
    const match = String(error).match(/returned (\d+)/);
    return match ? Number(match[1]) : null;
  };

  it('prefers directory confirmation without requesting document info', async () => {
    const getDocumentInfo = vi.fn();
    await expect(classifyNodePathTerminal({
      terminal,
      expectedParentId: 'parent',
      getDirectoryInfo: vi.fn().mockResolvedValue({}),
      getDocumentInfo,
      errorStatus,
    })).resolves.toEqual({ kind: 'directory', ...terminal });
    expect(getDocumentInfo).not.toHaveBeenCalled();
  });

  it('falls back to document info only for a directory 404', async () => {
    await expect(classifyNodePathTerminal({
      terminal,
      expectedParentId: 'parent',
      getDirectoryInfo: vi.fn().mockRejectedValue(serverError(404)),
      getDocumentInfo: vi.fn().mockResolvedValue({ title: 'Document', parent_id: 'parent' }),
      errorStatus,
    })).resolves.toEqual({
      kind: 'document', id: 'target', label: 'Document', parentId: 'parent',
    });
  });

  it('does not guess on access denial and rejects a changed parent', async () => {
    const denied = serverError(403);
    await expect(classifyNodePathTerminal({
      terminal,
      expectedParentId: 'parent',
      getDirectoryInfo: vi.fn().mockRejectedValue(denied),
      getDocumentInfo: vi.fn(),
      errorStatus,
    })).rejects.toBe(denied);

    await expect(classifyNodePathTerminal({
      terminal,
      expectedParentId: 'parent',
      getDirectoryInfo: vi.fn().mockRejectedValue(serverError(404)),
      getDocumentInfo: vi.fn().mockResolvedValue({ parent_id: 'moved-parent' }),
      errorStatus,
    })).rejects.toThrow(/parent/);
  });
});
