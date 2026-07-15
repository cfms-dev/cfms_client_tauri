<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { screenProtectionStore } from '$lib/screen-protection.svelte';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  let loading = $state(true);
  let screenshotProtectionEnabled = $state(true);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
  });

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

  function applyScreenshotProtection(enabled: boolean) {
    screenshotProtectionEnabled = enabled;
    error = null;
    void autoSave.run(async () => {
      await screenProtectionStore.setUserEnabled(enabled);
    });
  }

  function resetPrivacyPreference() {
    applyScreenshotProtection(true);
  }
</script>

{#if authStore.isLoggedIn}
  <div class="p-6 space-y-4 max-w-lg mx-auto">
    <SettingsPageHeader
      title={$t('settings.privacy.title')}
      description={$t('settings.privacy.description')}
      icon="privacy"
      resetDisabled={loading}
      onReset={resetPrivacyPreference}
    />

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
            disabled={loading}
            ariaLabel={$t('settings.privacy.screenshotProtection')}
            onChange={applyScreenshotProtection}
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
    </div>
  </div>
{/if}
