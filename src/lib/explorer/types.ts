import type { IconName } from '$lib/icons';

export interface WorkspaceNavItem {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  badge?: number;
  exact?: boolean;
  tone?: 'default' | 'danger';
}

export interface CommandAction {
  id: string;
  label: string;
  icon: IconName;
  visible?: boolean;
  disabled?: boolean;
  active?: boolean;
  tone?: 'default' | 'danger';
  compact?: boolean;
  dividerBefore?: boolean;
  run: () => void | Promise<void>;
}

export interface FileSelectionState {
  focusedKey: string | null;
  anchorKey: string | null;
  selectedFolderIds: Set<string>;
  selectedDocumentIds: Set<string>;
}

export interface FileDetailRow {
  label: string;
  value: string;
}

export interface FileDetailModel {
  title: string;
  subtitle?: string;
  icon: IconName;
  loading?: boolean;
  error?: string | null;
  rows: FileDetailRow[];
}
