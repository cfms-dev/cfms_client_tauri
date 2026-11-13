<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
  import Icon from '$lib/shared/ui/Icon.svelte';

  let { details = false }: { details?: boolean } = $props();
  const status = $derived(serverStateStore.revocation);
  const warning = $derived(status?.state === 'unknown' || status?.state === 'skipped');
</script>

{#if status && (details || (status.state !== 'checked' && status.state !== 'skipped'))}
  <div class="connection-security" class:warning class:revoked={status.state === 'revoked'} role="status" aria-live="polite">
    <Icon name={status.state === 'checked' ? 'checkCircle' : 'warning'} size="16px" />
    <div>
      <p>{$t(`settings.connection.crlState.${status.state}`)}</p>
      {#if details || warning}
        {#each status.reasons as reason}
          <p class="detail">{$t(`settings.connection.crlReason.${reason}`)}</p>
        {/each}
      {/if}
      {#if details && status.checked_at}
        <p class="detail">{$t('settings.connection.crlCheckedAt')}: {new Date(status.checked_at * 1000).toLocaleString()}</p>
      {/if}
      {#if details && status.valid_until}
        <p class="detail">{$t('settings.connection.crlValidUntil')}: {new Date(status.valid_until * 1000).toLocaleString()}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .connection-security { display: flex; align-items: flex-start; gap: 8px; padding: 12px; border: 1px solid var(--colorNeutralStroke2); border-radius: 8px; color: var(--colorNeutralForeground1); background: var(--colorNeutralBackground1); font: var(--fontSizeBase200)/var(--lineHeightBase200) var(--fontFamilyBase); overflow-wrap: anywhere; }
  .connection-security.warning { color: var(--colorStatusWarningForeground2); background: var(--colorStatusWarningBackground1); }
  .connection-security.revoked { color: var(--colorStatusDangerForeground1); background: var(--colorStatusDangerBackground1); }
  p { margin: 0; }
  .detail { margin-top: 4px; }
  @media (forced-colors: active) { .connection-security, .connection-security.warning, .connection-security.revoked { background: Canvas; color: CanvasText; border-color: CanvasText; } }
</style>
