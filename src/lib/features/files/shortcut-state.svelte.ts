
export interface FileShortcutValidationPayload {
  invalid_files?: string[];
  invalid_directories?: string[];
  access_denied_files?: string[];
  access_denied_directories?: string[];
}

class FileShortcutValidationStoreImpl {
  invalidFiles = $state<Set<string>>(new Set());
  invalidDirectories = $state<Set<string>>(new Set());
  accessDeniedFiles = $state<Set<string>>(new Set());
  accessDeniedDirectories = $state<Set<string>>(new Set());

  apply(payload: FileShortcutValidationPayload) {
    this.invalidFiles = new Set(payload.invalid_files ?? []);
    this.invalidDirectories = new Set(payload.invalid_directories ?? []);
    this.accessDeniedFiles = new Set(payload.access_denied_files ?? []);
    this.accessDeniedDirectories = new Set(payload.access_denied_directories ?? []);
  }

  markUnavailable(type: 'document' | 'directory', id: string) {
    if (type === 'document') {
      this.invalidFiles = new Set([...this.invalidFiles, id]);
      this.accessDeniedFiles = withoutValue(this.accessDeniedFiles, id);
    } else {
      this.invalidDirectories = new Set([...this.invalidDirectories, id]);
      this.accessDeniedDirectories = withoutValue(this.accessDeniedDirectories, id);
    }
  }

  isUnavailable(type: 'document' | 'directory', id: string) {
    return type === 'document'
      ? this.invalidFiles.has(id) || this.accessDeniedFiles.has(id)
      : this.invalidDirectories.has(id) || this.accessDeniedDirectories.has(id);
  }
}

function withoutValue(values: Set<string>, value: string) {
  const next = new Set(values);
  next.delete(value);
  return next;
}

export const fileShortcutValidationStore = new FileShortcutValidationStoreImpl();
