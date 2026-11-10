<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { fade } from 'svelte/transition';
  import { _ as t } from 'svelte-i18n';
  import { appUpdateState } from '$lib/features/updates/app-update-state.svelte.ts';
  import type { UpdateNotificationCopy } from '$lib/features/updates/update-notifications';
  import { openUrl } from '$lib/shared/platform/native-opener';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import { flyScale } from '$lib/shared/motion/transitions';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MarkdownView from '$lib/shared/ui/MarkdownView.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import { compareAppVersions } from '$lib/features/updates/app-version';

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
    return compareAppVersions(candidate, prompted) > 0;
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

      <div class="actions">
        <FluentButton data-fluent-owner="lib-components-new-update-prompt"
          type="button"
          onclick={installUpdate}
          disabled={appUpdateState.installing}
          appearance="subtle"
          class="primary-action"
        >
          {#if appUpdateState.installing}
            <ProgressRing size={18} strokeWidth={2.4} label={$t('settings.updates.installing')} />
          {:else}
            <Icon name="download" size="18px" />
          {/if}
          {installButtonLabel}
        </FluentButton>

        <FluentButton data-fluent-owner="lib-components-new-update-prompt"
          type="button"
          onclick={openReleasePage}
          disabled={appUpdateState.installing}
          appearance="subtle"
          class="tonal-action"
        >
          <Icon name="openInNew" size="18px" />
          {$t('settings.updates.openRelease')}
        </FluentButton>

        <FluentButton data-fluent-owner="lib-components-new-update-prompt"
          type="button"
          onclick={closePrompt}
          disabled={appUpdateState.installing}
          appearance="subtle"
          class="text-action"
        >
          {$t('settings.updates.notNow')}
        </FluentButton>
      </div>
    </div>
  </div>
{/if}

<style>
  .update-prompt {
    min-block-size: 100dvh;
    padding-block-start: calc(var(--safe-area-top, 0px) + 2.5rem);
    padding-block-end: calc(var(--safe-area-bottom, 0px) + 2.5rem);
    padding-inline-start: max(1.25rem, var(--safe-area-left, 0px));
    padding-inline-end: max(1.25rem, var(--safe-area-right, 0px));
    background: var(--colorNeutralBackground3);
    color: var(--colorNeutralForeground1);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .prompt-content {
    width: min(760px, 100%);
    display: grid;
    justify-items: center;
    gap: 16px;
    text-align: center;
    transform: translateY(-1.75vh);
  }

  .release-icon {
    display: grid;
    width: 4.75rem;
    height: 4.75rem;
    place-items: center;
    color: var(--colorBrandForeground1);
  }

  .copy {
    display: grid;
    gap: 8px;
    justify-items: center;
  }

  .eyebrow,
  .subtitle,
  h2 {
    margin: 0;
  }

  .eyebrow {
    color: var(--colorBrandForeground1);
    font: 600 14px/20px var(--font-md3-sans);
  }

  h2 {
    color: var(--colorNeutralForeground1);
    font-family: var(--font-md3-sans);
    font-size: 28px;
    font-weight: 600;
    letter-spacing: 0;
    line-height: 36px;
  }

  .subtitle {
    color: var(--colorNeutralForeground3);
    max-width: 100%;
    font: 500 16px/22px var(--font-md3-sans);
  }

  .notes {
    width: min(720px, 100%);
    max-height: min(34vh, 18rem);
    overflow: auto;
    border-block: 1px solid var(--colorNeutralStroke2);
    margin-top: 0.15rem;
    padding: 1rem 0.9rem 1rem 0;
    text-align: left;
    color: var(--colorNeutralForeground3);
    scrollbar-gutter: stable;
  }

  .notes :global(.markdown-view) {
    color: var(--colorNeutralForeground3);
    font-size: 16px;
    line-height: 1.7;
  }

  .notes :global(.markdown-view :where(h1, h2, h3, h4, h5, h6)) {
    color: var(--colorNeutralForeground1);
    font-size: 28px;
    line-height: 1.45;
  }

  .notes :global(.markdown-view li::marker),
  .notes :global(.markdown-view a) {
    color: var(--colorBrandForegroundLink);
  }

  .notes::-webkit-scrollbar {
    width: 6px;
  }

  .notes::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(248, 250, 252, 0.72);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    padding-top: 0.3rem;
  }

  :global(.primary-action[data-fluent-owner="lib-components-new-update-prompt"]),
  :global(.tonal-action[data-fluent-owner="lib-components-new-update-prompt"]),
  :global(.text-action[data-fluent-owner="lib-components-new-update-prompt"]) {
    display: inline-flex;
    min-height: 2.625rem;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: var(--borderRadiusMedium);
    padding: 0 1.15rem;
    font-family: var(--font-md3-sans);
    font-size: 14px;
    font-weight: 750;
    line-height: 1;
    white-space: nowrap;
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  :global(.primary-action[data-fluent-owner="lib-components-new-update-prompt"]) :global(.cfms-icon),
  :global(.tonal-action[data-fluent-owner="lib-components-new-update-prompt"]) :global(.cfms-icon) {
    flex: 0 0 auto;
  }

  :global(.primary-action[data-fluent-owner="lib-components-new-update-prompt"]) {
    min-width: 10rem;
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
  }

  :global(.tonal-action[data-fluent-owner="lib-components-new-update-prompt"]) {
    min-width: 10.75rem;
    background: color-mix(in srgb, var(--color-md3-primary-container) 74%, transparent);
    color: var(--color-md3-on-primary-container);
  }

  :global(.text-action[data-fluent-owner="lib-components-new-update-prompt"]) {
    min-width: 6.5rem;
    background: transparent;
    color: var(--color-md3-on-surface-variant);
  }

  :global(.primary-action[data-fluent-owner="lib-components-new-update-prompt"]:hover:not(:is(:disabled, [disabled]))),
  :global(.tonal-action[data-fluent-owner="lib-components-new-update-prompt"]:hover:not(:is(:disabled, [disabled]))),
  :global(.text-action[data-fluent-owner="lib-components-new-update-prompt"]:hover:not(:is(:disabled, [disabled]))) {
    transform: translateY(-1px);
  }

  :global(.text-action[data-fluent-owner="lib-components-new-update-prompt"]:hover:not(:is(:disabled, [disabled]))) {
    background: color-mix(in srgb, var(--color-md3-on-surface) 8%, transparent);
    color: var(--color-md3-on-surface);
  }

  :global(.cfms-button[data-fluent-owner="lib-components-new-update-prompt"]:is(:disabled, [disabled])) {
    opacity: 0.55;
  }

  @media (max-width: 640px) {
    .update-prompt {
      padding-block-start: calc(var(--safe-area-top, 0px) + 2rem);
      padding-block-end: calc(var(--safe-area-bottom, 0px) + 2rem);
    }

    .prompt-content {
      gap: 16px;
      transform: none;
    }

    .release-icon {
      width: 4.4rem;
      height: 4.4rem;
    }

    h2 {
      font-size: 28px;
    }

    .actions {
      width: 100%;
      gap: 8px;
    }

    :global(.primary-action[data-fluent-owner="lib-components-new-update-prompt"]),
    :global(.tonal-action[data-fluent-owner="lib-components-new-update-prompt"]),
    :global(.text-action[data-fluent-owner="lib-components-new-update-prompt"]) {
      width: 100%;
    }
  }
</style>
