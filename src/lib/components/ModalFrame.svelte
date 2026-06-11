<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { flyScale } from '$lib/motion/transitions';
  import Icon from '$lib/components/Icon.svelte';

  let {
    title,
    open = true,
    maxWidth = 'max-w-lg',
    closeLabel = 'Close',
    onClose,
    children,
  }: {
    title: string;
    open?: boolean;
    maxWidth?: string;
    closeLabel?: string;
    onClose: () => void;
    children: Snippet;
  } = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

{#if open}
  <div
    class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/48 p-4"
    role="presentation"
    transition:fade={{ duration: 160 }}
    onclick={onClose}
  >
    <div
      class={`modal-panel relative w-full ${maxWidth} overflow-hidden rounded-xl border border-md3-outline bg-md3-surface-container shadow-2xl`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      transition:flyScale={{ y: 18, duration: 260 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
    >
      <span class="modal-light" aria-hidden="true"></span>
      <div class="relative flex items-center justify-between border-b border-md3-outline px-5 py-4">
        <h3 class="min-w-0 truncate text-base font-semibold text-md3-on-surface">{title}</h3>
        <button
          class="rounded-full p-1 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface"
          aria-label={closeLabel}
          onclick={onClose}
        >
          <Icon name="close" size="20px" />
        </button>
      </div>
      <div class="relative">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-panel {
    backdrop-filter: blur(22px);
    box-shadow:
      0 24px 72px rgba(0, 0, 0, 0.30),
      0 2px 12px rgba(255, 255, 255, 0.08) inset;
  }

  .modal-light {
    pointer-events: none;
    position: absolute;
    inset: 0;
    background:
      linear-gradient(115deg, rgba(255, 255, 255, 0.20), transparent 32%),
      radial-gradient(circle at 12% 0%, rgba(255, 255, 255, 0.16), transparent 30%);
    opacity: 0.75;
  }

  @media (prefers-reduced-motion: no-preference) {
    .modal-backdrop {
      animation: modal-backdrop-focus 260ms cubic-bezier(0.2, 0, 0, 1);
    }
  }

  @keyframes modal-backdrop-focus {
    from {
      backdrop-filter: blur(0);
    }
    to {
      backdrop-filter: blur(8px);
    }
  }
</style>
