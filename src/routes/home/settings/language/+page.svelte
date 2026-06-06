<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getSetting, setSetting } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  type LanguageCode = 'en' | 'zh_CN';

  const languages: Array<{ value: LanguageCode; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh_CN', label: '简体中文' },
  ];

  let language = $state<LanguageCode>('en');
  let loading = $state(true);
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const selectedLanguageLabel = $derived(
    languages.find((item) => item.value === language)?.label ?? 'English',
  );

  $effect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => (status = null), 4000);
    return () => window.clearTimeout(timeout);
  });

  onMount(async () => {
    try {
      const saved = await getSetting('language');
      if (saved === 'en' || saved === 'zh_CN') {
        language = saved;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function saveLanguage() {
    saving = true;
    error = null;
    try {
      await setSetting('language', language);
      status = 'Language setting saved. Language change applies on restart.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/settings')}
  >
    <Icon name="arrowBack" size="18px" />
    Back
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    Language
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div>
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        Display Language
      </h2>
      <p class="text-xs text-md3-on-surface-variant mt-1">
        Current selection: {selectedLanguageLabel}
      </p>
    </div>

    <div class="space-y-2">
      {#each languages as option}
        <label
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg
                 bg-md3-surface-container-high/40 text-sm text-md3-on-surface
                 border border-md3-outline/50"
          style="font-family: var(--font-md3-sans);"
        >
          <input
            class="accent-md3-primary"
            type="radio"
            name="language"
            value={option.value}
            bind:group={language}
            disabled={loading || saving}
          />
          {option.label}
        </label>
      {/each}
    </div>

    <p class="text-xs text-md3-on-surface-variant">
      Language change applies on restart.
    </p>

    {#if status}
      <p class="text-sm text-md3-success flex items-center gap-1.5">
        <Icon name="checkCircle" size="16px" />
        {status}
      </p>
    {/if}
    {#if error}
      <p class="text-sm text-md3-error flex items-center gap-1.5">
        <Icon name="errorFilled" size="16px" />
        {error}
      </p>
    {/if}

    <button
      class="px-4 py-2 rounded-full font-medium text-sm
             bg-md3-primary-container text-md3-on-primary-container
             hover:brightness-110 disabled:opacity-50 transition-all
             flex items-center gap-2"
      style="font-family: var(--font-md3-sans);"
      onclick={saveLanguage}
      disabled={loading || saving}
    >
      <Icon name="done" size="18px" />
      {saving ? 'Saving...' : 'Save Language'}
    </button>
  </div>
</div>
