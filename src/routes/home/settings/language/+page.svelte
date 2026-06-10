<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getLocale } from '$lib/api';
  import { normalizeLocale, setAppLocale, type AppLocale } from '$lib/i18n';
  import Icon from '$lib/components/Icon.svelte';

  const languages: Array<{ value: AppLocale; labelKey: string }> = [
    { value: 'zh_CN', labelKey: 'settings.language.chinese' },
    { value: 'en', labelKey: 'settings.language.english' },
  ];

  let language = $state<AppLocale>('zh_CN');
  let loading = $state(true);
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const selectedLanguageLabel = $derived(
    $t(languages.find((item) => item.value === language)?.labelKey ?? 'settings.language.chinese'),
  );

  $effect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => (status = null), 4000);
    return () => window.clearTimeout(timeout);
  });

  onMount(async () => {
    try {
      language = normalizeLocale(await getLocale());
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
      language = await setAppLocale(language);
      status = $t('settings.language.saved');
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
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('settings.language.title')}
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div>
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.language.display')}
      </h2>
      <p class="text-xs text-md3-on-surface-variant mt-1">
        {$t('settings.language.current', { values: { language: selectedLanguageLabel } })}
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
          {$t(option.labelKey)}
        </label>
      {/each}
    </div>

    <p class="text-xs text-md3-on-surface-variant">
      {$t('settings.language.restart')}
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
      {saving ? $t('common.saving') : $t('settings.language.save')}
    </button>
  </div>
</div>
