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
    transition:fade|global={{ duration: 160 }}
    onclick={onClose}
  >
    <div
      class={`modal-panel relative flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-md3-outline bg-md3-surface-container shadow-2xl`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      transition:flyScale|global={{ y: 18, duration: 240 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
    >
      <span class="modal-light" aria-hidden="true"></span>
      <div class="relative flex shrink-0 items-center justify-between border-b border-md3-outline px-5 py-4">
        <h3 class="min-w-0 truncate text-base font-semibold text-md3-on-surface">{title}</h3>
        <button
          class="rounded-full p-1 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface"
          aria-label={closeLabel}
          onclick={onClose}
        >
          <Icon name="close" size="20px" />
        </button>
      </div>
      <div class="relative min-h-0 overflow-auto">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-panel {
    background:
      linear-gradient(145deg, rgba(31, 41, 55, 0.98) 0%, rgba(20, 29, 43, 0.98) 48%, rgba(15, 23, 42, 0.98) 100%);
    backdrop-filter: blur(22px);
    border-color: rgba(99, 102, 241, 0.22);
    box-shadow:
      0 28px 90px rgba(0, 0, 0, 0.42),
      0 0 0 1px rgba(148, 163, 184, 0.06) inset,
      0 1px 24px rgba(79, 70, 229, 0.10) inset;
  }

  .modal-backdrop {
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }

  .modal-light {
    pointer-events: none;
    position: absolute;
    inset: 0;
    background:
      linear-gradient(125deg, rgba(79, 70, 229, 0.16), transparent 35%),
      radial-gradient(circle at 12% -8%, rgba(45, 212, 191, 0.10), transparent 30%),
      linear-gradient(180deg, rgba(148, 163, 184, 0.05), transparent 28%);
    opacity: 1;
  }

  @media (prefers-reduced-motion: no-preference) {
    .modal-backdrop {
      animation: modal-backdrop-focus 260ms cubic-bezier(0.2, 0, 0, 1) both;
    }
  }

  @keyframes modal-backdrop-focus {
    from {
      -webkit-backdrop-filter: blur(0);
      backdrop-filter: blur(0);
    }
    to {
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
    }
  }
</style>
