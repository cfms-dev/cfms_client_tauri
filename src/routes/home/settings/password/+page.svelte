<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { changePassword, clearAuthSession } from '$lib/api';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ChangePasswordDialog from '$lib/components/ChangePasswordDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  let showDialog = $state(false);

  async function handleChangePassword(oldPassword: string, newPassword: string): Promise<void> {
    const username = authStore.username;
    if (!authStore.isLoggedIn || !username) {
      throw new Error($t('settings.password.signInRequired'));
    }

    await changePassword(username, oldPassword, newPassword);
    showDialog = false;
    await clearAuthSession();
    authStore.clear();
    notificationStore.success($t('more.passwordChanged'));
    await goto('/login', { replaceState: true });
  }
</script>

<div class="workspace-page p-4 sm:p-6 space-y-4 max-w-lg mx-auto">
  <SettingsPageHeader
    title={$t('settings.password.title')}
    description={$t('settings.password.description')}
    icon="password"
  />

  <section
    class="overflow-hidden rounded-xl border border-md3-outline
           bg-md3-surface-container/70 backdrop-blur-sm"
  >
    <div class="flex items-start gap-4 p-5">
      <span
        class="grid h-11 w-11 shrink-0 place-items-center rounded-xl
               bg-md3-primary-container/70 text-md3-on-primary-container"
        aria-hidden="true"
      >
        <Icon name="lockPerson" size="23px" />
      </span>

      <div class="min-w-0 flex-1">
        <h2
          class="text-sm font-semibold text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {$t('settings.password.accountTitle')}
        </h2>
        <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">
          {authStore.isLoggedIn && authStore.username
            ? $t('settings.password.signedInAs', { values: { username: authStore.username } })
            : $t('settings.password.signInRequired')}
        </p>
        <p class="mt-2 text-sm leading-6 text-md3-on-surface-variant">
          {$t('settings.password.accountHint')}
        </p>
      </div>
    </div>

    <div
      class="flex flex-col gap-3 border-t border-md3-outline/50
             bg-md3-surface-container-high/30 px-5 py-4 sm:flex-row sm:items-center"
    >
      <p class="min-w-0 flex-1 text-xs leading-5 text-md3-on-surface-variant">
        {$t('settings.password.sessionHint')}
      </p>
      <button
        type="button"
        class="inline-flex shrink-0 items-center justify-center gap-2 rounded-full
               bg-md3-primary-container px-4 py-2 text-sm font-medium
               text-md3-on-primary-container transition-all hover:brightness-110
               disabled:cursor-not-allowed disabled:opacity-50"
        style="font-family: var(--font-md3-sans);"
        disabled={!authStore.isLoggedIn || !authStore.username}
        onclick={() => (showDialog = true)}
      >
        <Icon name="password" size="18px" />
        {$t('settings.password.action')}
      </button>
    </div>
  </section>
</div>

{#if showDialog && authStore.username}
  <ChangePasswordDialog
    username={authStore.username}
    tip={$t('more.passwordTip')}
    onSubmit={handleChangePassword}
    onCancel={() => (showDialog = false)}
  />
{/if}
