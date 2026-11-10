<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
  import { escalationRemaining, formatEscalationRemaining } from '$lib/features/authentication/authentication';
  import Icon from '$lib/shared/ui/Icon.svelte';

  let now = $state(Date.now());
  const remaining = $derived(escalationRemaining(authStore.escalationExp, now));
  onMount(() => {
    const timer = window.setInterval(() => { now = Date.now(); }, 1000);
    return () => window.clearInterval(timer);
  });
</script>

{#if remaining > 0 && authStore.isLoggedIn}
  <span class="escalation-countdown" role="timer" aria-label={$t('authentication.elevated', { values: { time: formatEscalationRemaining(remaining) } })}>
    <Icon name="adminPanelSettings" size="16px" />
    <span class="escalation-label">{$t('authentication.elevatedShort')}</span>
    <span>{formatEscalationRemaining(remaining)}</span>
  </span>
{/if}

<style>
  .escalation-countdown { grid-column: 2; display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--explorer-accent); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  @media (max-width: 800px) { .escalation-countdown { grid-column: 1 / -1; grid-row: 2; padding-bottom: 0.2rem; } }
</style>
