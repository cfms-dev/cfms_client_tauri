import type { IconName } from '$lib/icons';

export interface ContextMenuActionItem {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  hidden?: boolean;
}

export interface ContextMenuDividerItem {
  type: 'divider';
  hidden?: boolean;
}

export type ContextMenuItem = ContextMenuActionItem | ContextMenuDividerItem;
