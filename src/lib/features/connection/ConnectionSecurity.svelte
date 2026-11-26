<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
  import { formatDate } from '$lib/shared/format/values';
  import ConnectionSecurityNotice from './ConnectionSecurityNotice.svelte';

  let { details = false }: { details?: boolean } = $props();
  const status = $derived(serverStateStore.revocation);
  const warning = $derived(status?.state === 'unknown' || status?.state === 'skipped');
</script>

{#if status && (details || (status.state !== 'checked' && status.state !== 'skipped'))}
  <ConnectionSecurityNotice
    title={$t(`settings.connection.crlState.${status.state}`)}
    tone={warning ? 'warning' : status.state === 'revoked' ? 'danger' : 'neutral'}
    checked={status.state === 'checked'}
  >
    {#if ((details || warning) && status.reasons.length) || (details && (status.checked_at || status.valid_until))}
      {#if details || warning}
        {#each status.reasons as reason}
          <p>{$t(`settings.connection.crlReason.${reason}`)}</p>
        {/each}
      {/if}
      {#if details && status.checked_at}
        <p>{$t('settings.connection.crlCheckedAt')}: {formatDate(status.checked_at)}</p>
      {/if}
      {#if details && status.valid_until}
        <p>{$t('settings.connection.crlValidUntil')}: {formatDate(status.valid_until)}</p>
      {/if}
    {/if}
  </ConnectionSecurityNotice>
{/if}
