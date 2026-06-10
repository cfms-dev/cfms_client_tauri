<script lang="ts">
  // Full-width lockdown warning banner — shown at the top of every page
  // when the server has activated lockdown mode.
  //
  // MD3 styling: error container with on-error-container text.

  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';
  import { flyScale } from '$lib/motion/transitions';

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();
</script>

{#if active}
  <div
    class="bg-md3-error-container text-md3-on-error-container
           px-4 py-2.5 text-center text-sm font-medium
           border-b border-md3-error/30 flex items-center justify-center gap-2"
    style="font-family: var(--font-md3-sans);"
    transition:flyScale={{ y: -20, duration: 300 }}
  >
    <Icon name="warning" size="18px" />
    {$t('lockdown.banner')}
  </div>
{/if}
