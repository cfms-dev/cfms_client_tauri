<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type {
    AppearancePreference,
    ColorSchemePreference,
    ReduceMotionPreference,
  } from '$lib/api';
  import { DEFAULT_APPEARANCE } from '$lib/appearance';
  import { appearanceStore } from '$lib/appearance.svelte';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';
  import { focusRovingItem } from '$lib/keyboard';
  import type { IconName } from '$lib/icons';

  interface PreferenceOption<T> {
    value: T;
    labelKey: string;
    descriptionKey: string;
    icon: IconName;
  }

  const colorSchemeOptions: Array<PreferenceOption<ColorSchemePreference>> = [
    {
      value: 'light',
      labelKey: 'settings.appearance.light',
      descriptionKey: 'settings.appearance.lightHint',
      icon: 'lightMode',
    },
    {
      value: 'dark',
      labelKey: 'settings.appearance.dark',
      descriptionKey: 'settings.appearance.darkHint',
      icon: 'darkMode',
    },
    {
      value: 'system',
      labelKey: 'settings.appearance.system',
      descriptionKey: 'settings.appearance.systemHint',
      icon: 'systemTheme',
    },
  ];

  const reduceMotionOptions: Array<PreferenceOption<ReduceMotionPreference>> = [
    {
      value: 'always',
      labelKey: 'settings.appearance.reduceMotionAlways',
      descriptionKey: 'settings.appearance.reduceMotionAlwaysHint',
      icon: 'motionOff',
    },
    {
      value: 'never',
      labelKey: 'settings.appearance.reduceMotionNever',
      descriptionKey: 'settings.appearance.reduceMotionNeverHint',
      icon: 'motion',
    },
    {
      value: 'system',
      labelKey: 'settings.appearance.reduceMotionSystem',
      descriptionKey: 'settings.appearance.reduceMotionSystemHint',
      icon: 'systemTheme',
    },
  ];

  let colorScheme = $state<ColorSchemePreference>('system');
  let reduceMotion = $state<ReduceMotionPreference>('system');
  let loading = $state(true);
  let error = $state<string | null>(null);
  const scopeKey = $derived(
    authStore.isLoggedIn && authStore.username
      ? `user:${serverStateStore.remoteAddress ?? 'local'}:${authStore.username}`
      : 'global',
  );
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
      void appearanceStore.load(scopeKey, true).then(syncFromStore).catch((err) => {
        error = err instanceof Error ? err.message : String(err);
      });
    },
    onSuccess: () => notificationStore.success($t('settings.appearance.saved')),
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  $effect(() => {
    appearanceStore.preference;
    if (!loading) syncFromStore();
  });

  onMount(async () => {
    try {
      await appearanceStore.load(scopeKey);
      syncFromStore();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function syncFromStore() {
    colorScheme = appearanceStore.preference.color_scheme;
    reduceMotion = appearanceStore.preference.reduce_motion;
  }

  function updateAppearance(next: AppearancePreference) {
    if (loading) return;
    colorScheme = next.color_scheme;
    reduceMotion = next.reduce_motion;
    appearanceStore.apply(next);
    void autoSave.run(() => appearanceStore.save(next));
  }

  function selectColorScheme(next: ColorSchemePreference) {
    if (next === colorScheme) return;
    updateAppearance({ color_scheme: next, reduce_motion: reduceMotion });
  }

  function selectReduceMotion(next: ReduceMotionPreference) {
    if (next === reduceMotion) return;
    updateAppearance({ color_scheme: colorScheme, reduce_motion: next });
  }

  function resetAppearance() {
    updateAppearance({ ...DEFAULT_APPEARANCE });
  }

  function handlePreferenceKeydown(event: KeyboardEvent) {
    const next = focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-radio-item]',
      orientation: 'both',
    });
    next?.click();
  }
</script>

<div class="appearance-page mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
  <SettingsPageHeader
    title={$t('settings.appearance.title')}
    description={$t('settings.appearance.description')}
    icon="appearance"
    resetDisabled={loading || autoSave.saving}
    onReset={resetAppearance}
  />

  <p class="scope-note">
    <Icon name={authStore.isLoggedIn ? 'accountCircle' : 'settings'} size="18px" />
    {$t(authStore.isLoggedIn
      ? 'settings.appearance.userScope'
      : 'settings.appearance.globalScope')}
  </p>

  <section class="appearance-section">
    <div>
      <h2>{$t('settings.appearance.colorScheme')}</h2>
      <p>{$t('settings.appearance.colorSchemeHint')}</p>
    </div>

    <div
      class="preference-grid"
      role="radiogroup"
      tabindex="-1"
      aria-label={$t('settings.appearance.colorScheme')}
      onkeydown={handlePreferenceKeydown}
    >
      {#each colorSchemeOptions as option}
        <button
          data-radio-item
          type="button"
          role="radio"
          aria-checked={colorScheme === option.value}
          tabindex={colorScheme === option.value ? 0 : -1}
          class:preference-card--selected={colorScheme === option.value}
          class="preference-card scheme-card"
          disabled={loading}
          onclick={() => selectColorScheme(option.value)}
        >
          <span class="scheme-preview scheme-preview--{option.value}" aria-hidden="true">
            {#if option.value === 'system'}
              <span class="system-preview__orb system-preview__orb--light"></span>
              <span class="system-preview__orb system-preview__orb--dark"></span>
              {#each ['light', 'dark'] as scheme}
                <span class="system-preview__window system-preview__window--{scheme}">
                  <span class="system-preview__titlebar">
                    <span></span><span></span><span></span>
                  </span>
                  <span class="system-preview__content">
                    <span class="system-preview__rail"></span>
                    <span class="system-preview__lines"><span></span><span></span></span>
                  </span>
                </span>
              {/each}
            {:else}
              <span class="scheme-preview__bar"></span>
              <span class="scheme-preview__body">
                <span></span><span></span><span></span>
              </span>
            {/if}
          </span>
          <span class="preference-card__copy">
            <span class="preference-card__title">
              <Icon name={option.icon} size="20px" />
              {$t(option.labelKey)}
            </span>
            <span class="preference-card__hint">{$t(option.descriptionKey)}</span>
          </span>
          <Icon
            name={colorScheme === option.value ? 'radioChecked' : 'radioUnchecked'}
            size="21px"
          />
        </button>
      {/each}
    </div>
  </section>

  <section class="appearance-section">
    <div>
      <h2>{$t('settings.appearance.reduceMotion')}</h2>
      <p>{$t('settings.appearance.reduceMotionHint')}</p>
    </div>

    <div
      class="preference-grid"
      role="radiogroup"
      tabindex="-1"
      aria-label={$t('settings.appearance.reduceMotion')}
      onkeydown={handlePreferenceKeydown}
    >
      {#each reduceMotionOptions as option}
        <button
          data-radio-item
          type="button"
          role="radio"
          aria-checked={reduceMotion === option.value}
          tabindex={reduceMotion === option.value ? 0 : -1}
          class:preference-card--selected={reduceMotion === option.value}
          class="preference-card motion-card"
          disabled={loading}
          onclick={() => selectReduceMotion(option.value)}
        >
          <span class="preference-card__copy">
            <span class="preference-card__title">
              <Icon name={option.icon} size="20px" />
              {$t(option.labelKey)}
            </span>
            <span class="preference-card__hint">{$t(option.descriptionKey)}</span>
          </span>
          <Icon
            name={reduceMotion === option.value ? 'radioChecked' : 'radioUnchecked'}
            size="21px"
          />
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .scope-note {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.7rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 0.75rem);
    padding: 0.7rem 0.85rem;
    color: var(--color-md3-on-surface-variant);
    background: color-mix(in srgb, var(--color-md3-primary-container) 30%, transparent);
    font-size: 0.78rem;
  }

  .appearance-section {
    display: grid;
    gap: 1rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-large, 0.75rem);
    padding: 1.15rem;
    background: color-mix(in srgb, var(--color-md3-surface-container) 82%, transparent);
    backdrop-filter: blur(16px);
  }

  h2 { margin: 0; color: var(--color-md3-on-surface); font: 650 0.9rem/1.35 var(--font-md3-sans); }
  p { margin: 0.3rem 0 0; color: var(--color-md3-on-surface-variant); font-size: 0.76rem; line-height: 1.55; }
  .preference-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.7rem; }

  .preference-card {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.7rem;
    align-items: start;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 0.65rem);
    padding: 0.65rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-high);
    text-align: left;
    transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
  }
  .preference-card:hover:not(:disabled) { background: var(--color-md3-surface-container-highest); transform: translateY(-1px); }
  .preference-card--selected { border-color: var(--color-md3-primary); color: var(--color-md3-primary-emphasis); background: var(--color-md3-primary-container); }
  .preference-card:disabled { opacity: 0.6; }
  .scheme-preview { grid-column: 1 / -1; display: block; overflow: hidden; aspect-ratio: 16 / 8; border: 1px solid rgb(128 128 128 / 0.28); border-radius: 0.42rem; background: #f3f3f3; box-shadow: 0 5px 16px rgb(0 0 0 / 0.12); }
  .scheme-preview__bar { display: block; height: 24%; background: #fafafa; }
  .scheme-preview__body { display: grid; height: 76%; grid-template-columns: 28% 1fr; gap: 8%; padding: 8%; background: #f3f3f3; }
  .scheme-preview__body span { border-radius: 999px; background: #d7d7d7; }
  .scheme-preview__body span:first-child { grid-row: 1 / 3; border-radius: 3px; background: #e5e5e5; }
  .scheme-preview--dark { background: #17191d; }
  .scheme-preview--dark .scheme-preview__bar { background: #20232a; }
  .scheme-preview--dark .scheme-preview__body { background: #0f1115; }
  .scheme-preview--dark .scheme-preview__body span { background: #343840; }
  .scheme-preview--dark .scheme-preview__body span:first-child { background: #20232a; }
  .scheme-preview--system {
    position: relative;
    isolation: isolate;
    border-color: rgb(82 94 108 / 0.68);
    background:
      radial-gradient(circle at 14% 12%, rgb(255 255 255 / 0.9), transparent 32%),
      radial-gradient(circle at 86% 88%, rgb(52 64 80 / 0.9), transparent 36%),
      linear-gradient(
        135deg,
        #e8edf2 0 38%,
        #d9e0e7 43%,
        #aab4bf 48%,
        #65717e 53%,
        #323c48 58%,
        #1a2028 66% 100%
      );
    box-shadow: 0 5px 16px rgb(0 0 0 / 0.18), inset 0 0 0 1px rgb(0 0 0 / 0.14);
  }
  .system-preview__orb {
    position: absolute;
    z-index: -1;
    border-radius: 999px;
    filter: blur(0.5px);
  }
  .system-preview__orb--light {
    width: 38%;
    aspect-ratio: 1;
    left: -10%;
    top: -32%;
    background: rgb(255 255 255 / 0.72);
  }
  .system-preview__orb--dark {
    width: 34%;
    aspect-ratio: 1;
    right: -7%;
    bottom: -35%;
    border: 1px solid rgb(121 195 255 / 0.16);
    background: rgb(38 48 62 / 0.72);
  }
  .system-preview__window {
    position: absolute;
    display: grid;
    grid-template-rows: 23% 1fr;
    width: 56%;
    height: 67%;
    overflow: hidden;
    border-radius: 0.32rem;
    transition: transform 180ms cubic-bezier(0.2, 0, 0, 1), box-shadow 180ms ease;
  }
  .system-preview__window--light {
    left: 7%;
    top: 12%;
    z-index: 1;
    border: 1px solid rgb(25 34 44 / 0.15);
    color: #adb4bd;
    background: #f8fafc;
    box-shadow: 0 7px 16px rgb(25 34 44 / 0.2);
    transform: rotate(-2deg);
  }
  .system-preview__window--dark {
    right: 7%;
    bottom: 11%;
    z-index: 2;
    border: 1px solid rgb(255 255 255 / 0.13);
    color: #586373;
    background: #171c23;
    box-shadow: 0 8px 18px rgb(0 0 0 / 0.38);
    transform: rotate(2deg);
  }
  .scheme-card:hover:not(:disabled) .system-preview__window--light { transform: translate(-2px, -1px) rotate(-2.5deg); }
  .scheme-card:hover:not(:disabled) .system-preview__window--dark { transform: translate(2px, 1px) rotate(2.5deg); }
  .system-preview__titlebar {
    display: flex;
    align-items: center;
    gap: 3px;
    padding-inline: 8%;
    background: color-mix(in srgb, currentColor 15%, transparent);
  }
  .system-preview__titlebar > span {
    width: 3px;
    aspect-ratio: 1;
    border-radius: 999px;
    background: currentColor;
  }
  .system-preview__content {
    display: grid;
    grid-template-columns: 28% 1fr;
    gap: 9%;
    padding: 9%;
  }
  .system-preview__rail { border-radius: 2px; background: color-mix(in srgb, currentColor 24%, transparent); }
  .system-preview__lines { display: grid; align-content: center; gap: 18%; }
  .system-preview__lines > span { height: 4px; border-radius: 999px; background: currentColor; }
  .system-preview__lines > span:last-child { width: 72%; }
  .preference-card__copy { min-width: 0; }
  .preference-card__title { display: flex; align-items: center; gap: 0.35rem; color: var(--color-md3-on-surface); font: 650 0.8rem/1.3 var(--font-md3-sans); }
  .preference-card__hint { display: block; margin-top: 0.25rem; color: var(--color-md3-on-surface-variant); font-size: 0.68rem; line-height: 1.45; }

  @media (max-width: 620px) {
    .preference-grid { grid-template-columns: 1fr; }
    .scheme-card { grid-template-columns: 96px minmax(0, 1fr) auto; align-items: center; }
    .scheme-preview { grid-column: auto; }
  }
</style>
