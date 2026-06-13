<script lang="ts">
  // TwoFactorVerifyDialog — MD3 modal dialog for 2FA verification during login.
  //
  // Supports both TOTP codes (6-digit) and recovery codes (up to 20 chars)
  // with a toggle to switch between the two modes.
  //
  // Reference: reference/src/include/ui/controls/dialogs/twofa_verify.py

  import { fade } from 'svelte/transition';
  import { onDestroy } from 'svelte';
  import { flyScale } from '$lib/motion/transitions';
  import Icon from './Icon.svelte';
  import ProgressRing from './ProgressRing.svelte';
  import { _ as t } from 'svelte-i18n';

  interface Props {
    /** Called with (code, isRecoveryCode) when the user submits. Returns true on success. */
    onVerify: (code: string, isRecoveryCode: boolean) => Promise<boolean>;
    /** Called when the user cancels 2FA. */
    onCancel: () => void;
    /** The 2FA method label (e.g. "totp"). */
    method?: string;
  }

  let { onVerify, onCancel, method = 'totp' }: Props = $props();

  let code = $state('');
  let useRecoveryCode = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let pulseIndex = $state<number | null>(null);
  let codeInput: HTMLInputElement | null = $state(null);
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;

  const description = $derived(
    useRecoveryCode
      ? $t('dialog.twoFactor.recoveryDescription')
      : $t('dialog.twoFactor.totpDescription')
  );

  const toggleLabel = $derived(
    useRecoveryCode
      ? $t('dialog.twoFactor.useAuthenticator')
      : $t('dialog.twoFactor.useRecovery')
  );

  const inputMaxLength = $derived(useRecoveryCode ? 20 : 6);
  const inputPlaceholder = $derived(useRecoveryCode ? $t('dialog.twoFactor.recoveryPlaceholder') : '000000');
  const codeCells = $derived(
    Array.from({ length: 6 }, (_, index) => code[index] ?? '')
  );

  function handleToggle() {
    useRecoveryCode = !useRecoveryCode;
    code = '';
    error = null;
    pulseIndex = null;
    queueMicrotask(() => codeInput?.focus());
  }

  async function handleVerify() {
    if (busy) return;

    const trimmed = code.trim();
    if (!trimmed) {
      error = useRecoveryCode
        ? $t('dialog.twoFactor.enterRecovery')
        : $t('dialog.twoFactor.enterTotp');
      return;
    }
    if (!useRecoveryCode && trimmed.length !== 6) {
      error = $t('dialog.twoFactor.enterTotp');
      return;
    }

    error = null;
    busy = true;

    try {
      const success = await onVerify(trimmed, useRecoveryCode);
      if (!success) {
        code = '';
        pulseIndex = null;
        error = useRecoveryCode
          ? $t('dialog.twoFactor.invalidRecovery')
          : $t('dialog.twoFactor.invalidCode');
      }
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  function handleCancel() {
    if (!busy) {
      onCancel();
    }
  }

  /** Only allow digits in TOTP mode. */
  function filterInput(value: string): string {
    if (useRecoveryCode) return value;
    return value.replace(/[^0-9]/g, '');
  }

  function pulseCodeCell(previous: string, next: string) {
    if (useRecoveryCode || previous === next) return;

    const lengthDelta = next.length - previous.length;
    if (lengthDelta === 0) return;

    const changedIndex = lengthDelta > 0 ? next.length - 1 : previous.length - 1;
    if (changedIndex < 0 || changedIndex >= 6) return;

    if (pulseTimer) clearTimeout(pulseTimer);
    pulseIndex = null;

    requestAnimationFrame(() => {
      pulseIndex = changedIndex;
      pulseTimer = setTimeout(() => {
        pulseIndex = null;
        pulseTimer = null;
      }, 180);
    });
  }

  function moveTotpCaretToEnd(target = codeInput) {
    if (useRecoveryCode || !target) return;

    const end = target.value.length;
    target.setSelectionRange(end, end);
  }

  function onTotpKeydown(e: KeyboardEvent) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      moveTotpCaretToEnd(e.currentTarget as HTMLInputElement);
    }
  }

  function onInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const previous = code;
    const filtered = filterInput(target.value);
    if (filtered !== target.value) {
      target.value = filtered;
    }
    pulseCodeCell(previous, filtered);
    code = filtered;
    moveTotpCaretToEnd(target);
    if (error) error = null;

    if (!useRecoveryCode && !busy && previous.length < 6 && filtered.length === 6) {
      void handleVerify();
    }
  }

  onDestroy(() => {
    if (pulseTimer) clearTimeout(pulseTimer);
  });
</script>

<div
  class="twofa-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
  role="presentation"
  transition:fade|global={{ duration: 180 }}
  onclick={handleCancel}
>
  <div
    class="twofa-panel relative w-full max-w-[560px] overflow-hidden rounded-[24px] border border-md3-outline/40 bg-md3-surface-container"
    role="dialog"
    aria-modal="true"
    aria-label={$t('dialog.twoFactor.title')}
    tabindex="-1"
    transition:flyScale|global={{ y: 18, duration: 260 }}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') handleCancel();
    }}
  >
    <form
      onsubmit={(event) => {
        event.preventDefault();
        handleVerify();
      }}
    >
      <button
        type="button"
        class="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full text-md3-on-surface-variant transition-all hover:bg-white/10 hover:text-md3-on-surface disabled:opacity-50"
        aria-label={$t('common.close')}
        onclick={handleCancel}
        disabled={busy}
      >
        <Icon name="close" size="22px" />
      </button>

      <div class="relative px-5 pb-5 pt-7 sm:px-10 sm:pb-8 sm:pt-9">
      <div class="twofa-icon mx-auto mb-6 grid h-20 w-20 place-items-center text-md3-primary-emphasis">
        <Icon name="approvalDelegation" size="64px" />
      </div>

      <div class="mx-auto max-w-[430px] text-center">
        <h2 class="text-2xl font-bold text-md3-on-surface sm:text-[28px]" style="font-family: var(--font-md3-sans);">
          {$t('dialog.twoFactor.title')}
        </h2>
        <p class="mt-4 text-sm leading-6 text-md3-on-surface-variant sm:text-base">
          {description}
        </p>
      </div>

      <div class="mx-auto mt-8 max-w-[460px]">
        {#if useRecoveryCode}
          <div class="relative">
            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
              <Icon name="password" size="19px" />
            </span>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:this={codeInput}
              type="text"
              inputmode="text"
              class="w-full rounded-2xl border bg-md3-field/90 py-3.5 pl-12 pr-4 text-sm text-md3-on-surface outline-none transition-all placeholder:text-md3-on-surface-variant
                     {error ? 'border-md3-error shadow-[0_0_0_4px_rgba(248,113,113,0.12)]' : 'border-md3-outline focus:border-md3-primary focus:shadow-[0_0_0_4px_rgba(79,70,229,0.18)]'}"
              placeholder={inputPlaceholder}
              maxlength={inputMaxLength}
              value={code}
              oninput={onInput}
              disabled={busy}
              autocomplete="one-time-code"
              autofocus
            />
          </div>
        {:else}
          <button
            type="button"
            class="code-entry group relative grid w-full cursor-text grid-cols-6 gap-2 rounded-3xl px-1 py-2 transition-all sm:gap-3"
            class:code-entry-error={Boolean(error)}
            onclick={() => codeInput?.focus()}
            aria-label={$t('dialog.twoFactor.enterTotp')}
          >
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:this={codeInput}
              class="code-input"
              type="text"
              inputmode="numeric"
              maxlength={inputMaxLength}
              value={code}
              oninput={onInput}
              onkeydown={onTotpKeydown}
              onfocus={(e) => moveTotpCaretToEnd(e.currentTarget)}
              onclick={(e) => moveTotpCaretToEnd(e.currentTarget)}
              disabled={busy}
              autocomplete="one-time-code"
              autofocus
            />
            {#each codeCells as digit, index}
              <span
                class="code-cell"
                class:code-cell-active={code.length === index}
                class:code-cell-pulse={pulseIndex === index}
              >
                {digit}
              </span>
            {/each}
          </button>
        {/if}

        {#if error}
          <p class="mt-3 flex items-center justify-center gap-1.5 text-sm text-md3-error">
            <Icon name="errorFilled" size="17px" />
            {error}
          </p>
        {/if}
      </div>

      <div class="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-md3-primary-emphasis transition-all hover:bg-md3-primary/10 disabled:opacity-50"
          style="font-family: var(--font-md3-sans);"
          onclick={handleToggle}
          disabled={busy}
        >
          <Icon name={useRecoveryCode ? 'pin' : 'password'} size="18px" />
          {toggleLabel}
        </button>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-full px-5 py-2.5 text-sm font-medium text-md3-on-surface-variant transition-all hover:bg-white/10 hover:text-md3-on-surface disabled:opacity-50"
            style="font-family: var(--font-md3-sans);"
            onclick={handleCancel}
            disabled={busy}
          >
            {$t('common.cancel')}
          </button>
          <button
            type="submit"
            class="inline-flex min-w-28 items-center justify-center gap-2 rounded-full bg-md3-primary px-5 py-2.5 text-sm font-semibold text-md3-on-primary shadow-lg shadow-md3-primary/25 transition-all hover:brightness-110 disabled:opacity-50"
            style="font-family: var(--font-md3-sans);"
            disabled={busy || !code.trim()}
          >
            {#if busy}
              <ProgressRing size={16} strokeWidth={2.4} label={$t('common.verifying')} />
              {$t('common.verifying')}
            {:else}
              <Icon name="check" size="18px" />
              {$t('dialog.twoFactor.verify')}
            {/if}
          </button>
        </div>
      </div>
      </div>
    </form>
  </div>
</div>

<style>
  .twofa-backdrop {
    background:
      radial-gradient(circle at 50% 46%, rgba(143, 180, 255, 0.12), transparent 34rem),
      rgba(2, 6, 23, 0.54);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }

  .twofa-panel {
    background: var(--color-md3-surface-container);
    box-shadow: 0 24px 72px rgba(0, 0, 0, 0.34);
  }

  .twofa-icon {
    animation: icon-rise var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate) both;
  }

  .code-input {
    position: absolute;
    inset: 0;
    z-index: 2;
    height: 100%;
    width: 100%;
    cursor: text;
    border: 0;
    background: transparent;
    color: transparent;
    caret-color: transparent;
    outline: none;
  }

  .code-cell {
    display: grid;
    min-height: 4.25rem;
    place-items: center;
    border-bottom: 2px solid rgba(156, 163, 175, 0.45);
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-size: clamp(2rem, 8vw, 2.75rem);
    font-weight: 500;
    line-height: 1;
    transition:
      border-color var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .code-cell-active {
    border-color: var(--color-md3-primary-emphasis);
    color: var(--color-md3-primary-emphasis);
  }

  .code-entry:focus-within .code-cell-active,
  .code-entry:hover .code-cell-active {
    border-color: var(--color-md3-primary);
  }

  .code-entry-error .code-cell {
    border-color: rgba(248, 113, 113, 0.70);
  }

  .code-cell-pulse {
    animation: code-line-pulse 180ms var(--motion-easing-emphasized-decelerate);
  }

  @keyframes icon-rise {
    from {
      opacity: 0;
      transform: translate3d(0, 4px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes code-line-pulse {
    0%,
    100% {
      transform: translateY(0);
    }
    45% {
      transform: translateY(-2px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .twofa-icon,
    .code-cell-pulse {
      animation: none !important;
    }

    .code-cell {
      transition: none !important;
    }
  }
</style>
