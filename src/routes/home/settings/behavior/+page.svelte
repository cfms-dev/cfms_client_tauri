<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import {
    getRootBackButtonBehavior,
    setRootBackButtonBehavior,
    type RootBackButtonBehavior,
  } from '$lib/api';
  import { navigateUp } from '$lib/navigation';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdRadio from '$lib/components/MdRadio.svelte';

  const behaviorOptions: Array<{ value: RootBackButtonBehavior; labelKey: string; descriptionKey: string }> = [
    {
      value: 'background',
      labelKey: 'settings.behavior.rootBackBackground',
      descriptionKey: 'settings.behavior.rootBackBackgroundHint',
    },
    {
      value: 'exit',
      labelKey: 'settings.behavior.rootBackExit',
      descriptionKey: 'settings.behavior.rootBackExitHint',
    },
  ];

  let behavior = $state<RootBackButtonBehavior>('background');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    try {
      behavior = await getRootBackButtonBehavior();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function saveBehavior() {
    saving = true;
    error = null;
    try {
      await setRootBackButtonBehavior(behavior);
      notificationStore.success($t('settings.behavior.saved'));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function selectBehavior(nextBehavior: RootBackButtonBehavior) {
    if (loading || saving) return;
    behavior = nextBehavior;
  }

  function handleOptionKeydown(event: KeyboardEvent, nextBehavior: RootBackButtonBehavior) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectBehavior(nextBehavior);
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => navigateUp(page.url.pathname)}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="flex items-center gap-3">
    <span class="rounded-2xl bg-md3-primary-container p-3 text-md3-on-primary-container">
      <Icon name="touchApp" size="28px" />
    </span>
    <div class="min-w-0">
      <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.behavior.title')}
      </h1>
      <p class="text-xs text-md3-on-surface-variant">
        {$t('settings.behavior.description')}
      </p>
    </div>
  </div>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-5">
    <section class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.behavior.rootBackTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.behavior.rootBackHint')}
        </p>
      </div>

      <div class="space-y-2" role="radiogroup" aria-label={$t('settings.behavior.rootBackTitle')}>
        {#each behaviorOptions as option}
          <div
            class="flex w-full items-start gap-3 px-3 py-2.5 rounded-lg text-left
                   text-sm text-md3-on-surface border transition-all outline-none
                   hover:bg-md3-primary-container/15 focus-visible:ring-2
                   focus-visible:ring-md3-primary/50
                   {behavior === option.value
                     ? 'border-md3-primary bg-md3-primary-container/15'
                     : 'border-md3-outline/50 bg-md3-surface-container-high/40'}
                   {loading || saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}"
            style="font-family: var(--font-md3-sans);"
            role="radio"
            aria-checked={behavior === option.value}
            tabindex={loading || saving ? -1 : 0}
            onclick={() => selectBehavior(option.value)}
            onkeydown={(event) => handleOptionKeydown(event, option.value)}
          >
            <MdRadio
              checked={behavior === option.value}
              disabled={loading || saving}
              ariaLabel={$t(option.labelKey)}
              class="mt-0.5 shrink-0"
              onSelect={() => selectBehavior(option.value)}
            />
            <span class="min-w-0">
              <span class="block font-medium">{$t(option.labelKey)}</span>
              <span class="block text-xs text-md3-on-surface-variant mt-1">
                {$t(option.descriptionKey)}
              </span>
            </span>
          </div>
        {/each}
      </div>
    </section>

    <button
      class="px-4 py-2 rounded-full font-medium text-sm
             bg-md3-primary-container text-md3-on-primary-container
             hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
      style="font-family: var(--font-md3-sans);"
      onclick={saveBehavior}
      disabled={loading || saving}
    >
      <Icon name="done" size="18px" />
      {saving ? $t('common.saving') : $t('settings.behavior.save')}
    </button>
  </div>
</div>
