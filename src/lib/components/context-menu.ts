import type { IconName } from '$lib/icons';

export interface ContextMenuActionItem {
  id: string;
  label: string;
  icon: IconName;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  hidden?: boolean;
  requiredPermissions?: string[];
}

export interface ContextMenuDividerItem {
  type: 'divider';
  hidden?: boolean;
}

export type ContextMenuItem = ContextMenuActionItem | ContextMenuDividerItem;

export function isContextMenuDivider(
  item: ContextMenuItem,
): item is ContextMenuDividerItem {
  return 'type' in item && item.type === 'divider';
}

export function userHasContextMenuPermissions(
  item: ContextMenuItem,
  userPermissions: readonly string[],
): boolean {
  if (isContextMenuDivider(item)) return true;
  if (!item.requiredPermissions?.length) return true;

  return item.requiredPermissions.every((permission) =>
    userPermissions.includes(permission),
  );
}

export function filterContextMenuItems(
  items: ContextMenuItem[],
  userPermissions: readonly string[] = [],
): ContextMenuItem[] {
  const filtered: ContextMenuItem[] = [];

  for (const item of items) {
    if (item.hidden || !userHasContextMenuPermissions(item, userPermissions)) {
      continue;
    }

    if (isContextMenuDivider(item)) {
      if (
        filtered.length > 0 &&
        !isContextMenuDivider(filtered[filtered.length - 1])
      ) {
        filtered.push(item);
      }
      continue;
    }

    filtered.push(item);
  }

  if (filtered.length > 0 && isContextMenuDivider(filtered[filtered.length - 1])) {
    filtered.pop();
  }

  return filtered;
}
