<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
  import SettingsPageHeader from '$lib/shared/ui/SettingsPageHeader.svelte';
  import AuthenticationManagement from '$lib/features/authentication/AuthenticationManagement.svelte';
</script>

<div class="workspace-page settings-page-shell">
  {#if authStore.isLoggedIn}
    <AuthenticationManagement>
      {#snippet header(onRefresh, refreshDisabled)}
        <SettingsPageHeader
          title={$t('authManagement.title')}
          description={$t('authManagement.description')}
          icon="passkey"
          {onRefresh}
          {refreshDisabled}
        />
      {/snippet}
    </AuthenticationManagement>
  {:else}
    <SettingsPageHeader title={$t('authManagement.title')} description={$t('authManagement.description')} icon="passkey" />
    <p>{$t('authManagement.signInRequired')}</p>
  {/if}
</div>
