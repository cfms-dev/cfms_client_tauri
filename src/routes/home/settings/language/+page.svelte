<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getLocale } from '$lib/api';
  import { normalizeLocale, setAppLocale, type AppLocale } from '$lib/i18n';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import TopAppBar from '$lib/components/TopAppBar.svelte';

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

<TopAppBar title={$t('settings.language.title')} backLabel={$t('common.back')} onBack={() => goto('/home/settings')} maxWidth="max-w-lg">
  {#snippet actions()}
    <IconButton icon="done" label={$t('settings.language.save')} onclick={saveLanguage} disabled={loading || saving} />
  {/snippet}
</TopAppBar>

<div class="p-6 space-y-4 max-w-lg mx-auto">

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
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-left
                 bg-md3-surface-container-high/40 text-sm text-md3-on-surface
                 border border-md3-outline/50 transition-colors hover:bg-md3-primary-container/15 disabled:cursor-not-allowed disabled:opacity-60"
          style="font-family: var(--font-md3-sans);"
          disabled={loading || saving}
          onclick={() => (language = option.value)}
        >
          <span
            class="{language === option.value ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
            aria-hidden="true"
          >
            <Icon name={language === option.value ? 'radioChecked' : 'radioUnchecked'} size="22px" />
          </span>
          {$t(option.labelKey)}
        </button>
      {/each}
    </div>

    <p class="text-xs text-md3-on-surface-variant">
      {$t('settings.language.restart')}
    </p>

  </div>
</div>
