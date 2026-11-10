import type { ServiceEvent } from '$lib/api/types';
import { eventLog } from '$lib/features/diagnostics/event-log.svelte';
import { notificationStore } from '$lib/shared/notifications/notifications.svelte';
import { translate } from '$lib/shared/i18n/translate';
import { serverStateStore } from './connection-state.svelte';

export function handleConnectionEvent(event: ServiceEvent): void {
  switch (event.event) {
      case "Lockdown": {
        serverStateStore.lockdown = event.data.status;
        serverStateStore.lockdownReason = event.data.reason;
        eventLog.push(
          "warning",
          `Lockdown ${event.data.status ? "activated" : "deactivated"}`,
        );
        break;
      }

      case "ConnectionRestored": {
        if (!serverStateStore.remoteAddress || (serverStateStore.connectionId !== null && event.data.connection_id < serverStateStore.connectionId)) break;
        serverStateStore.connectionId = event.data.connection_id;
        serverStateStore.revocation = event.data.status;
        serverStateStore.connected = true;
        eventLog.push("success", "Connection restored");
        break;
      }

      case "ConnectionSecurityChanged": {
        if (event.data.connection_id !== serverStateStore.connectionId) break;
        const previous = serverStateStore.revocation;
        serverStateStore.revocation = event.data.status;
        const status = event.data.status;
        if (status.state === 'revoked') serverStateStore.connected = false;
        if (previous?.state !== status.state || previous?.reasons.join() !== status.reasons.join()) {
          if (status.state === 'unknown' || status.state === 'revoked') {
            const message = translate(`settings.connection.crlState.${status.state}`);
            eventLog.push(status.state === 'revoked' ? 'error' : 'warning', message);
            if (status.state === 'revoked') notificationStore.error(message);
            else notificationStore.warning(message);
          }
        }
        break;
      }

      case "ConnectionLost": {
        serverStateStore.connected = false;
        eventLog.push("error", `Connection lost: ${event.data.error}`);
        notificationStore.error("Connection lost. Please reconnect.", 8000);
        break;
      }

  }
}
