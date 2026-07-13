// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/svelte';
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

function renderTable() {
  const onFolderClick = vi.fn();
  const onMarqueeSelection = vi.fn();
  const result = render(FileTable, {
    props: {
      loading: false,
      folders: [{ id: 'folder-1', name: 'Folder', created_time: null }],
      documents: [],
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
      onRowKeydown: vi.fn(),
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
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500 }),
    },
  });
  Object.defineProperties(typeCell, {
    getClientRects: { configurable: true, value: () => [{ left: 600 }] },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 600, top: 36, right: 712, bottom: 76, width: 112, height: 40 }),
    },
  });

  return { ...result, viewport, typeCell, setPointerCapture, onFolderClick, onMarqueeSelection };
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
    expect(onMarqueeSelection).toHaveBeenCalledWith(expect.any(Set), expect.any(Set), 'updating');
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
    expect(contentStyle).toContain('--file-modified-width: 128px');
  });
});
