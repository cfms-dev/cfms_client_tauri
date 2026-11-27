import { open } from '#lib/shared/platform/native-dialog.ts';
import { platform } from '#lib/shared/platform/native-os.ts';
import { selectUploadDirectory } from '#lib/api.ts';
import { formatUserFacingError } from '#lib/shared/errors/user-facing-errors.ts';
import { isPickerCancel } from '#lib/shared/format/values.ts';
import { basename } from '#lib/shared/platform/upload-names.ts';

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
    if (isPickerCancel(formatUserFacingError(error))) return null;
    throw error;
  }
}
