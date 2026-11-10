import type { ServiceEvent } from '$lib/api/types';
import { eventLog } from '$lib/features/diagnostics/event-log.svelte';
import { fileShortcutValidationStore } from './shortcut-state.svelte';

export function handleFileEvent(event: ServiceEvent): void {
  switch (event.event) {
      case "FavoritesValidationComplete": {
        const { invalid_count } = event.data;
        fileShortcutValidationStore.apply(event.data);
        if (invalid_count > 0) {
          eventLog.push(
            "warning",
            `Shortcut validation: ${invalid_count} items are no longer accessible`,
          );
        }
        break;
      }
  }
}
