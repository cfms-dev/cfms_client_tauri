<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getSetting, setSetting } from '$lib/api';
  import {
    checkAppUpdate,
    formatBytes,
    installAppUpdate,
    relaunchApp,
    type AppUpdateMetadata,
    type UpdateChannel,
    type UpdateProgressSnapshot,
  } from '$lib/updater';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  const channels: UpdateChannel[] = ['stable', 'beta', 'alpha'];

  let channel = $state<UpdateChannel>('stable');
  let checkedChannel = $state<UpdateChannel | null>(null);
  let appVersion = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let checking = $state(false);
  let installing = $state(false);
  let installed = $state(false);
  let update = $state<AppUpdateMetadata | null>(null);
  let progress = $state<UpdateProgressSnapshot>({
    phase: 'idle',
    downloadedBytes: 0,
    totalBytes: null,
    progress: null,
  });
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const channelDescription = $derived($t(`settings.updates.${channel}Description`));
  const progressPercent = $derived(
    progress.progress === null ? null : Math.round(progress.progress * 1000) / 10,
  );
  const progressLabel = $derived.by(() => {
    if (progress.phase === 'installing') return $t('settings.updates.installing');
    if (progress.phase === 'finished') return $t('settings.updates.installed');
    if (progress.totalBytes) {
      return $t('settings.updates.downloadProgress', {
        values: {
          percent: progressPercent?.toFixed(1) ?? '0.0',
          current: formatBytes(progress.downloadedBytes),
          total: formatBytes(progress.totalBytes),
        },
      });
    }
    if (progress.downloadedBytes > 0) {
      return $t('settings.updates.downloadedBytes', {
        values: { current: formatBytes(progress.downloadedBytes) },
      });
    }
    return $t('settings.updates.preparingDownload');
  });

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
      const [saved, version] = await Promise.all([
        getSetting('update_channel'),
        getVersion().catch(() => $t('common.unknown')),
      ]);
      if (saved === 'stable' || saved === 'beta' || saved === 'alpha') {
        channel = saved;
      }
      appVersion = version;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function selectChannel(next: UpdateChannel) {
    if (installing || checking || channel === next) return;
    channel = next;
    update = null;
    checkedChannel = null;
    installed = false;
    progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };
  }

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

  async function checkForUpdates() {
    checking = true;
    error = null;
    update = null;
    installed = false;
    progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };

    try {
      const found = await checkAppUpdate(channel);
      checkedChannel = channel;
      update = found;
      if (!found) status = $t('settings.updates.latest');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      checking = false;
    }
  }

  async function installUpdate() {
    if (!update) return;
    installing = true;
    error = null;
    installed = false;

    try {
      await installAppUpdate((snapshot) => {
        progress = snapshot;
      });
      installed = true;
      status = $t('settings.updates.installComplete');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };
    } finally {
      installing = false;
    }
  }

  async function restartNow() {
    try {
      await relaunchApp();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function formatReleaseDate(value?: string | null): string {
    if (!value) return $t('common.unknown');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }
</script>

<div class="p-6 space-y-5 max-w-2xl mx-auto">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/settings')}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="space-y-1">
    <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.updates.title')}
    </h1>
    <p class="text-sm text-md3-on-surface-variant">
      {$t('settings.updates.description')}
    </p>
  </div>

  <section class="update-panel bg-md3-surface-container/75 backdrop-blur-sm border border-md3-outline p-5 space-y-5">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="space-y-2">
        <div class="flex items-center gap-2 text-md3-primary-emphasis">
          <Icon name="browserUpdated" size="28px" />
          <span class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('settings.updates.softwareUpdate')}
          </span>
        </div>
        <div class="grid gap-1 text-sm">
          <p class="text-md3-on-surface-variant">
            <span class="text-md3-on-surface">{$t('settings.updates.currentVersion')}:</span>
            {appVersion || '...'}
          </p>
          <p class="text-md3-on-surface-variant">
            <span class="text-md3-on-surface">{$t('settings.updates.channel')}:</span>
            {channelDescription}
          </p>
        </div>
      </div>

      {#if checking}
        <div class="status-chip text-md3-primary-emphasis">
          <ProgressRing size={16} strokeWidth={2.4} label={$t('about.checkingUpdates')} />
          {$t('about.checkingUpdates')}
        </div>
      {:else if installed}
        <div class="status-chip text-md3-success">
          <Icon name="checkCircle" size="18px" />
          {$t('settings.updates.installed')}
        </div>
      {:else if update}
        <div class="status-chip text-md3-warning">
          <Icon name="update" size="18px" />
          {$t('settings.updates.available')}
        </div>
      {:else if checkedChannel}
        <div class="status-chip text-md3-success">
          <Icon name="checkCircle" size="18px" />
          {$t('settings.updates.latest')}
        </div>
      {/if}
    </div>

    <div class="space-y-2">
      <p class="text-xs font-medium uppercase tracking-[0.08em] text-md3-on-surface-variant">
        {$t('settings.updates.updateChannel')}
      </p>
      <div class="grid grid-cols-3 gap-2 rounded-xl bg-md3-surface/50 p-1 border border-md3-outline/70">
        {#each channels as item}
          <button
            class="channel-button {channel === item ? 'channel-button--active' : ''}"
            aria-pressed={channel === item}
            disabled={loading || saving || checking || installing}
            onclick={() => selectChannel(item)}
          >
            {$t(`settings.updates.${item}`)}
          </button>
        {/each}
      </div>
      <p class="text-xs text-md3-on-surface-variant leading-relaxed">
        {channelDescription}
      </p>
    </div>

    {#if update}
      <div class="release-card animate-fade-scale-in">
        <div class="flex items-start gap-3">
          <div class="release-icon">
            <Icon name="downloadDone" size="24px" />
          </div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 class="text-base font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
                {$t('settings.updates.newVersion', { values: { version: update.version } })}
              </h2>
              <span class="text-xs text-md3-on-surface-variant">
                {formatReleaseDate(update.date)}
              </span>
            </div>
            {#if update.body}
              <pre class="release-notes">{update.body}</pre>
            {/if}
            <a
              class="inline-flex items-center gap-1.5 text-sm text-md3-primary-emphasis hover:brightness-125 transition"
              href={update.releaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              {$t('settings.updates.openRelease')}
              <Icon name="openInNew" size="16px" />
            </a>
          </div>
        </div>
      </div>
    {/if}

    {#if installing || progress.phase !== 'idle'}
      <div class="space-y-2 animate-fade-scale-in">
        <div class="progress-track" aria-label={progressLabel}>
          <div
            class="progress-fill {progress.progress === null && progress.phase === 'downloading' ? 'animate-progress-stripe' : ''}"
            style="width: {progress.progress === null ? 38 : progress.progress * 100}%;"
          ></div>
        </div>
        <div class="flex items-center justify-between gap-3 text-xs text-md3-on-surface-variant">
          <span>{progressLabel}</span>
          {#if progressPercent !== null}
            <span>{progressPercent.toFixed(1)}%</span>
          {/if}
        </div>
      </div>
    {/if}

    <div class="flex flex-wrap gap-2">
      <button
        class="action-button action-button--filled"
        style="font-family: var(--font-md3-sans);"
        onclick={checkForUpdates}
        disabled={loading || checking || installing}
      >
        {#if checking}
          <ProgressRing size={18} strokeWidth={2.4} label={$t('about.checkingUpdates')} />
        {:else}
          <Icon name="update" size="18px" />
        {/if}
        {$t('settings.updates.check')}
      </button>

      <button
        class="action-button action-button--tonal"
        style="font-family: var(--font-md3-sans);"
        onclick={saveChannel}
        disabled={loading || saving || checking || installing}
      >
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.updates.save')}
      </button>

      {#if update && !installed}
        <button
          class="action-button action-button--success"
          style="font-family: var(--font-md3-sans);"
          onclick={installUpdate}
          disabled={installing || checking}
        >
          {#if installing}
            <ProgressRing size={18} strokeWidth={2.4} label={$t('settings.updates.installing')} />
          {:else}
            <Icon name="download" size="18px" />
          {/if}
          {$t('settings.updates.downloadAndInstall')}
        </button>
      {/if}

      {#if installed}
        <button
          class="action-button action-button--success"
          style="font-family: var(--font-md3-sans);"
          onclick={restartNow}
        >
          <Icon name="refresh" size="18px" />
          {$t('settings.updates.restartNow')}
        </button>
      {/if}
    </div>
  </section>
</div>

<style>
  .update-panel {
    border-radius: 12px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.2);
  }

  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    border-radius: 9999px;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    background: color-mix(in srgb, currentColor 12%, transparent);
    padding: 0.35rem 0.7rem;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .channel-button {
    min-width: 0;
    min-height: 2.35rem;
    border-radius: 0.7rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
    font-weight: 600;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .channel-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 14%, transparent);
    color: var(--color-md3-on-surface);
  }

  .channel-button--active {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-md3-primary-emphasis) 35%, transparent);
  }

  .release-card {
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-md3-primary-emphasis) 26%, var(--color-md3-outline));
    background:
      linear-gradient(135deg, rgba(143, 180, 255, 0.12), rgba(52, 211, 153, 0.08)),
      color-mix(in srgb, var(--color-md3-surface-container-high) 72%, transparent);
    padding: 1rem;
  }

  .release-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.85rem;
    color: var(--color-md3-primary-emphasis);
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 16%, transparent);
    flex: none;
  }

  .release-notes {
    max-height: 10rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--color-md3-surface) 68%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 70%, transparent);
    padding: 0.75rem;
    color: var(--color-md3-on-surface-variant);
    font: 0.8125rem/1.5 var(--font-md3-sans);
  }

  .progress-track {
    height: 0.55rem;
    overflow: hidden;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-md3-outline) 55%, transparent);
  }

  .progress-fill {
    height: 100%;
    min-width: 0.65rem;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--color-md3-primary-emphasis), var(--color-md3-success));
    transition: width var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate);
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    border-radius: 9999px;
    padding: 0 1rem;
    font-size: 0.875rem;
    font-weight: 700;
    transition:
      filter var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .action-button:hover:not(:disabled) {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }

  .action-button:disabled {
    opacity: 0.55;
  }

  .action-button--filled {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  .action-button--tonal {
    background: var(--color-md3-surface-container-high);
    color: var(--color-md3-on-surface);
  }

  .action-button--success {
    background: var(--color-md3-success-container);
    color: var(--color-md3-on-success-container);
  }
</style>
