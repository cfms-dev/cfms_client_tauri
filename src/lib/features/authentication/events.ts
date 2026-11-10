import type { ServiceEvent } from '$lib/api/types';
import { eventLog } from '$lib/features/diagnostics/event-log.svelte';
import { notificationStore } from '$lib/shared/notifications/notifications.svelte';
import { authStore } from './auth-state.svelte';

export function handleAuthenticationEvent(event: ServiceEvent): void {
  switch (event.event) {
      case "TokenExpired": {
        authStore.clear();
        eventLog.push("error", "Authentication token expired");
        notificationStore.error("Authentication token expired", 8000);
        break;
      }

  }
}
