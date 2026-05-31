<script lang="ts">
  // Avatar preview — reactive to username input.
  //
  // Shows a circular avatar with the user's first letter as fallback.
  // Updates as the username field changes.

  interface Props {
    username: string;
    size?: number;
  }

  let { username, size = 60 }: Props = $props();

  const initial = $derived(username.trim().charAt(0).toUpperCase() || '?');
  const hue = $derived(() => {
    // Deterministic color based on username
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  });
</script>

<div
  class="rounded-full flex items-center justify-center
         text-white font-bold select-none shrink-0"
  style="width: {size}px; height: {size}px;
         background: hsl({hue()}, 55%, 45%);
         font-size: {Math.round(size * 0.4)}px;
         font-family: var(--font-md3-sans);"
  aria-label="Avatar for {username || 'unknown user'}"
>
  {initial()}
</div>
