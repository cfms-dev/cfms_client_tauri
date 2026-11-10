import { open } from '$lib/shared/platform/native-dialog';
import { platform } from '$lib/shared/platform/native-os';
import { selectUploadDirectory } from '$lib/api';
import { formatError, isPickerCancel } from '$lib/shared/format/values';
import { basename } from '$lib/shared/platform/upload-names';

export interface DirectoryPickerOptions {
  title?: string;
  defaultPath?: string;
}

export interface SelectedDirectory {
  path: string;
  name: string;
}

/**
 * Open the platform-appropriate directory picker.
 *
 * Tauri's directory dialog is unavailable on Android, so Android uses the
 * app's SAF-backed native picker and returns its persisted tree URI. Desktop
 * platforms continue to return a regular filesystem path.
 */
export async function pickDirectory(
  options: DirectoryPickerOptions = {},
): Promise<SelectedDirectory | null> {
  try {
    if (platform() === 'android') {
      const selected = await selectUploadDirectory();
      const path = selected.uri.trim();
      if (!path) return null;

      return {
        path,
        name: selected.name.trim() || basename(path),
      };
    }

    const selected = await open({
      directory: true,
      multiple: false,
      title: options.title,
      defaultPath: options.defaultPath,
    });
    if (typeof selected !== 'string' || !selected.trim()) return null;

    const path = selected.trim();
    return { path, name: basename(path) };
  } catch (error) {
    if (isPickerCancel(formatError(error))) return null;
    throw error;
  }
}
