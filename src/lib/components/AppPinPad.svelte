<script lang="ts">
  const keypad = [
    { digit: '1', letters: '' },
    { digit: '2', letters: 'ABC' },
    { digit: '3', letters: 'DEF' },
    { digit: '4', letters: 'GHI' },
    { digit: '5', letters: 'JKL' },
    { digit: '6', letters: 'MNO' },
    { digit: '7', letters: 'PQRS' },
    { digit: '8', letters: 'TUV' },
    { digit: '9', letters: 'WXYZ' },
  ];

  let {
    value = $bindable(''),
    length = 4,
    disabled = false,
    shake = false,
    deleteLabel = 'Delete',
    class: className = '',
  }: {
    value?: string;
    length?: number;
    disabled?: boolean;
    shake?: boolean;
    deleteLabel?: string;
    class?: string;
  } = $props();

  const dots = $derived(Array.from({ length }, (_, index) => index < value.length));

  function appendDigit(digit: string) {
    if (disabled || value.length >= length) return;
    value += digit;
  }

  function deleteDigit() {
    if (disabled || value.length === 0) return;
    value = value.slice(0, -1);
  }
</script>

<div class={`app-pin-pad ${className}`}>
  <div class="app-pin-pad__dots" class:app-pin-pad__dots--shake={shake}>
    {#each dots as filled}
      <span class="app-pin-pad__dot" class:app-pin-pad__dot--filled={filled}></span>
    {/each}
  </div>

  <div class="app-pin-pad__keys">
    {#each keypad as key}
      <button
        type="button"
        class="app-pin-key"
        onclick={() => appendDigit(key.digit)}
        disabled={disabled}
        aria-label={key.digit}
      >
        <span class="app-pin-key__digit">{key.digit}</span>
        <span class="app-pin-key__letters">{key.letters}</span>
      </button>
    {/each}

    <span aria-hidden="true"></span>
    <button
      type="button"
      class="app-pin-key"
      onclick={() => appendDigit('0')}
      disabled={disabled}
      aria-label="0"
    >
      <span class="app-pin-key__digit">0</span>
      <span class="app-pin-key__letters"></span>
    </button>
    <button
      type="button"
      class="app-pin-delete"
      onclick={deleteDigit}
      disabled={disabled || value.length === 0}
    >
      {deleteLabel}
    </button>
  </div>
</div>

<style>
  .app-pin-pad {
    display: flex;
    inline-size: 100%;
    max-inline-size: 420px;
    flex-direction: column;
    align-items: center;
  }

  .app-pin-pad__dots {
    display: flex;
    block-size: 28px;
    align-items: center;
    justify-content: center;
    gap: 1.75rem;
  }

  .app-pin-pad__dot {
    inline-size: 20px;
    block-size: 20px;
    border: 2px solid rgba(255, 255, 255, 0.92);
    border-radius: 9999px;
    background: transparent;
    transition:
      background-color 120ms var(--motion-easing-standard),
      transform 160ms var(--motion-easing-emphasized-decelerate);
  }

  .app-pin-pad__dot--filled {
    background: white;
    transform: scale(1.08);
  }

  .app-pin-pad__keys {
    display: grid;
    inline-size: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-items: center;
    gap: 1.5rem 2rem;
    margin-block-start: 2rem;
  }

  .app-pin-key {
    display: inline-flex;
    inline-size: clamp(86px, 25vw, 118px);
    block-size: clamp(86px, 25vw, 118px);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 9999px;
    color: white;
    background: rgba(255, 255, 255, 0.13);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.16);
    transition:
      transform 160ms var(--motion-easing-emphasized-decelerate),
      background-color 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard);
  }

  .app-pin-key:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
    transform: translateY(-2px);
  }

  .app-pin-key:active:not(:disabled) {
    transform: scale(0.95);
  }

  .app-pin-key:disabled,
  .app-pin-delete:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .app-pin-key__digit {
    font-size: clamp(3rem, 12vw, 4.4rem);
    font-weight: 300;
    line-height: 0.92;
  }

  .app-pin-key__letters {
    min-block-size: 1.1rem;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.22em;
    opacity: 0.95;
  }

  .app-pin-delete {
    align-self: center;
    justify-self: stretch;
    min-block-size: 44px;
    border: 0;
    border-radius: 9999px;
    color: rgba(255, 255, 255, 0.94);
    background: transparent;
    font-size: 1.05rem;
    font-weight: 500;
    transition:
      background-color 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard);
  }

  .app-pin-delete:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .app-pin-pad__dots--shake {
    animation: app-pin-shake 340ms var(--motion-easing-standard);
  }

  @keyframes app-pin-shake {
    0%,
    100% {
      transform: translateX(0);
    }

    20% {
      transform: translateX(-10px);
    }

    40% {
      transform: translateX(9px);
    }

    60% {
      transform: translateX(-6px);
    }

    80% {
      transform: translateX(4px);
    }
  }

  @media (max-width: 420px) {
    .app-pin-pad__dot {
      inline-size: 17px;
      block-size: 17px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .app-pin-key,
    .app-pin-pad__dot,
    .app-pin-pad__dots--shake {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
