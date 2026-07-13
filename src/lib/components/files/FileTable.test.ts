// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FileTable from './FileTable.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

afterEach(cleanup);

function renderTable(
  folders = [{ id: 'folder-1', name: 'Folder', created_time: null }],
  documents: Array<{ id: string; title: string; size: number | null; last_modified: number | null }> = [],
) {
  const onFolderClick = vi.fn();
  const onMarqueeSelection = vi.fn();
  const onRowKeydown = vi.fn();
  const result = render(FileTable, {
    props: {
      loading: false,
      resetKey: 0,
      folders,
      documents,
      marqueeEnabled: true,
      selectMode: false,
      selectedFolderIds: new Set<string>(),
      selectedDocumentIds: new Set<string>(),
      sortTitle: (field) => field,
      sortIcon: () => 'swapVert',
      onSort: vi.fn(),
      onMarqueeSelection,
      onFolderClick,
      onDocumentClick: vi.fn(),
      onFolderActivate: vi.fn(),
      onDocumentActivate: vi.fn(),
      onRowKeydown,
      onBlankClick: vi.fn(),
      onBlankContextMenu: vi.fn(),
      onFolderContextMenu: vi.fn(),
      onDocumentContextMenu: vi.fn(),
    },
  });

  const viewport = result.container.querySelector<HTMLElement>('.file-table-scroll-viewport')!;
  const typeCell = result.container.querySelector<HTMLElement>('[data-marquee-start]')!;
  const setPointerCapture = vi.fn();
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 520 },
    clientWidth: { configurable: true, value: 800 },
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 }),
    },
  });
  if (typeCell) {
    Object.defineProperties(typeCell, {
      getClientRects: { configurable: true, value: () => [{ left: 600 }] },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 600, top: 36, right: 712, bottom: 76, width: 112, height: 40 }),
      },
    });
  }

  return { ...result, viewport, typeCell, setPointerCapture, onFolderClick, onMarqueeSelection, onRowKeydown };
}

describe('FileTable marquee activation', () => {
  it('keeps a short press in the marquee-capable columns as a normal row click', async () => {
    const { typeCell, setPointerCapture, onFolderClick } = renderTable();

    await fireEvent.pointerDown(typeCell, {
      pointerId: 7,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 620,
      clientY: 56,
    });
    expect(setPointerCapture).not.toHaveBeenCalled();

    await fireEvent.pointerUp(typeCell, { pointerId: 7, pointerType: 'mouse', isPrimary: true });
    await fireEvent.click(typeCell);
    expect(onFolderClick).toHaveBeenCalledOnce();
  });

  it('captures the pointer only after movement crosses the marquee threshold', async () => {
    const { typeCell, setPointerCapture, onMarqueeSelection } = renderTable();

    await fireEvent.pointerDown(typeCell, {
      pointerId: 8,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 620,
      clientY: 56,
    });
    await fireEvent.pointerMove(typeCell, {
      pointerId: 8,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 630,
      clientY: 66,
    });

    expect(setPointerCapture).toHaveBeenCalledWith(8);
    expect(onMarqueeSelection).not.toHaveBeenCalled();

    await fireEvent.pointerUp(typeCell, {
      pointerId: 8,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 630,
      clientY: 66,
    });
    expect(onMarqueeSelection).toHaveBeenCalledOnce();
    expect(onMarqueeSelection).toHaveBeenCalledWith(expect.any(Set), expect.any(Set));
  });
});

describe('FileTable column resizing', () => {
  it('moves a desktop column boundary while preserving the adjacent pair width', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });
    const { container } = renderTable();
    const columnWidths = [300, 168, 112, 100];
    const columns = Array.from(container.querySelectorAll<HTMLElement>('[data-file-column]'));
    columns.forEach((column, index) => {
      Object.defineProperty(column, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ width: columnWidths[index] }),
      });
    });
    const handle = container.querySelector<HTMLButtonElement>('.file-table-resize-handle')!;
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => false },
    });

    await fireEvent.pointerDown(handle, {
      pointerId: 12,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 300,
    });
    await fireEvent.pointerMove(handle, {
      pointerId: 12,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 340,
    });

    const contentStyle = container.querySelector<HTMLElement>('.file-table-content')!.getAttribute('style');
    expect(contentStyle).toContain('--file-name-width: 340px');
    expect(contentStyle).toContain('--file-name-min-width: 340px');
    expect(contentStyle).toContain('--file-modified-width: 128px');
    expect(contentStyle).not.toContain('--file-table-content-width');
  });
});

describe('FileTable keyboard navigation', () => {
  it('enters the table at the first row when the document has lost row focus', async () => {
    const { container, onRowKeydown } = renderTable([
      { id: 'folder-1', name: 'First', created_time: null },
      { id: 'folder-2', name: 'Second', created_time: null },
    ]);
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-file-table-row]'));

    expect(document.activeElement).toBe(document.body);
    await fireEvent.keyDown(document.body, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(rows[0]);
    expect(onRowKeydown).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'ArrowDown' }),
      expect.objectContaining({ kind: 'folder', folder: expect.objectContaining({ id: 'folder-1' }) }),
    );
  });

  it('uses a roving tab stop and moves to the next row with ArrowDown', async () => {
    const { container, onRowKeydown } = renderTable([
      { id: 'folder-1', name: 'First', created_time: null },
      { id: 'folder-2', name: 'Second', created_time: null },
    ]);
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-file-table-row]'));
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1]);

    rows[0].focus();
    await fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].tabIndex).toBe(0);
    expect(onRowKeydown).toHaveBeenCalledWith(expect.objectContaining({ key: 'ArrowDown' }), expect.objectContaining({ kind: 'folder' }));
  });

  it('moves by one viewport page without constructing a row-key array', async () => {
    const folders = Array.from({ length: 20 }, (_, index) => ({
      id: `folder-${index}`,
      name: `Folder ${index}`,
      created_time: null,
    }));
    const { container } = renderTable(folders);
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-file-table-row]'));

    rows[0].focus();
    await fireEvent.keyDown(rows[0], { key: 'PageDown' });

    expect(document.activeElement).toBe(rows[12]);
  });

  it('does not reset scroll position when a row is focused or clicked', async () => {
    const { container, viewport } = renderTable();
    const row = container.querySelector<HTMLButtonElement>('[data-file-table-row]')!;
    viewport.scrollTop = 240;

    row.focus();
    await fireEvent.click(row);

    expect(viewport.scrollTop).toBe(240);
  });
});

describe('FileTable viewport anchoring', () => {
  it('keeps the first row at the same position when a page is appended at zero scroll', async () => {
    const { component, container, viewport } = renderTable([
      { id: 'folder-1', name: 'First', created_time: null },
      { id: 'folder-2', name: 'Second', created_time: null },
    ]);
    const header = container.querySelector<HTMLElement>('.file-table-header')!;
    const listSpace = container.querySelector<HTMLElement>('.file-table-list-space')!;
    Object.defineProperties(header, {
      offsetHeight: { configurable: true, value: 36 },
    });
    Object.defineProperties(listSpace, {
      offsetTop: { configurable: true, value: 36 },
    });
    viewport.scrollTop = 0;

    const anchor = component.captureViewportAnchor();
    expect(anchor).toEqual({ key: 'folder:folder-1', offset: 0 });

    await component.restoreViewportAnchor(0, anchor!.offset);
    expect(viewport.scrollTop).toBe(0);
  });

  it('preserves the anchored row offset when its sorted index changes', async () => {
    const { component, container, viewport } = renderTable([
      { id: 'folder-1', name: 'First', created_time: null },
      { id: 'folder-2', name: 'Second', created_time: null },
      { id: 'folder-3', name: 'Third', created_time: null },
    ]);
    const header = container.querySelector<HTMLElement>('.file-table-header')!;
    const listSpace = container.querySelector<HTMLElement>('.file-table-list-space')!;
    Object.defineProperties(header, {
      offsetHeight: { configurable: true, value: 36 },
    });
    Object.defineProperties(listSpace, {
      offsetTop: { configurable: true, value: 36 },
    });
    viewport.scrollTop = 17;

    const anchor = component.captureViewportAnchor();
    expect(anchor).toEqual({ key: 'folder:folder-1', offset: 17 });

    await component.restoreViewportAnchor(2, anchor!.offset);
    expect(viewport.scrollTop).toBe(97);
  });
});

describe('FileTable large directory virtualization', () => {
  it.each([10_000, 50_000])('keeps DOM rows bounded for %i entries', async (count) => {
    const documents = Array.from({ length: count }, (_, index) => ({
      id: `document-${index}`,
      title: `Document ${index}`,
      size: index,
      last_modified: index,
    }));
    const { container, viewport } = renderTable([], documents);
    await fireEvent.scroll(viewport);
    await waitFor(() => expect(container.querySelectorAll('[data-file-table-row]').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('[data-file-table-row]').length).toBeLessThanOrEqual(40);
  });
});
