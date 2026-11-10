import type { ServiceEvent } from '$lib/api/types';
import { eventLog } from '$lib/features/diagnostics/event-log.svelte';
import { notificationStore } from '$lib/shared/notifications/notifications.svelte';
import { authStore } from './auth-state.svelte';
import { translate } from '$lib/shared/i18n/translate';

export function handleAuthenticationEvent(event: ServiceEvent): void {
  switch (event.event) {
      case 'AppLockAttemptsExceeded':
        authStore.clear();
        eventLog.push('error', 'Application lock verification limit reached');
        notificationStore.error(translate('appLock.unlock.disconnected'), 7000);
        break;
      case "TokenExpired": {
        authStore.clear();
        eventLog.push("error", "Authentication token expired");
        notificationStore.error("Authentication token expired", 8000);
        break;
      }

  }
}
