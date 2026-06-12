<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import { getSetting, setSetting } from '$lib/api';
  import type { UpdateChannel } from '$lib/updater';
  import { navigateUp } from '$lib/navigation';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';

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

<div class="channel-page">
  <button class="back-button" onclick={() => navigateUp(page.url.pathname)}>
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <header class="page-header">
    <h1>{$t('settings.updates.title')}</h1>
    <p>{$t('settings.updates.description')}</p>
  </header>

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
      <button class="primary-action" onclick={saveChannel} disabled={loading || saving}>
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.updates.save')}
      </button>
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

  .back-button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    width: fit-content;
    color: var(--color-md3-on-surface-variant);
    font: 0.875rem var(--font-md3-sans);
    transition: color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .back-button:hover {
    color: var(--color-md3-on-surface);
  }

  .page-header {
    display: grid;
    gap: 0.35rem;
  }

  h1,
  h2 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-weight: 800;
    letter-spacing: 0;
  }

  h1 {
    font-size: clamp(1.55rem, 4vw, 2.15rem);
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

  .primary-action,
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

  .primary-action {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
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
