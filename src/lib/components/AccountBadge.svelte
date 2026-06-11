<script lang="ts">
  // Account badge — displays user avatar, name, and metadata.
  //
  // Used on the More page to show the current user's identity.
  //
  // Reference: AccountBadge in reference/src/include/ui/components/account.py

  import {
    authStore,
    notificationStore,
  } from '$lib/stores.svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    downloadAvatar,
    getUserAvatar,
    setUserAvatar,
    type ServerDocumentEntry,
  } from '$lib/api';
  import Icon from './Icon.svelte';
  import AvatarPreview from './AvatarPreview.svelte';
  import ServerDocumentPicker from './ServerDocumentPicker.svelte';
  import { isImageDocumentName } from '$lib/image-documents';

  const username = $derived(authStore.username ?? $t('common.unknown'));
  const nickname = $derived(authStore.nickname);
  const groups = $derived(authStore.groups);
  const avatarPath = $derived(authStore.avatarPath);

  let pickerOpen = $state(false);
  let savingAvatar = $state(false);

  async function handleSelectAvatar(document: ServerDocumentEntry) {
    if (!authStore.username || savingAvatar) return;
    savingAvatar = true;

    try {
      const success = await setUserAvatar(authStore.username, document.id);
      if (!success) throw new Error($t('avatar.setFailed'));

      const taskData = await getUserAvatar(authStore.username);
      if (taskData) {
        const path = await downloadAvatar(taskData, authStore.username, true);
        if (path) authStore.avatarPath = path;
      }

      notificationStore.success($t('avatar.updated'));
      pickerOpen = false;
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
    } finally {
      savingAvatar = false;
    }
  }
</script>

<div class="flex items-center gap-4">
  <button
    type="button"
    class="relative rounded-full transition-transform hover:scale-[1.03] active:scale-95 focus:outline-none focus:ring-2 focus:ring-md3-primary disabled:cursor-not-allowed disabled:opacity-60"
    title={$t('avatar.change')}
    aria-label={$t('avatar.change')}
    disabled={!authStore.isLoggedIn || savingAvatar}
    onclick={() => (pickerOpen = true)}
  >
    <AvatarPreview username={username} size={56} avatarPath={avatarPath} />
    <span
      class="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-md3-primary text-md3-on-primary shadow"
      aria-hidden="true"
    >
      <Icon name={savingAvatar ? 'refresh' : 'edit'} size="13px" />
    </span>
  </button>
  <div class="min-w-0">
    <p
      class="text-base font-semibold text-md3-on-surface truncate"
      style="font-family: var(--font-md3-sans);"
    >
      {nickname ?? username}
    </p>
    {#if nickname && nickname !== username}
      <p class="text-xs text-md3-on-surface-variant truncate">
        @{username}
      </p>
    {/if}
    {#if groups.length > 0}
      <p class="text-xs text-md3-on-surface-variant mt-0.5 flex items-center gap-1">
        <Icon name="groups" size="14px" />
        {groups.join(', ')}
      </p>
    {/if}
  </div>
</div>

{#if pickerOpen}
  <ServerDocumentPicker
    title={$t('avatar.selectTitle')}
    documentFilter={(document) => isImageDocumentName(document.title)}
    onSelect={handleSelectAvatar}
    onCancel={() => {
      if (!savingAvatar) pickerOpen = false;
    }}
  />
{/if}
