<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getSetting, setSetting } from '$lib/api';
  import type { UpdateChannel } from '$lib/updater';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import TopAppBar from '$lib/components/TopAppBar.svelte';

  const channels: UpdateChannel[] = ['stable', 'beta', 'alpha'];

  let channel = $state<UpdateChannel>('stable');
  let loading = $state(true);
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const channelDescription = $derived($t(`settings.updates.${channel}Description`));

  $effect(() => {
    if (!status) return;
    notificationStore.success(status);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    try {
      const saved = await getSetting('update_channel');
      if (saved === 'stable' || saved === 'beta' || saved === 'alpha') {
        channel = saved;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function saveChannel() {
    saving = true;
    error = null;
    try {
      await setSetting('update_channel', channel);
      status = $t('settings.updates.saved');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<TopAppBar
  title={$t('settings.updates.title')}
  subtitle={$t('settings.updates.description')}
  backLabel={$t('common.back')}
  onBack={() => goto('/home/settings')}
  maxWidth="max-w-3xl"
>
  {#snippet actions()}
    <IconButton icon="done" label={$t('settings.updates.save')} onclick={saveChannel} disabled={loading || saving} />
  {/snippet}
</TopAppBar>

<div class="channel-page">

  <section class="channel-section">
    <div class="section-heading">
      <h2>{$t('settings.updates.updateChannel')}</h2>
      <p>{channelDescription}</p>
    </div>

    <div class="channel-list" role="radiogroup" aria-label={$t('settings.updates.updateChannel')}>
      {#each channels as item}
        <button
          class="channel-row"
          class:active={channel === item}
          role="radio"
          aria-checked={channel === item}
          disabled={loading || saving}
          onclick={() => (channel = item)}
        >
          <span class="channel-icon">
            <Icon name={channel === item ? 'radioChecked' : 'radioUnchecked'} size="20px" />
          </span>
          <span class="channel-copy">
            <span class="channel-name">{$t(`settings.updates.${item}`)}</span>
            <span class="channel-description">{$t(`settings.updates.${item}Description`)}</span>
          </span>
        </button>
      {/each}
    </div>

    <div class="actions">
      <button class="text-action" onclick={() => goto('/home/about')}>
        <Icon name="update" size="18px" />
        {$t('settings.updates.checkInAbout')}
      </button>
    </div>
  </section>
</div>

<style>
  .channel-page {
    width: min(720px, calc(100vw - 3rem));
    margin: 0 auto;
    padding: 2rem 0 3rem;
    display: grid;
    gap: 1.5rem;
  }

  h2 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-weight: 800;
    letter-spacing: 0;
  }

  h2 {
    font-size: 1rem;
  }

  p {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.9rem;
  }

  .channel-section {
    display: grid;
    gap: 1.1rem;
    padding-top: 1.25rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
  }

  .section-heading {
    display: grid;
    gap: 0.3rem;
  }

  .channel-list {
    display: grid;
  }

  .channel-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-height: 4rem;
    padding: 0.85rem 0;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 50%, transparent);
    text-align: left;
    color: var(--color-md3-on-surface-variant);
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .channel-row:first-child {
    border-top: 0;
  }

  .channel-row:hover:not(:disabled),
  .channel-row.active {
    color: var(--color-md3-on-surface);
  }

  .channel-row:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 7%, transparent);
  }

  .channel-icon {
    color: var(--color-md3-primary-emphasis);
    flex: none;
  }

  .channel-copy {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .channel-name {
    color: var(--color-md3-on-surface);
    font: 700 0.95rem var(--font-md3-sans);
  }

  .channel-description {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding-top: 0.25rem;
  }

  .text-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.35rem;
    border-radius: 6px;
    padding: 0 0.85rem;
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    font-weight: 700;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .text-action {
    background: transparent;
    color: var(--color-md3-primary-emphasis);
  }

  .text-action:hover {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 10%, transparent);
  }

  button:disabled {
    opacity: 0.55;
  }

  @media (max-width: 640px) {
    .channel-page {
      width: min(100% - 2rem, 720px);
      padding-top: 1.5rem;
    }
  }
</style>
