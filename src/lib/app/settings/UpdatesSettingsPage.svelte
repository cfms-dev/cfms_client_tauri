<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { getSetting, setSetting } from '$lib/api';
  import { appUpdateState } from '$lib/features/updates/app-update-state.svelte.ts';
  import type { UpdateChannel } from '$lib/api/updates';
  import {
    ACTIVE_UPDATE_CHECK_PAUSE,
    createUpdateCheckPause,
    type UpdateCheckPausePreset,
  } from '$lib/features/updates/update-check-pause';
  import { createAutoSave } from '$lib/features/settings/settings-autosave.svelte.ts';
  import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import Icon from '$lib/shared/ui/Icon.svelte';
  import SettingsPageHeader from '$lib/shared/ui/SettingsPageHeader.svelte';
  import { focusRovingItem } from '$lib/shared/ui/keyboard';

  const channels: UpdateChannel[] = ['stable', 'beta', 'alpha'];

  let channel = $state<UpdateChannel>('stable');
  let loading = $state(true);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      channel = appUpdateState.channel;
      error = message;
    },
  });

  const channelDescription = $derived($t(`settings.updates.${channel}Description`));
  const pause = $derived(appUpdateState.automaticCheckPause);
  const automaticChecksPaused = $derived(appUpdateState.isAutomaticCheckPaused);
  const automaticCheckStatus = $derived.by(() => {
    if (pause.mode === 'indefinite') return $t('settings.updates.pausedIndefinitely');
    if (pause.mode === 'until') {
      return $t('settings.updates.pausedUntil', {
        values: { date: formatPauseDate(pause.until) },
      });
    }
    return $t('settings.updates.automaticChecksActive');
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    try {
      const [saved] = await Promise.all([
        getSetting('update_channel'),
        appUpdateState.ensureAutomaticCheckPause(),
      ]);
      if (saved === 'stable' || saved === 'beta' || saved === 'alpha') {
        channel = saved;
        if (appUpdateState.channel !== saved) appUpdateState.setChannel(saved);
      } else {
        channel = appUpdateState.channel;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function applyChannel(nextChannel: UpdateChannel) {
    if (loading || autoSave.saving || nextChannel === channel) return;
    channel = nextChannel;
    error = null;
    void autoSave.run(async () => {
      await setSetting('update_channel', nextChannel);
      appUpdateState.setChannel(nextChannel);
    });
  }

  async function choosePauseDuration() {
    if (loading || autoSave.saving) return;

    const result = await dialogStore.choose<UpdateCheckPausePreset>({
      title: $t('settings.updates.pauseDialogTitle'),
      message: $t('settings.updates.pauseDialogMessage'),
      choices: [
        {
          value: 'day',
          label: $t('settings.updates.pauseOneDay'),
          description: $t('settings.updates.pauseOneDayHint'),
          icon: 'calendarToday',
        },
        {
          value: 'week',
          label: $t('settings.updates.pauseSevenDays'),
          description: $t('settings.updates.pauseSevenDaysHint'),
          icon: 'calendarToday',
        },
        {
          value: 'month',
          label: $t('settings.updates.pauseThirtyDays'),
          description: $t('settings.updates.pauseThirtyDaysHint'),
          icon: 'schedule',
        },
        {
          value: 'indefinite',
          label: $t('settings.updates.pauseIndefinitely'),
          description: $t('settings.updates.pauseIndefinitelyHint'),
          icon: 'pauseCircle',
        },
      ],
      cancelLabel: $t('common.cancel'),
    });
    if (!result) return;

    if (result.value === 'indefinite') {
      const confirmed = await dialogStore.confirm({
        title: $t('settings.updates.permanentPauseTitle'),
        message: $t('settings.updates.permanentPauseMessage'),
        confirmLabel: $t('settings.updates.pauseIndefinitely'),
        cancelLabel: $t('common.cancel'),
      });
      if (!confirmed) return;
    }

    const nextPause = createUpdateCheckPause(result.value);
    void autoSave.run(() => appUpdateState.setAutomaticCheckPause(nextPause));
  }

  function resumeAutomaticChecks() {
    if (loading || autoSave.saving) return;
    void autoSave.run(() => appUpdateState.resumeAutomaticChecks());
  }

  function resetSettings() {
    if (loading || autoSave.saving) return;
    void autoSave.run(async () => {
      if (channel !== 'stable') {
        await setSetting('update_channel', 'stable');
        channel = 'stable';
        appUpdateState.setChannel('stable');
      }
      if (appUpdateState.isAutomaticCheckPaused) {
        await appUpdateState.resumeAutomaticChecks();
      } else {
        await appUpdateState.setAutomaticCheckPause(ACTIVE_UPDATE_CHECK_PAUSE);
      }
    });
  }

  function handleChannelKeydown(event: KeyboardEvent) {
    const next = focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-radio-item]',
      orientation: 'both',
    });
    next?.click();
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
</script>

<div class="workspace-page settings-page-shell update-settings-page">
  <SettingsPageHeader
    title={$t('settings.updates.title')}
    description={$t('settings.updates.description')}
    icon="browserUpdated"
    resetDisabled={loading || autoSave.saving}
    onReset={resetSettings}
  />

  <div class="settings-section-list">
    <section class="update-section settings-section" aria-labelledby="automatic-checks-heading">
      <div class="settings-section-heading">
        <h2 id="automatic-checks-heading">{$t('settings.updates.automaticChecks')}</h2>
        <p>{$t('settings.updates.automaticChecksHint')}</p>
      </div>

      <div
        class="automatic-check-status"
        class:automatic-check-status--paused={automaticChecksPaused}
        aria-live="polite"
        aria-busy={loading || autoSave.saving}
      >
        <span class="status-icon" aria-hidden="true">
          <Icon name={automaticChecksPaused ? 'pauseCircle' : 'update'} size="22px" />
        </span>
        <span class="status-copy">
          <strong>{automaticCheckStatus}</strong>
          <span>
            {$t(automaticChecksPaused
              ? 'settings.updates.pausedHint'
              : 'settings.updates.automaticChecksActiveHint')}
          </span>
        </span>
      </div>

      <div class="section-actions">
        {#if automaticChecksPaused}
          <FluentButton data-fluent-owner="routes-home-settings-updates-page"
            type="button"
            onclick={resumeAutomaticChecks}
            disabled={loading || autoSave.saving}
            appearance="subtle"
            class="primary-action"
          >
            <Icon name="resume" size="18px" />
            {$t('settings.updates.resumeAutomaticChecks')}
          </FluentButton>
          <FluentButton data-fluent-owner="routes-home-settings-updates-page"
            type="button"
            onclick={choosePauseDuration}
            disabled={loading || autoSave.saving}
            appearance="subtle"
            class="text-action"
          >
            <Icon name="schedule" size="18px" />
            {$t('settings.updates.changePauseDuration')}
          </FluentButton>
        {:else}
          <FluentButton data-fluent-owner="routes-home-settings-updates-page"
            type="button"
            onclick={choosePauseDuration}
            disabled={loading || autoSave.saving}
            appearance="subtle"
            class="tonal-action"
          >
            <Icon name="pause" size="18px" />
            {$t('settings.updates.pauseAutomaticChecks')}
          </FluentButton>
        {/if}
      </div>
    </section>

    <section class="update-section settings-section" aria-labelledby="update-channel-heading">
      <div class="settings-section-heading">
        <h2 id="update-channel-heading">{$t('settings.updates.updateChannel')}</h2>
        <p>{channelDescription}</p>
      </div>

      <div
        class="channel-list"
        role="radiogroup"
        tabindex="-1"
        aria-label={$t('settings.updates.updateChannel')}
        onkeydown={handleChannelKeydown}
      >
        {#each channels as item}
          <button data-fluent-owner="routes-home-settings-updates-page"
            data-radio-item
            type="button"
            class="channel-row"
            class:active={channel === item}
            role="radio"
            aria-checked={channel === item}
            tabindex={channel === item ? 0 : -1}
            disabled={loading || autoSave.saving}
            onclick={() => applyChannel(item)}
          >
            <span class="channel-icon" aria-hidden="true">
              <Icon name={channel === item ? 'radioChecked' : 'radioUnchecked'} filled={channel === item} size="20px" />
            </span>
            <span class="channel-copy">
              <span class="channel-name">{$t(`settings.updates.${item}`)}</span>
              <span class="channel-description">{$t(`settings.updates.${item}Description`)}</span>
            </span>
          </button>
        {/each}
      </div>

      <div class="section-actions">
        <FluentButton data-fluent-owner="routes-home-settings-updates-page"
          type="button"
          appearance="outline"
          onclick={() => goto('/home/about')}
        >
          <Icon name="update" size="18px" />
          {$t('settings.updates.checkInAbout')}
        </FluentButton>
      </div>
    </section>
  </div>

  <div class="update-notes">
    <p class="related-settings">
      {$t('settings.updates.githubApiHint')}
      <a href="/home/settings/github-api">{$t('settings.updates.githubApiLink')}</a>
    </p>
    <p class="update-footnote">
      <Icon name="verified" size="17px" />
      {$t('settings.updates.signedUpdateHint')}
    </p>
  </div>
</div>

<style>
  .update-settings-page {
    gap: 16px;
  }

  .update-section {
    display: grid;
    gap: 16px;
  }

  .automatic-check-status {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 3rem;
  }

  .status-icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    color: var(--color-md3-success);
  }

  .automatic-check-status--paused .status-icon {
    color: var(--color-md3-warning);
  }

  .status-copy {
    display: grid;
    min-width: 0;
    gap: 4px;
  }

  .status-copy strong {
    color: var(--color-md3-on-surface);
    font: 600 14px/20px var(--font-md3-sans);
  }

  .status-copy span {
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    line-height: 1.5;
  }

  .channel-list {
    display: grid;
  }

  .channel-row {
    display: flex;
    align-items: center;
    gap: 12px;
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

  .channel-row:hover:not(:is(:disabled, [disabled])) {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 7%, transparent);
  }

  .channel-icon {
    flex: none;
    color: var(--color-md3-primary-emphasis);
  }

  .channel-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .channel-name {
    color: var(--color-md3-on-surface);
    font: 700 14px/20px var(--font-md3-sans);
  }

  .channel-description {
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    line-height: 1.45;
  }

  .section-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  :global(.primary-action[data-fluent-owner="routes-home-settings-updates-page"]),
  :global(.tonal-action[data-fluent-owner="routes-home-settings-updates-page"]),
  :global(.text-action[data-fluent-owner="routes-home-settings-updates-page"]) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 2.35rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0 0.85rem;
    font-family: var(--font-md3-sans);
    font-size: 12px;
    font-weight: 700;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-standard);
  }

  :global(.primary-action[data-fluent-owner="routes-home-settings-updates-page"]) {
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  :global(.tonal-action[data-fluent-owner="routes-home-settings-updates-page"]) {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  :global(.text-action[data-fluent-owner="routes-home-settings-updates-page"]) {
    color: var(--color-md3-primary-emphasis);
    background: transparent;
  }

  :global(.primary-action[data-fluent-owner="routes-home-settings-updates-page"]:hover:not(:is(:disabled, [disabled]))),
  :global(.tonal-action[data-fluent-owner="routes-home-settings-updates-page"]:hover:not(:is(:disabled, [disabled]))) {
    filter: none;
    transform: translateY(-1px);
  }

  :global(.text-action[data-fluent-owner="routes-home-settings-updates-page"]:hover:not(:is(:disabled, [disabled]))) {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 10%, transparent);
  }

  :global(:is(button[data-fluent-owner="routes-home-settings-updates-page"], .cfms-button[data-fluent-owner="routes-home-settings-updates-page"]):is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .update-notes {
    display: grid;
    gap: 8px;
    padding-top: 0.2rem;
  }

  .related-settings,
  .update-footnote {
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    line-height: 1.45;
  }

  .related-settings {
    padding-inline: 0.15rem;
  }

  .related-settings a {
    color: var(--color-md3-primary-emphasis);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  .related-settings a:hover {
    color: var(--colorBrandForegroundLinkHover);
  }

  .update-footnote {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0.2rem 0.15rem;
  }

  .update-footnote :global(.cfms-icon) {
    flex: none;
    color: var(--color-md3-success);
  }

  @media (max-width: 640px) {
    .section-actions > :global(:is(:is(button[data-fluent-owner="routes-home-settings-updates-page"], .cfms-button[data-fluent-owner="routes-home-settings-updates-page"]), a)) {
      min-height: 2.75rem;
    }
  }

  @media (max-width: 420px) {
    .section-actions > :global(:is(:is(button[data-fluent-owner="routes-home-settings-updates-page"], .cfms-button[data-fluent-owner="routes-home-settings-updates-page"]), a)) {
      width: 100%;
    }
  }
</style>
