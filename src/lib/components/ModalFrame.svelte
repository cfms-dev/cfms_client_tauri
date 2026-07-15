<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { flyScale } from '$lib/motion/transitions';
  import Icon from '$lib/components/Icon.svelte';

  let {
    title,
    open = true,
    maxWidth = 'max-w-lg',
    closeLabel = 'Close',
    dismissible = true,
    closeOnBackdrop = true,
    onClose,
    children,
  }: {
    title: string;
    open?: boolean;
    maxWidth?: string;
    closeLabel?: string;
    dismissible?: boolean;
    closeOnBackdrop?: boolean;
    onClose: () => void;
    children: Snippet;
  } = $props();

  let panelElement = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    let cancelled = false;

    tick().then(() => {
      if (!cancelled && panelElement && !panelElement.contains(document.activeElement)) {
        const preferredTarget = panelElement.querySelector<HTMLElement>(
          '.modal-content [autofocus], .modal-content input:not(:disabled), .modal-content textarea:not(:disabled), .modal-content select:not(:disabled)',
        );
        (preferredTarget ?? panelElement).focus({ preventScroll: true });
      }
    });

    return () => {
      cancelled = true;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!isTopmostDialog()) return;

    if (
      event.key === 'Enter'
      && (event.ctrlKey || event.metaKey)
      && !event.altKey
      && event.target instanceof HTMLTextAreaElement
    ) {
      const form = event.target.closest('form');
      if (form) {
        event.preventDefault();
        form.requestSubmit();
        return;
      }
    }

    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !panelElement) return;
    const focusable = Array.from(panelElement.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    ));

    if (focusable.length === 0) {
      event.preventDefault();
      panelElement.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function isTopmostDialog() {
    if (!panelElement) return false;
    const dialogs = document.querySelectorAll<HTMLElement>('.modal-panel[role="dialog"]');
    return dialogs[dialogs.length - 1] === panelElement;
  }

  function handleBackdropClick() {
    if (dismissible && closeOnBackdrop) onClose();
  }
</script>

{#if open}
  <div
    class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
    role="presentation"
    transition:fade|global={{ duration: 140 }}
    onclick={handleBackdropClick}
  >
    <div
      bind:this={panelElement}
      class={`modal-panel relative flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col overflow-hidden`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      transition:flyScale|global={{ y: 12, duration: 200 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
    >
      <div class="modal-header relative flex shrink-0 items-center justify-between gap-3">
        <h2 class="modal-title min-w-0 truncate text-md3-on-surface">{title}</h2>
        <button
          type="button"
          class="modal-close grid shrink-0 place-items-center text-md3-on-surface-variant"
          aria-label={closeLabel}
          disabled={!dismissible}
          onclick={onClose}
        >
          <Icon name="close" size="20px" />
        </button>
      </div>
      <div class="modal-content relative min-h-0 overflow-auto">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-panel {
    isolation: isolate;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-large, 12px);
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-surface-container) 97%, transparent);
    box-shadow: var(--explorer-shadow, 0 24px 64px rgba(0, 0, 0, 0.38));
    font-family: var(--font-md3-sans);
    -webkit-backdrop-filter: blur(24px) saturate(1.08);
    backdrop-filter: blur(24px) saturate(1.08);
    outline: none;
  }

  /* The panel is a programmatic focus boundary, not an interactive control.
     Override the workspace-wide [tabindex]:focus-visible rule while leaving
     visible focus indicators on the dialog's inputs and buttons intact. */
  .modal-panel:focus,
  .modal-panel:focus-visible {
    outline: none !important;
  }

  .modal-header {
    min-height: 52px;
    border-bottom: 1px solid var(--color-md3-outline);
    padding: 0.625rem 0.75rem 0.625rem 1.25rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 46%, transparent);
  }

  .modal-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 650;
    letter-spacing: -0.005em;
  }

  .modal-close {
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 6px);
    background: transparent;
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .modal-close:hover {
    border-color: var(--color-md3-outline);
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-highest);
  }

  .modal-close:active {
    transform: scale(0.94);
  }

  .modal-close:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .modal-content {
    scrollbar-gutter: stable;
  }

  .modal-backdrop {
    --color-md3-primary: #60cdff;
    --color-md3-primary-emphasis: #60cdff;
    --color-md3-primary-container: rgba(96, 205, 255, 0.16);
    --color-md3-on-primary: #0f1115;
    --color-md3-on-primary-container: #f5f5f5;
    --color-md3-surface: #0f1115;
    --color-md3-surface-container: #17191d;
    --color-md3-surface-container-high: #20232a;
    --color-md3-surface-container-highest: #292d35;
    --color-md3-outline: rgba(255, 255, 255, 0.11);
    --color-md3-outline-variant: rgba(255, 255, 255, 0.18);
    --color-md3-on-surface: #f5f5f5;
    --color-md3-on-surface-variant: #b4b8c1;
    --color-md3-field: #20232a;
    --color-md3-error: #ff99a4;
    --color-md3-error-action: #c42b1c;
    --color-md3-error-container: rgba(255, 153, 164, 0.14);
    --color-md3-on-error-action: #ffffff;
    --color-md3-on-error-container: #ff99a4;

    padding-top: max(1rem, var(--safe-area-top, 0px));
    padding-right: max(1rem, var(--safe-area-right, 0px));
    padding-bottom: max(1rem, var(--safe-area-bottom, 0px));
    padding-left: max(1rem, var(--safe-area-left, 0px));
    background: rgba(3, 6, 11, 0.62);
    -webkit-backdrop-filter: blur(10px) saturate(0.9);
    backdrop-filter: blur(10px) saturate(0.9);
  }

  :global(html[data-theme='light']) .modal-backdrop {
    --color-md3-primary: #0067c0;
    --color-md3-primary-emphasis: #0067c0;
    --color-md3-primary-container: rgba(0, 103, 192, 0.12);
    --color-md3-on-primary: #ffffff;
    --color-md3-on-primary-container: #1a1a1a;
    --color-md3-surface: #f3f3f3;
    --color-md3-surface-container: #fafafa;
    --color-md3-surface-container-high: #ffffff;
    --color-md3-surface-container-highest: #ececec;
    --color-md3-outline: rgba(0, 0, 0, 0.10);
    --color-md3-outline-variant: rgba(0, 0, 0, 0.16);
    --color-md3-on-surface: #1a1a1a;
    --color-md3-on-surface-variant: #5d5d5d;
    --color-md3-field: #ffffff;
    --color-md3-error: #c42b1c;
    --color-md3-error-action: #c42b1c;
    --color-md3-error-container: rgba(196, 43, 28, 0.10);
    --color-md3-on-error-action: #ffffff;
    --color-md3-on-error-container: #c42b1c;

    background: rgba(15, 23, 42, 0.28);
  }

  :global(html[data-theme='light']) .modal-panel {
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
  }

  .modal-backdrop {
    animation: modal-backdrop-focus 220ms var(--motion-easing-standard) both;
  }

  @keyframes modal-backdrop-focus {
    from {
      -webkit-backdrop-filter: blur(0);
      backdrop-filter: blur(0);
    }
    to {
      -webkit-backdrop-filter: blur(10px) saturate(0.9);
      backdrop-filter: blur(10px) saturate(0.9);
    }
  }
</style>
