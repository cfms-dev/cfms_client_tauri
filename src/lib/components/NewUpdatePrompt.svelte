<script lang="ts">
  import { browser } from '$app/environment';
  import { fade } from 'svelte/transition';
  import { _ as t } from 'svelte-i18n';
  import { appUpdateState } from '$lib/app-update-state.svelte';
  import {
    formatBytes,
    installAppUpdate,
    relaunchApp,
    type UpdateProgressSnapshot,
  } from '$lib/updater';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import { flyScale } from '$lib/motion/transitions';
  import { openExternalUrl } from '$lib/open-external';
  import Icon from '$lib/components/Icon.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  const promptedVersionKey = 'cfms_update_prompted_version';

  let promptedVersion = $state<string | null>(browser ? localStorage.getItem(promptedVersionKey) : null);
  let visible = $state(false);
  let activeVersion = $state<string | null>(null);
  let installing = $state(false);
  let installed = $state(false);
  let progress = $state<UpdateProgressSnapshot>({
    phase: 'idle',
    downloadedBytes: 0,
    totalBytes: null,
    progress: null,
  });

  const update = $derived(appUpdateState.update);
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
  const installButtonLabel = $derived(
    update?.installMode === 'android-apk'
      ? $t('settings.updates.downloadAndOpenInstaller')
      : $t('settings.updates.downloadAndInstall'),
  );
  const installCompleteMessage = $derived(
    update?.installMode === 'android-apk'
      ? $t('settings.updates.installCompleteAndroid')
      : $t('settings.updates.installComplete'),
  );

  $effect(() => {
    if (!browser || !authStore.isLoggedIn || !update) return;
    if (activeVersion === update.version) return;
    if (!isVersionNewerThanPrompted(update.version, promptedVersion)) return;

    activeVersion = update.version;
    promptedVersion = update.version;
    localStorage.setItem(promptedVersionKey, update.version);
    installed = false;
    progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };
    visible = true;
  });

  function closePrompt() {
    visible = false;
  }

  async function installUpdate() {
    if (!update || installing) return;
    installing = true;
    installed = false;
    progress = { phase: 'downloading', downloadedBytes: 0, totalBytes: null, progress: null };

    try {
      await installAppUpdate((snapshot) => {
        progress = snapshot;
      });
      installed = true;
      notificationStore.success(installCompleteMessage);
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
      progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };
    } finally {
      installing = false;
    }
  }

  async function restartNow() {
    try {
      await relaunchApp();
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function openReleasePage() {
    if (!update?.releaseUrl) return;
    try {
      await openExternalUrl(update.releaseUrl);
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
    }
  }

  function formatReleaseDate(value?: string | null): string {
    if (!value) return $t('common.unknown');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString();
  }

  function isVersionNewerThanPrompted(candidate: string, prompted: string | null): boolean {
    if (!prompted) return true;
    const candidateVersion = parseSemver(candidate);
    const promptedParsed = parseSemver(prompted);
    if (!candidateVersion || !promptedParsed) return candidate !== prompted;

    for (let i = 0; i < 3; i += 1) {
      if (candidateVersion[i] > promptedParsed[i]) return true;
      if (candidateVersion[i] < promptedParsed[i]) return false;
    }

    return candidateVersion[3] > promptedParsed[3];
  }

  function parseSemver(value: string): [number, number, number, number] | null {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+.]([0-9A-Za-z.-]+))?/u);
    if (!match) return null;
    return [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      prereleaseRank(match[4] ?? null),
    ];
  }

  function prereleaseRank(value: string | null): number {
    if (!value) return 3;
    const lower = value.toLowerCase();
    if (lower.includes('alpha')) return 0;
    if (lower.includes('beta')) return 1;
    if (lower.includes('rc')) return 2;
    return 0;
  }
</script>

{#if visible && update}
  <div
    class="update-prompt fixed inset-0 z-[80] flex min-h-full items-center justify-center overflow-auto px-5 py-10"
    role="dialog"
    aria-modal="true"
    aria-labelledby="new-update-title"
    transition:fade|global={{ duration: 180 }}
  >
    <div class="prompt-content" transition:flyScale|global={{ y: 18, duration: 320 }}>
      <div class="release-icon" aria-hidden="true">
        <Icon name="newReleases" size="58px" />
      </div>

      <div class="copy">
        <p class="eyebrow">{$t('settings.updates.available')}</p>
        <h2 id="new-update-title">{$t('updatesPrompt.title')}</h2>
        <p class="subtitle">
          {$t('updatesPrompt.subtitle', {
            values: {
              version: update.version,
              date: formatReleaseDate(update.date),
            },
          })}
        </p>
      </div>

      {#if update.body}
        <section class="notes" aria-label={$t('updatesPrompt.releaseNotes')}>
          <MarkdownView content={update.body} font="serif" />
        </section>
      {/if}

      {#if installing || progress.phase !== 'idle'}
        <div class="progress-block">
          <div class="progress-track" aria-label={progressLabel}>
            <div
              class="progress-fill {progress.progress === null && progress.phase === 'downloading' ? 'animate-progress-stripe' : ''}"
              style="width: {progress.progress === null ? 0 : progress.progress * 100}%;"
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
        {#if installed && update.installMode !== 'android-apk'}
          <button type="button" class="primary-action" onclick={restartNow}>
            <Icon name="refresh" size="20px" />
            {$t('settings.updates.restartNow')}
          </button>
        {:else}
          <button type="button" class="primary-action" onclick={installUpdate} disabled={installing}>
            {#if installing}
              <ProgressRing size={20} strokeWidth={2.6} label={$t('settings.updates.installing')} />
            {:else}
              <Icon name="download" size="20px" />
            {/if}
            {installButtonLabel}
          </button>
        {/if}

        <button type="button" class="tonal-action" onclick={openReleasePage} disabled={installing}>
          <Icon name="openInNew" size="20px" />
          {$t('settings.updates.openRelease')}
        </button>

        <button type="button" class="text-action" onclick={closePrompt} disabled={installing}>
          {$t('settings.updates.notNow')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .update-prompt {
    min-block-size: 100dvh;
    padding-block-start: calc(var(--safe-area-top, 0px) + 2rem);
    padding-block-end: calc(var(--safe-area-bottom, 0px) + 2rem);
    padding-inline-start: max(1.25rem, var(--safe-area-left, 0px));
    padding-inline-end: max(1.25rem, var(--safe-area-right, 0px));
    background:
      linear-gradient(145deg, rgba(17, 22, 29, 0.98), rgba(18, 24, 32, 0.98)),
      var(--color-md3-surface);
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
  }

  .prompt-content {
    width: min(720px, 100%);
    display: grid;
    justify-items: center;
    gap: 1.25rem;
    text-align: center;
  }

  .release-icon {
    display: block;
    width: 5.25rem;
    height: 5.25rem;
    color: #b9c5ff;
  }

  .copy {
    display: grid;
    gap: 0.45rem;
  }

  .eyebrow,
  .subtitle,
  h2 {
    margin: 0;
  }

  .eyebrow {
    color: rgba(185, 197, 255, 0.92);
    font: 800 0.78rem var(--font-md3-sans);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  h2 {
    color: rgba(248, 250, 252, 0.92);
    font-family: var(--font-md3-sans);
    font-size: clamp(2rem, 6vw, 3.6rem);
    font-weight: 850;
    letter-spacing: 0;
    line-height: 1.05;
  }

  .subtitle {
    color: rgba(248, 250, 252, 0.78);
    font: 0.95rem/1.6 var(--font-md3-sans);
  }

  .notes {
    width: min(640px, 100%);
    max-height: min(36vh, 18rem);
    overflow: auto;
    border-block: 1px solid rgba(226, 232, 240, 0.22);
    padding: 1rem 0.75rem 1rem 0;
    text-align: left;
    color: rgba(248, 250, 252, 0.78);
    scrollbar-gutter: stable;
  }

  .notes :global(.markdown-view) {
    color: rgba(248, 250, 252, 0.78);
    font-size: 1rem;
    line-height: 1.65;
  }

  .notes :global(.markdown-view :where(h1, h2, h3, h4, h5, h6)) {
    color: rgba(248, 250, 252, 0.9);
  }

  .notes :global(.markdown-view li::marker),
  .notes :global(.markdown-view a) {
    color: #b9c5ff;
  }

  .notes::-webkit-scrollbar {
    width: 6px;
  }

  .notes::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(248, 250, 252, 0.72);
  }

  .progress-block {
    width: min(520px, 100%);
    display: grid;
    gap: 0.55rem;
  }

  .progress-track {
    height: 0.32rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-md3-outline) 55%, transparent);
  }

  .progress-fill {
    height: 100%;
    border-radius: inherit;
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
    justify-content: center;
    gap: 0.65rem;
    padding-top: 0.2rem;
  }

  .primary-action,
  .tonal-action,
  .text-action {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 999px;
    padding: 0 1rem;
    font-family: var(--font-md3-sans);
    font-size: 0.9rem;
    font-weight: 800;
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .primary-action {
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
  }

  .tonal-action {
    background: color-mix(in srgb, var(--color-md3-primary-container) 74%, transparent);
    color: var(--color-md3-on-primary-container);
  }

  .text-action {
    background: transparent;
    color: var(--color-md3-on-surface-variant);
  }

  .primary-action:hover:not(:disabled),
  .tonal-action:hover,
  .text-action:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .text-action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-on-surface) 8%, transparent);
    color: var(--color-md3-on-surface);
  }

  button:disabled {
    opacity: 0.55;
  }

  @media (max-width: 640px) {
    .actions {
      width: 100%;
    }

    .primary-action,
    .tonal-action,
    .text-action {
      width: 100%;
    }
  }
</style>
