<script lang="ts">
  // Account badge — displays user avatar, name, and metadata.
  //
  // Used on the More page to show the current user's identity.
  //
  // Reference: AccountBadge in reference/src/include/ui/components/account.py

  import { authStore } from '$lib/stores.svelte';
  import { _ as t } from 'svelte-i18n';
  import Icon from './Icon.svelte';
  import AvatarPreview from './AvatarPreview.svelte';

  let {
    onAvatarClick,
    avatarBusy = false,
  }: {
    onAvatarClick?: () => void;
    avatarBusy?: boolean;
  } = $props();

  const username = $derived(authStore.username ?? $t('common.unknown'));
  const nickname = $derived(authStore.nickname);
  const groups = $derived(authStore.groups);
  const avatarPath = $derived(authStore.avatarPath);
</script>

<div class="flex items-center gap-4">
  <button
    type="button"
    class="relative rounded-full transition-transform hover:scale-[1.03] active:scale-95 focus:outline-none focus:ring-2 focus:ring-md3-primary disabled:cursor-not-allowed disabled:opacity-60"
    title={$t('avatar.change')}
    aria-label={$t('avatar.change')}
    disabled={!authStore.isLoggedIn || avatarBusy || !onAvatarClick}
    onclick={onAvatarClick}
  >
    <AvatarPreview username={username} size={56} avatarPath={avatarPath} />
    <span
      class="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-md3-primary text-md3-on-primary shadow"
      aria-hidden="true"
    >
      <Icon name={avatarBusy ? 'refresh' : 'edit'} size="13px" />
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
