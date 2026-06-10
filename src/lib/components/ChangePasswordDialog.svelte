<script lang="ts">
  // ChangePasswordDialog — MD3 modal for the self-change password flow.
  //
  // Shown when the server rejects a login with code 4001/4002 ("password must
  // be changed before login").  The user supplies their current (expired)
  // password and a new one; on success they can sign in again.
  //
  // Mirrors the Python reference `PasswdUserDialog` (passwd_other = False):
  // reference/cfms_client_next/src/include/ui/controls/dialogs/admin/accounts.py
  // and PasswdDialogController in controllers/dialogs/passwd.py.

  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';
  import { flyScale } from '$lib/motion/transitions';

  interface Props {
    /** The username whose password is being changed. */
    username: string;
    /** Pre-fill the "old password" field (e.g. the password just attempted). */
    initialOldPassword?: string;
    /** Optional tip shown under the fields (e.g. why the change is required). */
    tip?: string;
    /** Submit handler. Should throw with a message on failure. */
    onSubmit: (oldPassword: string, newPassword: string) => Promise<void>;
    /** Cancel handler. */
    onCancel: () => void;
  }

  let {
    username,
    initialOldPassword = '',
    tip = '',
    onSubmit,
    onCancel,
  }: Props = $props();

  // Seed the field from the prop's initial value once (the password the user
  // just attempted); `untrack` makes the "capture initial value only" intent
  // explicit and silences the state_referenced_locally warning.
  let oldPassword = $state(untrack(() => initialOldPassword));
  let newPassword = $state('');
  let oldVisible = $state(false);
  let newVisible = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  // Live strength estimate of the new password (purely advisory — the server
  // enforces the authoritative rules).
  const strength = $derived(estimateStrength(newPassword));

  function estimateStrength(pw: string): { score: number; label: string } {
    if (!pw) return { score: 0, label: '' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const labels = [
      $t('dialog.changePassword.veryWeak'),
      $t('dialog.changePassword.weak'),
      $t('dialog.changePassword.fair'),
      $t('dialog.changePassword.good'),
      $t('dialog.changePassword.strong'),
      $t('dialog.changePassword.strong'),
    ];
    return { score, label: labels[score] };
  }

  /** Generate a strong random password that satisfies common rule sets
   *  (lower + upper + digit + symbol, 16 chars). Mirrors the reference's
   *  "dice" button which calls generate_random_password(). */
  function generateRandomPassword(): string {
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#$%^&*()-_=+[]{}';
    const all = lower + upper + digits + symbols;
    const pick = (set: string) => set[randInt(set.length)];
    const chars: string[] = [
      pick(lower),
      pick(upper),
      pick(digits),
      pick(symbols),
    ];
    for (let i = chars.length; i < 16; i++) chars.push(pick(all));
    // Fisher–Yates shuffle so the guaranteed-class chars aren't always first.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /** Cryptographically-strong integer in [0, max). */
  function randInt(max: number): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }

  function handleDice() {
    const pw = generateRandomPassword();
    newPassword = pw;
    newVisible = true; // reveal so the user can copy/remember it
    if (error) error = null;
  }

  async function handleSubmit() {
    if (!oldPassword) {
      error = $t('dialog.changePassword.currentRequired');
      return;
    }
    if (!newPassword) {
      error = $t('dialog.changePassword.newRequired');
      return;
    }
    if (newPassword === oldPassword) {
      error = $t('dialog.changePassword.mustDiffer');
      return;
    }

    error = null;
    busy = true;
    try {
      await onSubmit(oldPassword, newPassword);
      // On success the parent closes the dialog.
    } catch (e) {
      error = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function handleCancel() {
    if (!busy) onCancel();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleCancel();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4"
  style="background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);"
  onclick={handleCancel}
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-md3-surface-container border border-md3-outline rounded-xl
           w-full max-w-md shadow-2xl overflow-hidden"
    style="border-radius: var(--radius-md3-dialog);"
    in:flyScale={{ y: 16, duration: 320 }}
    onclick={(e: MouseEvent) => e.stopPropagation()}
    onkeydown={() => {}}
    role="dialog"
    aria-modal="true"
    aria-label={$t('dialog.changePassword.title')}
    tabindex="-1"
  >
    <!-- Title bar -->
    <div class="flex items-center justify-between px-6 pt-6 pb-2">
      <div class="flex items-center gap-2.5">
        <span class="text-md3-primary"><Icon name="lockPerson" size="22px" /></span>
        <h2
          class="text-lg font-semibold text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {$t('dialog.changePassword.title')}
        </h2>
      </div>
      <button
        type="button"
        class="text-md3-on-surface-variant hover:text-md3-on-surface
               transition-colors rounded-full p-1"
        onclick={handleCancel}
        disabled={busy}
        aria-label={$t('common.close')}
      >
        <Icon name="close" size="20px" />
      </button>
    </div>

    <!-- Body -->
    <form
      class="px-6 pb-2 space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <p class="text-sm text-md3-on-surface-variant">
        {$t('dialog.changePassword.changingFor', { values: { username } })}
      </p>

      <!-- Old password -->
      <div>
        <label
          for="cp-old"
          class="block text-sm font-medium mb-1.5 text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {$t('dialog.changePassword.currentPassword')}
        </label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="password" size="18px" />
          </span>
          <input
            id="cp-old"
            type={oldVisible ? 'text' : 'password'}
            class="w-full pl-10 pr-10 py-2.5 rounded-xl border border-md3-outline
                   bg-md3-field text-md3-on-surface text-sm
                   placeholder:text-md3-on-surface-variant
                   focus:ring-2 focus:ring-md3-primary focus:border-transparent
                   transition-colors"
            placeholder={$t('dialog.changePassword.currentPasswordPlaceholder')}
            bind:value={oldPassword}
            disabled={busy}
            autocomplete="current-password"
          />
          <button
            type="button"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant
                   hover:text-md3-on-surface transition-colors"
            onclick={() => (oldVisible = !oldVisible)}
            tabindex="-1"
            aria-label={oldVisible ? $t('login.hidePassword') : $t('login.showPassword')}
          >
            <Icon name="visibility" size="18px" />
          </button>
        </div>
      </div>

      <!-- New password -->
      <div>
        <label
          for="cp-new"
          class="block text-sm font-medium mb-1.5 text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {$t('dialog.changePassword.newPassword')}
        </label>
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="password" size="18px" />
          </span>
          <input
            id="cp-new"
            type={newVisible ? 'text' : 'password'}
            class="w-full pl-10 pr-20 py-2.5 rounded-xl border border-md3-outline
                   bg-md3-field text-md3-on-surface text-sm
                   placeholder:text-md3-on-surface-variant
                   focus:ring-2 focus:ring-md3-primary focus:border-transparent
                   transition-colors"
            placeholder={$t('dialog.changePassword.newPasswordPlaceholder')}
            bind:value={newPassword}
            disabled={busy}
            autocomplete="new-password"
          />
          <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              type="button"
              class="text-md3-on-surface-variant hover:text-md3-primary
                     transition-colors rounded-full p-1"
              onclick={handleDice}
              disabled={busy}
              tabindex="-1"
              title={$t('dialog.changePassword.generateStrongPassword')}
              aria-label={$t('dialog.changePassword.generateStrongPassword')}
            >
              <Icon name="refresh" size="18px" />
            </button>
            <button
              type="button"
              class="text-md3-on-surface-variant hover:text-md3-on-surface
                     transition-colors rounded-full p-1"
              onclick={() => (newVisible = !newVisible)}
              tabindex="-1"
              aria-label={newVisible ? $t('login.hidePassword') : $t('login.showPassword')}
            >
              <Icon name="visibility" size="18px" />
            </button>
          </div>
        </div>

        <!-- Strength meter -->
        {#if newPassword}
          <div class="mt-2 flex items-center gap-2">
            <div class="flex-1 h-1.5 rounded-full bg-md3-surface-container-high overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                style="width: {(strength.score / 5) * 100}%;
                       background: {strength.score <= 1
                         ? 'var(--color-md3-error, #e5484d)'
                         : strength.score <= 3
                         ? '#f5a524'
                         : 'var(--color-md3-primary, #7c9cff)'};"
              ></div>
            </div>
            <span class="text-xs text-md3-on-surface-variant w-16 text-right">{strength.label}</span>
          </div>
        {/if}
      </div>

      {#if tip || $t('dialog.changePassword.defaultTip')}
        <p class="text-xs text-md3-on-surface-variant flex items-start gap-1.5">
          <span class="shrink-0 mt-0.5 text-md3-tertiary"><Icon name="info" size="14px" /></span>
          <span>{tip || $t('dialog.changePassword.defaultTip')}</span>
        </p>
      {/if}

      {#if error}
        <div
          class="bg-md3-error-container/60 border border-md3-error/30
                 text-md3-on-error-container text-sm rounded-xl p-3 flex items-start gap-2"
        >
          <span class="shrink-0 mt-0.5"><Icon name="errorFilled" size="16px" /></span>
          <span>{error}</span>
        </div>
      {/if}

      <!-- Actions -->
      <div class="flex items-center justify-end gap-3 pt-2 pb-4">
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
          disabled={busy || !oldPassword || !newPassword}
        >
          {#if busy}
            <span class="animate-spin"><Icon name="refresh" size="16px" /></span>
            {$t('common.changing')}
          {:else}
            <Icon name="done" size="16px" />
            {$t('dialog.changePassword.title')}
          {/if}
        </button>
      </div>
    </form>
  </div>
</div>
