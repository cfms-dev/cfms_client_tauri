import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import { dropEscalation, getUserAuthentication, requestEscalation, type JsonValue } from '$lib/api';
import { escalationMethods } from '$lib/features/authentication/authentication';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

interface EscalationRequest {
  userId: string | null;
  promise: Promise<boolean>;
  resolve: (success: boolean) => void;
}

class EscalationFlow {
  busy = $state(false);
  methods = $state<string[] | null>(null);
  private request: EscalationRequest | null = null;
  private closing: { request: EscalationRequest; success: boolean } | null = null;

  ensure(): Promise<boolean> {
    if (!authStore.isLoggedIn || !serverStateStore.connected) return Promise.resolve(false);
    if (this.request) return this.request.promise;
    if (this.busy) return Promise.resolve(false);
    if ((authStore.escalationExp ?? 0) * 1000 > Date.now()) return Promise.resolve(true);

    let resolve!: EscalationRequest['resolve'];
    const promise = new Promise<boolean>((complete) => { resolve = complete; });
    const request = { userId: authStore.userId, promise, resolve };
    this.request = request;
    this.busy = true;
    void this.begin(request);
    return promise;
  }

  private isCurrent(request: EscalationRequest): boolean {
    return this.request === request && authStore.isLoggedIn
      && serverStateStore.connected && authStore.userId === request.userId;
  }

  private finish(success: boolean) {
    if (this.request && this.methods) {
      // Resume callers only after the verification dialog's outro and focus restoration.
      this.closing = { request: this.request, success };
      this.methods = null;
      return;
    }
    this.resolve(success);
  }

  private resolve(success: boolean) {
    const request = this.request;
    this.request = null;
    this.closing = null;
    this.methods = null;
    this.busy = false;
    request?.resolve(success);
  }

  cancel() {
    if (this.request) this.resolve(false);
  }

  dialogCloseHandler(): () => void {
    const request = this.request;
    return () => {
      if (request && this.closing?.request === request) this.resolve(this.closing.success);
    };
  }

  private async begin(request: EscalationRequest) {
    try {
      const authentication = await getUserAuthentication();
      if (!this.isCurrent(request)) {
        if (this.request === request) this.finish(false);
        return;
      }
      if (authentication.policies.escalation.chains.length === 0) {
        const status = await requestEscalation();
        if (this.isCurrent(request)) {
          authStore.apply(status);
          this.finish((authStore.escalationExp ?? 0) * 1000 > Date.now());
        } else if (this.request === request) this.finish(false);
      } else {
        const available = escalationMethods(authentication);
        if (!available.length) throw new Error(get(t)('authentication.unavailable'));
        this.methods = available;
      }
    } catch (error) {
      if (this.request !== request) return;
      if (this.isCurrent(request)) notificationStore.error(formatUserFacingError(error));
      this.finish(false);
    }
  }

  async verify(method: string, data: Record<string, JsonValue>): Promise<boolean> {
    const request = this.request;
    if (!request || !this.isCurrent(request)) {
      this.cancel();
      return false;
    }
    // Verification errors stay in AuthenticationDialog so the user can retry.
    const status = await requestEscalation(method, data);
    if (!this.isCurrent(request)) {
      if (this.request === request) this.finish(false);
      return false;
    }
    authStore.apply(status);
    const success = (authStore.escalationExp ?? 0) * 1000 > Date.now();
    this.finish(success);
    return success;
  }

  async drop() {
    if (this.busy) return;
    this.busy = true;
    const userId = authStore.userId;
    try {
      const status = await dropEscalation();
      if (authStore.isLoggedIn && authStore.userId === userId) authStore.apply(status);
    } catch (error) {
      notificationStore.error(formatUserFacingError(error));
    } finally {
      this.busy = false;
    }
  }
}

/** Shared flow hosted by the workspace's EscalationControl. Tokens stay native-only. */
export const escalationFlow = new EscalationFlow();

export function ensureEscalation(): Promise<boolean> {
  return escalationFlow.ensure();
}
