<script lang="ts">
  // Reusable Material Symbol icon wrapper.
  //
  // Uses @iconify/svelte to render icons from the material-symbols set.
  // Icons are referenced by their semantic name defined in $lib/icons.ts.

  import IconComponent from '@iconify/svelte';
  import type { IconName } from '$lib/icons';
  import { ICONS } from '$lib/icons';

  interface Props {
    name: IconName;
    size?: string | number;
    class?: string;
  }

  let { name, size = '24px', class: className = '' }: Props = $props();

  const iconPath = $derived(`material-symbols:${ICONS[name]}`);
</script>

<IconComponent icon={iconPath} width={size} height={size} class={className} />
