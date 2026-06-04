<script lang="ts">
  // Account badge — displays user avatar, name, and metadata.
  //
  // Used on the More page to show the current user's identity.
  //
  // Reference: AccountBadge in reference/src/include/ui/components/account.py

  import { authStore } from '$lib/stores.svelte';
  import Icon from './Icon.svelte';
  import AvatarPreview from './AvatarPreview.svelte';

  const username = $derived(authStore.username ?? 'Unknown');
  const nickname = $derived(authStore.nickname);
  const groups = $derived(authStore.groups);
  const avatarPath = $derived(authStore.avatarPath);
</script>

<div class="flex items-center gap-4">
  <AvatarPreview username={username} size={56} avatarPath={avatarPath} />
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
