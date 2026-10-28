import type { TransferControlAction } from './api';
import type { ContextMenuItem } from './components/context-menu';
import type { IconName } from './icons';
import type { CleanupKind } from './transfer-batches';

export const TRANSFER_ACTIONS = {
  pause: { icon: 'pause', label: 'tasks.pause' },
  resume: { icon: 'resume', label: 'tasks.resume' },
  retry: { icon: 'restartAlt', label: 'tasks.retryAvailable' },
  cancel: { icon: 'stopTransfer', label: 'tasks.cancelTransfer' },
  cancel_and_remove: { icon: 'stopAndClearTransfers', label: 'tasks.cleanup.active' },
} as const satisfies Record<TransferControlAction, { icon: IconName; label: string }>;

export const CLEANUP_ICONS = {
  completed: 'checkCircle', failed: 'errorFilled', cancelled: 'cancelledTransfer',
  finished: 'clearTransferRecords', active: 'stopAndClearTransfers',
} as const satisfies Record<CleanupKind, IconName>;

export function transferControlMenu({ count, run, translate, busy }: {
  count: (action: TransferControlAction) => number;
  run: (action: TransferControlAction) => void | Promise<void>;
  translate: (key: string) => string;
  busy: boolean;
}): ContextMenuItem[] {
  return (['retry', 'cancel'] as const).map(action => ({
    id: action, label: `${translate(TRANSFER_ACTIONS[action].label)} (${count(action)})`,
    icon: TRANSFER_ACTIONS[action].icon, hidden: !count(action), disabled: busy,
    onSelect: () => run(action),
  }));
}

export function transferCleanupMenu({ count, run, translate, busy }: {
  count: (kind: CleanupKind) => number;
  run: (kind: CleanupKind) => void | Promise<void>;
  translate: (key: string) => string;
  busy: boolean;
}): ContextMenuItem[] {
  const categories = (['completed', 'failed', 'cancelled'] as const).filter(kind => count(kind) > 0);
  return [
    { type: 'divider' },
    ...([...categories, ...(categories.length > 1 ? ['finished' as const] : [])]).map(kind => ({
      id: kind, label: `${translate(`tasks.cleanup.${kind}`)} (${count(kind)})`,
      icon: CLEANUP_ICONS[kind], disabled: busy, onSelect: () => run(kind),
    })),
    { type: 'divider' },
    { id: 'active', label: `${translate('tasks.cleanup.active')} (${count('active')})`,
      icon: CLEANUP_ICONS.active, danger: true, hidden: !count('active'), disabled: busy,
      onSelect: () => run('active') },
  ];
}
