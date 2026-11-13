<script lang="ts">
  import { untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { setUserUsername, serverErrorStatus } from '$lib/api';
  import { authStore } from './auth-state.svelte';
  import { serverStateStore } from '$lib/features/connection/connection-state.svelte';
  import { ensureEscalation } from './escalation.svelte';
  import { canSetAccountName } from '$lib/features/authentication/auth-permissions';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

  let { userId, username, onClose, onSaved }: {
    userId: string; username: string; onClose: () => void; onSaved: () => void | Promise<void>;
  } = $props();
  let value = $state(untrack(() => username));
  let busy = $state(false);
  let error = $state('');
  const count = $derived(Array.from(value).length);
  const permitted = $derived(canSetAccountName(authStore.permissions, 'username', userId === authStore.userId));
  const valid = $derived(count > 0 && count <= 64 && value !== username);

  async function save() {
    if (!valid || busy || !permitted || !serverStateStore.connected) return;
    const actor = authStore.userId;
    const server = serverStateStore.remoteAddress;
    const current = () => authStore.userId === actor && serverStateStore.remoteAddress === server && authStore.isLoggedIn;
    busy = true; error = '';
    try {
      if (!(await ensureEscalation()) || !current()) return;
      if (!canSetAccountName(authStore.permissions, 'username', userId === actor)) return;
      const status = await setUserUsername(userId, value);
      if (!current()) return;
      authStore.apply(status);
      await onSaved();
      if (current()) onClose();
    } catch (err) {
      if (current()) error = String(err).includes('CFMS_REQUEST_UNCONFIRMED') ? $t('protocol30.unconfirmed')
        : serverErrorStatus(err) === 400 ? $t('protocol30.usernameRejected') : formatUserFacingError(err);
    } finally { busy = false; }
  }
</script>

<ModalFrame title={$t('protocol30.changeUsername')} closeLabel={$t('common.close')} dismissible={!busy} onClose={onClose}>
  <form class="username-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <p>{$t('protocol30.usernameHint')}</p>
    <MdOutlinedField inputId="new-username" label={$t('settings.account.username')} error={count > 64} disabled={busy}>
      <input id="new-username" data-focus-ring="delegated" class="cfms-native-field" bind:value autocomplete="off" disabled={busy} aria-describedby="username-count" aria-invalid={count > 64} />
    </MdOutlinedField>
    <span id="username-count">{count}/64</span>
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    <div class="actions">
      <FluentButton appearance="outline" disabled={busy} onclick={onClose}>{$t('common.cancel')}</FluentButton>
      <FluentButton type="submit" appearance="primary" disabled={!valid || busy || !permitted || !serverStateStore.connected}>{$t(busy ? 'common.saving' : 'common.save')}</FluentButton>
    </div>
  </form>
</ModalFrame>

<style>
  .username-form { display: grid; gap: 16px; padding: 24px; color: var(--colorNeutralForeground1); }
  p { margin: 0; line-height: 1.5; }
  #username-count { color: var(--colorNeutralForeground2); font-size: 12px; margin-top: -12px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .error { color: var(--colorStatusDangerForeground1); }
</style>
