<script lang="ts">
  // Avatar preview — reactive to username input.
  //
  // Shows a circular avatar: cached image when `avatarPath` is provided,
  // otherwise falls back to a deterministic initial-letter circle.
  // Updates as the username field changes.
  //
  // Reference: AvatarPreviewContainer in reference/src/include/ui/controls/views/login.py

  import { convertFileSrc } from "$lib/shared/platform/native-core";
  import { _ as t } from 'svelte-i18n';

  interface Props {
    username: string;
    size?: number;
    /** Optional path to a cached avatar image file on disk. */
    avatarPath?: string | null;
  }

  let { username, size = 60, avatarPath = null }: Props = $props();
  let loaded = $state(false);
  let failed = $state(false);
  $effect(() => {
    username;
    avatarPath;
    loaded = false;
    failed = false;
  });

  const initial = $derived(username.trim().charAt(0).toUpperCase() || '?');
  const hue = $derived.by(() => {
    // Deterministic color based on username
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  });

  /** Convert a local file path to a Tauri asset:// URL. */
  const avatarSrc = $derived(
    avatarPath ? convertFileSrc(avatarPath) : null,
  );
</script>

<div
  class="relative rounded-full flex items-center justify-center
         text-white font-bold select-none shrink-0 overflow-hidden"
  style="width: {size}px; height: {size}px;
         background: {loaded ? 'transparent' : `hsl(${hue}, 55%, 45%)`};
         font-size: {Math.round(size * 0.4)}px;
         font-family: var(--font-md3-sans);"
  aria-label={$t('common.avatarFor', { values: { username: username || $t('common.unknownUser') } })}
>
  {#if !loaded}<span aria-hidden="true">{initial}</span>{/if}
  {#key `${username}:${avatarSrc}`}
  {#if avatarSrc && !failed}
    <img
      src={avatarSrc}
      alt={$t('common.avatarFor', { values: { username } })}
      class="absolute inset-0 w-full h-full object-cover"
      style:opacity={loaded ? 1 : 0}
      onload={() => (loaded = true)}
      onerror={() => { failed = true; loaded = false; }}
    />
  {/if}
  {/key}
</div>
