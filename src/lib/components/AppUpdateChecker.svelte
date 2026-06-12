<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getSetting } from '$lib/api';
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

  let channel = $state<UpdateChannel>('stable');
  let checked = $state(false);
  let appVersion = $state('');
  let loading = $state(true);
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

  const channelLabel = $derived($t(`settings.updates.${channel}`));
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
  const installCompleteMessage = $derived(
    update?.installMode === 'android-apk'
      ? $t('settings.updates.installCompleteAndroid')
      : $t('settings.updates.installComplete'),
  );
  const installButtonLabel = $derived(
    update?.installMode === 'android-apk'
      ? $t('settings.updates.downloadAndOpenInstaller')
      : $t('settings.updates.downloadAndInstall'),
  );

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

  async function checkForUpdates() {
    checking = true;
    error = null;
    update = null;
    installed = false;
    progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };

    try {
      const found = await checkAppUpdate(channel);
      checked = true;
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
      status = installCompleteMessage;
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

<section class="update-checker">
  <div class="update-header">
    <div>
      <h2>{$t('about.softwareUpdate')}</h2>
      <p>
        {$t('settings.updates.currentVersion')}: {appVersion || '...'} ·
        {$t('settings.updates.channel')}: {channelLabel}
      </p>
    </div>

    {#if checking}
      <span class="inline-status text-md3-primary-emphasis">
        <ProgressRing size={16} strokeWidth={2.4} label={$t('about.checkingUpdates')} />
        {$t('about.checkingUpdates')}
      </span>
    {:else if installed}
      <span class="inline-status text-md3-success">
        <Icon name="checkCircle" size="18px" />
        {$t('settings.updates.installed')}
      </span>
    {:else if update}
      <span class="inline-status text-md3-warning">
        <Icon name="update" size="18px" />
        {$t('settings.updates.available')}
      </span>
    {:else if checked}
      <span class="inline-status text-md3-success">
        <Icon name="checkCircle" size="18px" />
        {$t('settings.updates.latest')}
      </span>
    {/if}
  </div>

  {#if update}
    <div class="release-block animate-fade-scale-in">
      <div class="release-title">
        <h3>{$t('settings.updates.newVersion', { values: { version: update.version } })}</h3>
        <span>{formatReleaseDate(update.date)}</span>
      </div>
      {#if update.body}
        <pre>{update.body}</pre>
      {/if}
      <a href={update.releaseUrl} target="_blank" rel="noreferrer">
        {$t('settings.updates.openRelease')}
        <Icon name="openInNew" size="16px" />
      </a>
    </div>
  {/if}

  {#if installing || progress.phase !== 'idle'}
    <div class="progress-block animate-fade-scale-in">
      <div class="progress-track" aria-label={progressLabel}>
        <div
          class="progress-fill {progress.progress === null && progress.phase === 'downloading' ? 'animate-progress-stripe' : ''}"
          style="width: {progress.progress === null ? 38 : progress.progress * 100}%;"
        ></div>
      </div>
      <div class="progress-label">
        <span>{progressLabel}</span>
        {#if progressPercent !== null}
          <span>{progressPercent.toFixed(1)}%</span>
        {/if}
      </div>
    </div>
  {/if}

  <div class="actions">
    <button class="primary-action" onclick={checkForUpdates} disabled={loading || checking || installing}>
      {#if checking}
        <ProgressRing size={18} strokeWidth={2.4} label={$t('about.checkingUpdates')} />
      {:else}
        <Icon name="update" size="18px" />
      {/if}
      {$t('settings.updates.check')}
    </button>

    {#if update && !installed}
      <button class="success-action" onclick={installUpdate} disabled={installing || checking}>
        {#if installing}
          <ProgressRing size={18} strokeWidth={2.4} label={$t('settings.updates.installing')} />
        {:else}
          <Icon name="download" size="18px" />
        {/if}
        {installButtonLabel}
      </button>
    {/if}

    {#if installed && update?.installMode !== 'android-apk'}
      <button class="success-action" onclick={restartNow}>
        <Icon name="refresh" size="18px" />
        {$t('settings.updates.restartNow')}
      </button>
    {/if}

    <button class="text-action" onclick={() => goto('/home/settings/updates')} disabled={checking || installing}>
      <Icon name="settings" size="18px" />
      {$t('settings.updates.configureChannel')}
    </button>
  </div>
</section>

<style>
  .update-checker {
    display: grid;
    gap: 1rem;
    padding-top: 1.25rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
  }

  .update-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  h2,
  h3 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-weight: 700;
    letter-spacing: 0;
  }

  h2 {
    font-size: 1rem;
  }

  h3 {
    font-size: 0.95rem;
  }

  p {
    margin: 0.3rem 0 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
  }

  .inline-status {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .release-block {
    display: grid;
    gap: 0.7rem;
    padding-block: 0.25rem;
  }

  .release-title {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .release-title span {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  pre {
    max-height: 10rem;
    overflow: auto;
    margin: 0;
    padding-left: 0.75rem;
    border-left: 2px solid color-mix(in srgb, var(--color-md3-primary-emphasis) 58%, transparent);
    color: var(--color-md3-on-surface-variant);
    font: 0.8125rem/1.55 var(--font-md3-sans);
    white-space: pre-wrap;
    word-break: break-word;
  }

  a {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: fit-content;
    color: var(--color-md3-primary-emphasis);
    font-size: 0.875rem;
    transition: filter var(--motion-duration-short4) var(--motion-easing-standard);
  }

  a:hover {
    filter: brightness(1.18);
  }

  .progress-block {
    display: grid;
    gap: 0.55rem;
  }

  .progress-track {
    height: 0.3rem;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-md3-outline) 55%, transparent);
  }

  .progress-fill {
    height: 100%;
    min-width: 0.65rem;
    background: linear-gradient(90deg, var(--color-md3-primary-emphasis), var(--color-md3-success));
    transition: width var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate);
  }

  .progress-label {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding-top: 0.25rem;
  }

  button {
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

  button:disabled {
    opacity: 0.55;
  }

  .primary-action {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  .success-action {
    background: var(--color-md3-success-container);
    color: var(--color-md3-on-success-container);
  }

  .text-action {
    background: transparent;
    color: var(--color-md3-primary-emphasis);
  }

  .text-action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 10%, transparent);
  }

  @media (max-width: 640px) {
    .update-header,
    .release-title {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
