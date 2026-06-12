<script lang="ts">
  // TwoFactorVerifyDialog — MD3 modal dialog for 2FA verification during login.
  //
  // Supports both TOTP codes (6-digit) and recovery codes (up to 20 chars)
  // with a toggle to switch between the two modes.
  //
  // Reference: reference/src/include/ui/controls/dialogs/twofa_verify.py

  import Icon from './Icon.svelte';
  import ModalFrame from './ModalFrame.svelte';
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

  function handleToggle() {
    useRecoveryCode = !useRecoveryCode;
    code = '';
    error = null;
  }

  async function handleVerify() {
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

  function onInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const filtered = filterInput(target.value);
    if (filtered !== target.value) {
      target.value = filtered;
    }
    code = filtered;
    if (error) error = null;
  }
</script>

<ModalFrame
  title={$t('dialog.twoFactor.title')}
  maxWidth="max-w-md"
  closeLabel={$t('common.close')}
  onClose={handleCancel}
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      handleVerify();
    }}
  >
    <div class="space-y-4 p-5">
      <p class="text-sm text-md3-on-surface-variant">
        {description}
      </p>

      <!-- Code input -->
      <div>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name={useRecoveryCode ? 'password' : 'pin'} size="18px" />
          </span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type={useRecoveryCode ? 'text' : 'text'}
            inputmode={useRecoveryCode ? 'text' : 'numeric'}
            class="w-full pl-10 pr-3.5 py-2.5 rounded-xl border
                   {error ? 'border-md3-error' : 'border-md3-outline'}
                   bg-md3-field text-md3-on-surface text-sm
                   placeholder:text-md3-on-surface-variant
                   focus:ring-2 focus:ring-md3-primary focus:border-transparent
                   transition-colors"
            placeholder={inputPlaceholder}
            maxlength={inputMaxLength}
            value={code}
            oninput={onInput}
            disabled={busy}
            autocomplete="one-time-code"
            autofocus
          />
        </div>
        {#if error}
          <p class="text-xs text-md3-error mt-1.5 ml-1">{error}</p>
        {/if}
      </div>

      <!-- Toggle mode -->
      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-md3-primary-emphasis
               hover:brightness-110 transition-all disabled:opacity-50"
        onclick={handleToggle}
        disabled={busy}
      >
        <Icon name={useRecoveryCode ? 'pin' : 'password'} size="16px" />
        {toggleLabel}
      </button>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between border-t border-md3-outline/60 px-5 pb-5 pt-4 gap-3">
      <div class="flex-1"></div>
      <button
        type="button"
        class="py-2 px-5 rounded-full font-medium text-sm
               border border-md3-outline text-md3-on-surface-variant
               hover:bg-md3-surface-container-high
               disabled:opacity-50 transition-all"
        style="font-family: var(--font-md3-sans);"
        onclick={handleCancel}
        disabled={busy}
      >
        {$t('common.cancel')}
      </button>
      <button
        type="submit"
        class="py-2 px-5 rounded-full font-medium text-sm
               bg-md3-primary text-md3-on-primary
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        disabled={busy || !code.trim()}
      >
        {#if busy}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.verifying')} />
          {$t('common.verifying')}
        {:else}
          {$t('dialog.twoFactor.verify')}
        {/if}
      </button>
    </div>
  </form>
</ModalFrame>
