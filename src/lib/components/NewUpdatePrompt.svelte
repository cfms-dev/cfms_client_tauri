<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { appUpdateState } from '$lib/app-update-state.svelte';
  import type { UpdateNotificationCopy } from '$lib/update-notifications';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  const promptedVersionKey = 'cfms_update_prompted_version';

  let promptedVersion = $state<string | null>(browser ? localStorage.getItem(promptedVersionKey) : null);
  let visible = $state(false);
  let activeVersion = $state<string | null>(null);

  const update = $derived(appUpdateState.update);
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
    if (!browser || !update) return;
    if (activeVersion === update.version) return;
    if (!isVersionNewerThanPrompted(update.version, promptedVersion)) return;

    activeVersion = update.version;
    promptedVersion = update.version;
    localStorage.setItem(promptedVersionKey, update.version);
    visible = true;
  });

  function closePrompt() {
    visible = false;
  }

  async function installUpdate() {
    if (!update || appUpdateState.installing) return;
    visible = false;

    try {
      await goto('/home/about');
      await appUpdateState.install(createUpdateNotificationCopy());
    } catch (err) {
      if (!appUpdateState.installError) {
        notificationStore.error(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function openReleasePage() {
    if (!update?.releaseUrl) return;
    try {
      await openUrl(update.releaseUrl);
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

{#if visible && update}
  <ModalFrame
    title={$t('updatesPrompt.title')}
    maxWidth="max-w-3xl"
    closeLabel={$t('common.close')}
    dismissible={!appUpdateState.installing}
    onClose={() => {
      if (!appUpdateState.installing) closePrompt();
    }}
  >
    <div class="prompt-content">
      <div class="release-icon" aria-hidden="true">
        <Icon name="newReleases" size="42px" />
      </div>

      <div class="copy">
        <p class="eyebrow">{$t('settings.updates.available')}</p>
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

      <div class="actions">
        <button type="button" class="primary-action" onclick={installUpdate} disabled={appUpdateState.installing}>
          {#if appUpdateState.installing}
            <ProgressRing size={18} strokeWidth={2.4} label={$t('settings.updates.installing')} />
          {:else}
            <Icon name="download" size="18px" />
          {/if}
          {installButtonLabel}
        </button>

        <button type="button" class="tonal-action" onclick={openReleasePage} disabled={appUpdateState.installing}>
          <Icon name="openInNew" size="18px" />
          {$t('settings.updates.openRelease')}
        </button>

        <button type="button" class="text-action" onclick={closePrompt} disabled={appUpdateState.installing}>
          {$t('settings.updates.notNow')}
        </button>
      </div>
    </div>
  </ModalFrame>
{/if}

<style>
  .prompt-content {
    display: grid;
    justify-items: center;
    gap: 1rem;
    padding: 1.5rem;
    text-align: center;
  }

  .release-icon {
    display: grid;
    width: 4rem;
    height: 4rem;
    place-items: center;
    border-radius: 1rem;
    color: var(--color-md3-primary-emphasis);
    background: var(--color-md3-primary-container);
  }

  .copy {
    display: grid;
    gap: 0.5rem;
    justify-items: center;
  }

  .eyebrow,
  .subtitle {
    margin: 0;
  }

  .eyebrow {
    color: var(--color-md3-primary-emphasis);
    font: 750 0.78rem/1.25 var(--font-md3-sans);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .subtitle {
    color: var(--color-md3-on-surface-variant);
    max-width: 100%;
    font: 500 0.9375rem/1.55 var(--font-md3-sans);
  }

  .notes {
    width: min(720px, 100%);
    max-height: min(34vh, 18rem);
    overflow: auto;
    border-block: 1px solid var(--color-md3-outline);
    margin-top: 0.15rem;
    padding: 1rem 0.9rem 1rem 0;
    text-align: left;
    color: var(--color-md3-on-surface-variant);
    scrollbar-gutter: stable;
  }

  .notes :global(.markdown-view) {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.95rem;
    line-height: 1.7;
  }

  .notes :global(.markdown-view :where(h1, h2, h3, h4, h5, h6)) {
    color: var(--color-md3-on-surface);
    font-size: 1.05rem;
    line-height: 1.45;
  }

  .notes :global(.markdown-view li::marker),
  .notes :global(.markdown-view a) {
    color: var(--color-md3-primary-emphasis);
  }

  .notes::-webkit-scrollbar {
    width: 6px;
  }

  .notes::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--color-md3-on-surface-variant);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
    padding-top: 0.3rem;
  }

  .primary-action,
  .tonal-action,
  .text-action {
    display: inline-flex;
    min-height: 2.625rem;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    border-radius: var(--explorer-radius-small, 6px);
    padding: 0 1.15rem;
    font-family: var(--font-md3-sans);
    font-size: 0.9rem;
    font-weight: 750;
    line-height: 1;
    white-space: nowrap;
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .primary-action :global(.material-symbols-outlined),
  .tonal-action :global(.material-symbols-outlined) {
    flex: 0 0 auto;
  }

  .primary-action {
    min-width: 10rem;
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
  }

  .tonal-action {
    min-width: 10.75rem;
    background: color-mix(in srgb, var(--color-md3-primary-container) 74%, transparent);
    color: var(--color-md3-on-primary-container);
  }

  .text-action {
    min-width: 6.5rem;
    background: transparent;
    color: var(--color-md3-on-surface-variant);
  }

  .primary-action:hover:not(:disabled),
  .tonal-action:hover:not(:disabled),
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
    .prompt-content {
      padding: 1.25rem;
    }

    .release-icon {
      width: 4.4rem;
      height: 4.4rem;
    }

    .actions {
      width: 100%;
      gap: 0.6rem;
    }

    .primary-action,
    .tonal-action,
    .text-action {
      width: 100%;
    }
  }
</style>
