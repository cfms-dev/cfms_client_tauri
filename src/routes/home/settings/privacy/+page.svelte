<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import { screenProtectionStore } from '$lib/screen-protection.svelte';
  import { navigateUp } from '$lib/navigation';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';

  let loading = $state(true);
  let saving = $state(false);
  let screenshotProtectionEnabled = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    if (!authStore.isLoggedIn) {
      await goto('/home/settings', { replaceState: true });
      return;
    }

    try {
      if (authStore.username) {
        await screenProtectionStore.init(`${serverStateStore.remoteAddress ?? 'local'}:${authStore.username}`);
      }
      screenshotProtectionEnabled = screenProtectionStore.userEnabled;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function savePrivacyPreference() {
    saving = true;
    error = null;
    try {
      await screenProtectionStore.setUserEnabled(screenshotProtectionEnabled);
      notificationStore.success($t('settings.privacy.saved'));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

{#if authStore.isLoggedIn}
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
        <Icon name="privacyTip" size="28px" />
      </span>
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.privacy.title')}
        </h1>
        <p class="text-xs text-md3-on-surface-variant">
          {$t('settings.privacy.description')}
        </p>
      </div>
    </div>

    <div class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-5 backdrop-blur-sm">
      <section class="space-y-4">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
              {$t('settings.privacy.screenshotProtection')}
            </h2>
            <p class="mt-1 text-xs text-md3-on-surface-variant">
              {$t('settings.privacy.screenshotProtectionHint')}
            </p>
          </div>
          <MdSwitch
            checked={screenshotProtectionEnabled}
            disabled={loading || saving}
            ariaLabel={$t('settings.privacy.screenshotProtection')}
            onChange={(enabled) => {
              screenshotProtectionEnabled = enabled;
            }}
          />
        </div>

        <div
          class="flex items-start gap-3 rounded-lg border border-md3-outline/70
                 bg-md3-surface-container-high/45 px-3 py-3 text-sm text-md3-on-surface"
        >
          <span class="shrink-0 text-md3-primary-emphasis">
            <Icon name="lock" size="20px" />
          </span>
          <p class="min-w-0 text-xs text-md3-on-surface-variant">
            {$t('settings.privacy.forcedHint')}
          </p>
        </div>
      </section>

      <button
        class="mt-5 flex items-center gap-2 rounded-full bg-md3-primary-container px-4 py-2
               text-sm font-medium text-md3-on-primary-container transition-all
               hover:brightness-110 disabled:opacity-50"
        style="font-family: var(--font-md3-sans);"
        onclick={savePrivacyPreference}
        disabled={loading || saving}
      >
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.privacy.save')}
      </button>
    </div>
  </div>
{/if}
