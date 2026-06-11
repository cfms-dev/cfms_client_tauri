<script lang="ts">
  // Reusable Material Symbol icon wrapper.
  //
  // Renders icons using the Material Symbols Outlined font loaded in app.html.
  // The font uses ligatures: each icon name (underscore_separated) is rendered
  // as its corresponding glyph — no network requests at runtime.
  //
  // Icons are referenced by their semantic name defined in $lib/icons.ts.

  import type { IconName } from "$lib/icons";
  import { ICONS } from "$lib/icons";

  interface Props {
    name: IconName;
    size?: string | number;
    class?: string;
  }

  let { name, size = "24px", class: className = "" }: Props = $props();

  /** Convert "24px" or 24 → "24px"; leave custom units (em, rem) as-is. */
  const iconSize = $derived.by(() => {
    if (typeof size === "number") {
      return `${size}px`;
    }

    if (/^\d+(\.\d+)?(px|em|rem|%)$/.test(size)) {
      return size;
    }

    return "24px";
  });

  /**
   * The Material Symbols font ligature name.
   * Google's font uses underscores, which matches our ICONS values directly.
   */
  const ligature = $derived(ICONS[name]);
</script>

<span
  class="material-symbols-outlined select-none inline-flex items-center justify-center leading-none {className}"
  style="font-size: {iconSize}; width: {iconSize}; height: {iconSize}; font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;"
  aria-hidden="true"
  data-icon={name}
>
  {ligature}
</span>
