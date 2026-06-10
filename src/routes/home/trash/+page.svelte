<script lang="ts">
  // Trash (Recycle Bin) page
  //
  // Shows deleted items with restore and permanent-delete actions.
  // This is a stub — the actual trash functionality depends on server-side
  // directory browsing which isn't yet implemented in the Rust backend.
  //
  // Reference: TrashModel in reference/src/include/ui/models/trash.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <!-- Back button -->
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/more')}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('trash.title')}
  </h1>

  <!-- Empty state -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-12 text-center space-y-3">
    <span class="text-md3-on-surface-variant">
      <Icon name="delete" size="64px" />
    </span>
    <p class="text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
      {$t('trash.empty')}
    </p>
    <p class="text-xs text-md3-on-surface-variant">
      {$t('trash.description')}
    </p>
  </div>
</div>
