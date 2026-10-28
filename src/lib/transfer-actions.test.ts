import { describe, expect, it, vi } from 'vitest';
import { filterContextMenuItems, isContextMenuDivider } from './components/context-menu';
import { transferCleanupMenu, transferControlMenu } from './transfer-actions';
import type { CleanupKind } from './transfer-batches';

describe('transfer menus', () => {
  const translate = (key: string) => key;
  it('shows only available cleanup categories and avoids duplicating one category as all finished', async () => {
    const run = vi.fn();
    const items = filterContextMenuItems(transferCleanupMenu({
      count: kind => kind === 'completed' || kind === 'finished' ? 67 : 0, run, translate, busy: false,
    }));
    expect(items).toHaveLength(1);
    const item = items[0];
    if (isContextMenuDivider(item)) throw new Error('Expected cleanup action');
    expect(item.label).toBe('tasks.cleanup.completed (67)');
    await item.onSelect();
    expect(run).toHaveBeenCalledWith('completed');
  });

  it('separates controls, history cleanup, and stop-and-clear with no empty separators', () => {
    const counts: Record<CleanupKind, number> = { completed: 2, failed: 1, cancelled: 0, finished: 3, active: 1 };
    const items = filterContextMenuItems([
      ...transferControlMenu({ count: action => action === 'cancel' ? 1 : 0, run: vi.fn(), translate, busy: true }),
      ...transferCleanupMenu({ count: kind => counts[kind], run: vi.fn(), translate, busy: true }),
    ]);
    expect(items.map(item => isContextMenuDivider(item) ? 'divider' : item.id))
      .toEqual(['cancel', 'divider', 'completed', 'failed', 'finished', 'divider', 'active']);
    expect(items.every(item => isContextMenuDivider(item) || item.disabled)).toBe(true);
    expect(items.at(-1)).toMatchObject({ danger: true });
  });
});
