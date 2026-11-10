<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    formatBytes,
    relaunchApp,
  } from '$lib/api/updates';
  import { appUpdateState } from '$lib/features/updates/app-update-state.svelte.ts';
  import type { UpdateNotificationCopy } from '$lib/features/updates/update-notifications';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MarkdownView from '$lib/shared/ui/MarkdownView.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  interface Props {
    currentVersion: string | null;
    currentVersionLoaded: boolean;
    protocolVersion: number | null;
    protocolVersionLoaded: boolean;
    onOpenFeatureTour?: () => void | Promise<void>;
  }

  let {
    currentVersion,
    currentVersionLoaded,
    protocolVersion,
    protocolVersionLoaded,
    onOpenFeatureTour,
  }: Props = $props();

  let loading = $state(true);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const channelLabel = $derived($t(`settings.updates.${appUpdateState.channel}`));
  const progressPercent = $derived(
    appUpdateState.progress.progress === null ? null : Math.round(appUpdateState.progress.progress * 1000) / 10,
  );
  const progressLabel = $derived.by(() => {
    const progress = appUpdateState.progress;
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
    appUpdateState.update?.installMode === 'android-apk'
      ? $t('settings.updates.installCompleteAndroid')
      : $t('settings.updates.installComplete'),
  );
  const installButtonLabel = $derived(
    appUpdateState.update?.installMode === 'android-apk'
      ? $t('settings.updates.downloadAndOpenInstaller')
      : $t('settings.updates.downloadAndInstall'),
  );
  const automaticCheckPauseLabel = $derived.by(() => {
    const pause = appUpdateState.automaticCheckPause;
    if (pause.mode === 'indefinite') return $t('settings.updates.pausedIndefinitely');
    if (pause.mode === 'until') {
      return $t('settings.updates.pausedUntil', {
        values: { date: formatPauseDate(pause.until) },
      });
    }
    return null;
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

  $effect(() => {
    if (!appUpdateState.installError) return;
    notificationStore.error(appUpdateState.installError);
    appUpdateState.installError = null;
  });

  onMount(async () => {
    try {
      await Promise.all([
        appUpdateState.ensureChannel(),
        appUpdateState.ensureAutomaticCheckPause(),
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function checkForUpdates() {
    error = null;

    const found = await appUpdateState.check({ force: true });
    if (appUpdateState.error) {
      error = appUpdateState.error;
    } else if (!found) {
      status = $t('settings.updates.latest');
    }
  }

  async function installUpdate() {
    if (!appUpdateState.update) return;
    error = null;

    try {
      await appUpdateState.install(createUpdateNotificationCopy());
      status = installCompleteMessage;
    } catch {
      /* Shared install errors are surfaced through appUpdateState.installError. */
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

  function formatPauseDate(value: number): string {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function createUpdateNotificationCopy(): UpdateNotificationCopy {
    return {
      title: $t('about.softwareUpdate'),
      preparingDownload: $t('settings.updates.preparingDownload'),
      installing: $t('settings.updates.installing'),
      installed: installCompleteMessage,
      downloadProgress: (values) => $t('settings.updates.downloadProgress', { values }),
      downloadedBytes: (values) => $t('settings.updates.downloadedBytes', { values }),
    };
  }
</script>

<section class="update-checker" aria-labelledby="update-heading">
  <div class="update-header">
    <h2 id="update-heading">{$t('about.softwareUpdate')}</h2>

    <dl class="runtime-summary" aria-label={$t('about.runtimeSummary')}>
      <div>
        <dt>{$t('settings.updates.currentVersion')}</dt>
        <dd class="technical-value" aria-busy={!currentVersionLoaded}>
          {#if currentVersionLoaded}
            {currentVersion ?? $t('common.unknown')}
          {:else}
            <span class="loading-value" aria-hidden="true"></span>
            <span class="visually-hidden">{$t('common.loading')}</span>
          {/if}
        </dd>
      </div>

      <div>
        <dt>{$t('about.protocol')}</dt>
        <dd class="technical-value" aria-busy={!protocolVersionLoaded}>
          {#if protocolVersionLoaded}
            {protocolVersion ?? $t('common.unknown')}
          {:else}
            <span class="loading-value loading-value--short" aria-hidden="true"></span>
            <span class="visually-hidden">{$t('common.loading')}</span>
          {/if}
        </dd>
      </div>

      <div>
        <dt>{$t('settings.updates.channel')}</dt>
        <dd aria-busy={loading}>
          {#if loading}
            <span class="loading-value loading-value--channel" aria-hidden="true"></span>
            <span class="visually-hidden">{$t('common.loading')}</span>
          {:else}
            {channelLabel}
          {/if}
        </dd>
      </div>

      <div class="runtime-status">
        <dt>{$t('about.updateStatus')}</dt>
        <dd class="status-region" aria-live="polite" aria-atomic="true">
          {#if appUpdateState.checking}
            <span class="inline-status status-checking">
              <ProgressRing size={16} strokeWidth={2.4} label={$t('about.checkingUpdates')} />
              {$t('about.checkingUpdates')}
            </span>
          {:else if appUpdateState.installed}
            <span class="inline-status status-success">
              <Icon name="checkCircle" size="18px" />
              {$t('settings.updates.installed')}
            </span>
          {:else if appUpdateState.update}
            <span class="inline-status status-warning">
              <Icon name="update" size="18px" />
              {$t('settings.updates.available')}
            </span>
          {:else if appUpdateState.checked}
            <span class="inline-status status-success">
              <Icon name="checkCircle" size="18px" />
              {$t('settings.updates.latest')}
            </span>
          {:else if automaticCheckPauseLabel}
            <span class="inline-status status-warning">
              <Icon name="pauseCircle" size="18px" />
              {automaticCheckPauseLabel}
            </span>
          {:else}
            <span class="inline-status status-neutral">{$t('about.updateNotChecked')}</span>
          {/if}
        </dd>
      </div>
    </dl>
  </div>

  {#if appUpdateState.update}
    <div class="release-block animate-fade-scale-in">
      <div class="release-title">
        <h3>{$t('settings.updates.newVersion', { values: { version: appUpdateState.update.version } })}</h3>
        <span>{formatReleaseDate(appUpdateState.update.date)}</span>
      </div>
      {#if appUpdateState.update.body}
        <div class="release-notes">
          <MarkdownView content={appUpdateState.update.body} compact />
        </div>
      {/if}
      <a href={appUpdateState.update.releaseUrl} target="_blank" rel="noreferrer">
        {$t('settings.updates.openRelease')}
        <Icon name="openInNew" size="16px" />
      </a>
    </div>
  {/if}

  {#if appUpdateState.installing || appUpdateState.progress.phase !== 'idle'}
    <div class="progress-block animate-fade-scale-in">
      <div
        class="progress-track"
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progressPercent ?? undefined}
        aria-valuetext={progressLabel}
      >
        <div
          class="progress-fill"
          class:progress-fill--indeterminate={appUpdateState.progress.progress === null && appUpdateState.progress.phase === 'downloading'}
          class:progress-fill--complete={appUpdateState.progress.phase === 'finished'}
          style:transform={appUpdateState.progress.progress === null ? undefined : `scaleX(${appUpdateState.progress.progress})`}
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
    {#if appUpdateState.update && !appUpdateState.installed}
      <FluentButton data-fluent-owner="lib-components-app-update-checker"
        onclick={installUpdate}
        disabled={appUpdateState.installing || appUpdateState.checking}
        type="button"
        appearance="subtle"
        class="success-action"
      >
        {#if appUpdateState.installing}
          <ProgressRing size={18} strokeWidth={2.4} label={$t('settings.updates.installing')} />
        {:else}
          <Icon name="download" size="18px" />
        {/if}
        {installButtonLabel}
      </FluentButton>
    {/if}

    {#if appUpdateState.installed && appUpdateState.update?.installMode !== 'android-apk'}
      <FluentButton data-fluent-owner="lib-components-app-update-checker"
        onclick={restartNow}
        type="button"
        appearance="subtle"
        class="success-action"
      >
        <Icon name="refresh" size="18px" />
        {$t('settings.updates.restartNow')}
      </FluentButton>
    {/if}

    <FluentButton data-fluent-owner="lib-components-app-update-checker"
      onclick={checkForUpdates}
      disabled={loading || appUpdateState.checking || appUpdateState.installing}
      type="button"
      appearance="subtle"
      class={((!appUpdateState.update && !appUpdateState.installed) ? " primary-action" : '') + ((Boolean(appUpdateState.update || appUpdateState.installed)) ? " secondary-action" : '')}
    >
      {#if appUpdateState.checking}
        <ProgressRing size={18} strokeWidth={2.4} label={$t('about.checkingUpdates')} />
      {:else}
        <Icon name="update" size="18px" />
      {/if}
      {$t('settings.updates.check')}
    </FluentButton>

    <FluentButton data-fluent-owner="lib-components-app-update-checker"
      onclick={() => goto('/home/settings/updates')}
      disabled={appUpdateState.checking || appUpdateState.installing}
      type="button"
      appearance="subtle"
      class="text-action"
    >
      <Icon name="settings" size="18px" />
      {$t('settings.updates.configureUpdates')}
    </FluentButton>

    {#if onOpenFeatureTour}
      <FluentButton data-fluent-owner="lib-components-app-update-checker"
        onclick={onOpenFeatureTour}
        disabled={appUpdateState.checking || appUpdateState.installing}
        type="button"
        appearance="subtle"
        class="text-action feature-tour-action"
      >
        <Icon name="wandStars" size="18px" />
        {$t('releaseHighlights.featureTour')}
      </FluentButton>
    {/if}
  </div>
</section>

<style>
  .update-checker {
    display: grid;
    gap: 16px;
    padding-top: 1.5rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
  }

  .update-header {
    display: grid;
    gap: 12px;
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
    font-size: 14px;
  }

  h3 {
    font-size: 14px;
  }

  .runtime-summary {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0.65rem 1.5rem;
    margin: 0;
  }

  .runtime-summary > div {
    display: grid;
    gap: 4px;
    min-width: 5.5rem;
  }

  .runtime-summary dt {
    color: var(--color-md3-on-surface-variant);
    font-family: var(--font-md3-sans);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .runtime-summary dd {
    min-height: 1.5rem;
    margin: 0;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-size: 14px;
    line-height: 1.5;
  }

  .runtime-summary .technical-value {
    font-family: var(--font-md3-mono);
    font-size: 12px;
  }

  .runtime-status {
    flex: 1 1 12rem;
  }

  .inline-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 1.5rem;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .status-region {
    min-height: 1.5rem;
  }

  .status-checking {
    color: var(--color-md3-primary-emphasis);
  }

  .status-success {
    color: var(--color-md3-success);
  }

  .status-warning {
    color: var(--color-md3-warning);
  }

  .status-neutral {
    color: var(--color-md3-on-surface-variant);
    font-weight: 400;
  }

  .loading-value {
    display: block;
    width: 4.8rem;
    height: 0.75rem;
    margin-top: 0.25rem;
    border-radius: 5px;
    background: color-mix(in srgb, var(--color-md3-on-surface-variant) 20%, transparent);
    animation: value-pulse 1.4s ease-in-out infinite;
  }

  .loading-value--short {
    width: 2.4rem;
  }

  .loading-value--channel {
    width: 3.6rem;
  }

  @keyframes value-pulse {
    50% { opacity: 0.42; }
  }

  .release-block {
    display: grid;
    gap: 12px;
    padding-block: 0.25rem;
  }

  .release-title {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  .release-title span {
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    white-space: nowrap;
  }

  .release-notes {
    max-height: 10rem;
    overflow: auto;
    margin: 0;
    padding-left: 0.75rem;
    border-left: 2px solid color-mix(in srgb, var(--color-md3-primary-emphasis) 58%, transparent);
  }

  a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: fit-content;
    color: var(--color-md3-primary-emphasis);
    font-size: 14px;
    transition: filter var(--motion-duration-short4) var(--motion-easing-standard);
  }

  a:hover {
    filter: none;
  }

  .progress-block {
    display: grid;
    gap: 8px;
  }

  .progress-track {
    height: 0.35rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-md3-outline) 55%, transparent);
  }

  .progress-fill {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--colorCompoundBrandForeground1);
    transform: scaleX(0);
    transform-origin: left center;
    transition: transform var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate);
  }

  .progress-fill--complete {
    background: var(--color-md3-success);
  }

  .progress-fill--indeterminate {
    width: 34%;
    animation: progress-travel 1.2s var(--motion-easing-emphasized-decelerate) infinite;
  }

  @keyframes progress-travel {
    from { transform: translateX(-110%); }
    to { transform: translateX(320%); }
  }

  .progress-label {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 0.25rem;
  }

  :global(.cfms-button[data-fluent-owner="lib-components-app-update-checker"]) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 2.35rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0 0.85rem;
    font-family: var(--font-md3-sans);
    font-size: 14px;
    font-weight: 700;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      border-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  :global(.cfms-button[data-fluent-owner="lib-components-app-update-checker"]:is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  :global(.cfms-button[data-fluent-owner="lib-components-app-update-checker"]:active:not(:is(:disabled, [disabled]))) {
    transform: none;
  }

  :global(.primary-action[data-fluent-owner="lib-components-app-update-checker"]) {
    border: 1px solid transparent;
    color: var(--colorNeutralForegroundOnBrand);
    background: var(--colorBrandBackground);
  }

  :global(.success-action[data-fluent-owner="lib-components-app-update-checker"]) {
    border: 1px solid transparent;
    color: var(--colorNeutralForegroundStaticInverted);
    background: var(--colorStatusSuccessBackground3);
  }

  :global(.primary-action[data-fluent-owner="lib-components-app-update-checker"]:hover:not(:is(:disabled, [disabled]))),
  :global(.success-action[data-fluent-owner="lib-components-app-update-checker"]:hover:not(:is(:disabled, [disabled]))) {
    filter: none;
  }

  :global(.primary-action[data-fluent-owner="lib-components-app-update-checker"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--colorBrandBackgroundHover);
  }

  :global(.primary-action[data-fluent-owner="lib-components-app-update-checker"]:active:not(:is(:disabled, [disabled]))) {
    background: var(--colorBrandBackgroundPressed);
  }

  :global(.secondary-action[data-fluent-owner="lib-components-app-update-checker"]) {
    border: 1px solid var(--color-md3-outline);
    color: var(--color-md3-on-surface);
    background: transparent;
  }

  :global(.secondary-action[data-fluent-owner="lib-components-app-update-checker"]:hover:not(:is(:disabled, [disabled]))) {
    border-color: var(--color-md3-outline-variant);
    background: color-mix(in srgb, var(--color-md3-on-surface) 7%, transparent);
  }

  :global(.text-action[data-fluent-owner="lib-components-app-update-checker"]) {
    background: transparent;
    color: var(--color-md3-primary-emphasis);
  }

  :global(.text-action[data-fluent-owner="lib-components-app-update-checker"]:hover:not(:is(:disabled, [disabled]))) {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 10%, transparent);
  }

  :global(.feature-tour-action[data-fluent-owner="lib-components-app-update-checker"]) {
    margin-inline-start: auto;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .runtime-summary,
    .release-title {
      flex-direction: column;
      align-items: flex-start;
    }

    .runtime-summary {
      gap: 12px;
    }

    .runtime-status {
      flex: none;
    }

    .runtime-summary > div {
      display: grid;
      grid-template-columns: minmax(6.5rem, auto) minmax(0, 1fr);
      align-items: baseline;
      gap: 12px;
      width: 100%;
    }

    :global(.feature-tour-action[data-fluent-owner="lib-components-app-update-checker"]) {
      margin-inline-start: 0;
    }
  }

  @media (pointer: coarse) {
    :global(.cfms-button[data-fluent-owner="lib-components-app-update-checker"]) {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-value,
    .progress-fill--indeterminate {
      animation: none;
    }
  }
</style>
