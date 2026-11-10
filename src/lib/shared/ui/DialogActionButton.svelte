<script lang="ts">
  import type { Snippet, ComponentProps } from 'svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  interface Props extends Omit<ComponentProps<typeof FluentButton>, 'appearance' | 'children'> {
    variant?: 'primary' | 'secondary' | 'danger' | 'tonal'; class?: string; children: Snippet;
  }
  let { variant = 'secondary', class: className = '', children, ...attributes }: Props = $props();
</script>
  <FluentButton {...attributes} appearance={variant === 'primary' || variant === 'danger' ? 'primary' : variant === 'tonal' ? 'outline' : 'subtle'}
    class="dialog-action-button dialog-action-button--{variant} {className}">
    {@render children()}
  </FluentButton>
