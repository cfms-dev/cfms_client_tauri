<script lang="ts">
  import MdOutlinedField from '#lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '#lib/shared/ui/FluentButton.svelte';
  // Shared password change dialog for elevated self-service and POST_AUTH.
  import { onDestroy } from 'svelte';
  import DialogActionButton from '#lib/shared/ui/DialogActionButton.svelte';
  import Icon from '#lib/shared/ui/Icon.svelte';
  import ModalFrame from '#lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '#lib/shared/ui/ProgressRing.svelte';
  import { _ as t } from 'svelte-i18n';
  import { notificationStore } from "#lib/shared/notifications/notifications.svelte.ts";
  import { formatUserFacingError } from '#lib/shared/errors/user-facing-errors.ts';
  import { estimatePasswordStrength, generateRandomPassword } from '#lib/shared/password.ts';

  interface Props {
    /** The username whose password is being changed. */
    username: string;
    /** Optional tip shown under the fields (e.g. why the change is required). */
    tip?: string;
    /** Submit handler. Should throw with a message on failure. */
    onSubmit: (newPassword: string) => Promise<void>;
    /** Cancel handler. */
    onCancel: () => void;
  }

  let {
    username,
    tip = '',
    onSubmit,
    onCancel,
  }: Props = $props();

  let newPassword = $state('');
  let newVisible = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onDestroy(() => {
    newPassword = '';
  });

  // Live strength estimate of the new password (purely advisory — the server
  // enforces the authoritative rules).
  const strength = $derived.by(() => {
    const result = estimatePasswordStrength(newPassword);
    return { score: result.score, label: result.labelKey ? $t(result.labelKey) : '' };
  });

  function handleDice() {
    const pw = generateRandomPassword();
    newPassword = pw;
    newVisible = true; // reveal so the user can copy/remember it
    if (error) error = null;
  }

  async function handleSubmit() {
    if (!newPassword) {
      error = $t('dialog.changePassword.newRequired');
      return;
    }
    error = null;
    busy = true;
    try {
      await onSubmit(newPassword);
      // On success the parent closes the dialog.
    } catch (e) {
      notificationStore.error(formatUserFacingError(e));
    } finally {
      busy = false;
    }
  }

  function handleCancel() {
    if (!busy) onCancel();
  }
</script>

<ModalFrame
  title={$t('dialog.changePassword.title')}
  maxWidth="max-w-md"
  closeLabel={$t('common.close')}
  onClose={handleCancel}
>
    <form
      class="space-y-4 p-5"
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div class="flex items-start gap-3 rounded-lg border border-md3-outline/60 bg-md3-surface-container-high p-3">
        <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
          <Icon name="lockPerson" size="20px" />
        </span>
        <p class="text-sm text-md3-on-surface-variant">
          {$t('dialog.changePassword.changingFor', { values: { username } })}
        </p>
      </div>

      <div>
        <MdOutlinedField inputId="cp-new" label={$t('dialog.changePassword.newPassword')} disabled={busy}>
          <div data-outlined-content class="relative">
            <span data-field-leading-icon class="absolute flex left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
              <Icon name="password" size="18px" />
            </span>
            <input data-focus-ring="delegated"
              id="cp-new"
              type={newVisible ? 'text' : 'password'}
              class="w-full pl-10 text-md3-on-surface text-sm
                     placeholder:text-md3-on-surface-variant
                     transition-colors"
              placeholder={$t('dialog.changePassword.newPasswordPlaceholder')}
              bind:value={newPassword}
              disabled={busy}
              autocomplete="new-password"
            />
          </div>
          {#snippet end()}
            <FluentButton data-fluent-owner="lib-components-change-password-dialog"
              type="button"
              onclick={handleDice}
              disabled={busy}
              title={$t('dialog.changePassword.generateStrongPassword')}
              aria-label={$t('dialog.changePassword.generateStrongPassword')}
              appearance="subtle"
              class="text-md3-on-surface-variant hover:text-md3-primary-emphasis\r\n                     transition-colors rounded p-1"
              iconOnly
            >
              <Icon name="ifl" size="18px" />
            </FluentButton>
            <FluentButton data-fluent-owner="lib-components-change-password-dialog"
              type="button"
              onclick={() => (newVisible = !newVisible)}
              aria-label={newVisible ? $t('login.hidePassword') : $t('login.showPassword')}
              appearance="subtle"
              class="text-md3-on-surface-variant hover:text-md3-on-surface\r\n                     transition-colors rounded p-1"
              iconOnly
            >
              <Icon name="visibility" size="18px" />
            </FluentButton>
          {/snippet}
        </MdOutlinedField>

        <!-- Strength meter -->
        {#if newPassword}
          <div class="mt-2 flex items-center gap-2">
            <div class="flex-1 h-1.5 rounded-full bg-md3-surface-container-high overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                style="width: {(strength.score / 5) * 100}%;
                       background: {strength.score <= 1
                         ? 'var(--colorStatusDangerForeground1)'
                         : strength.score <= 3
                         ? 'var(--colorStatusWarningForeground1)'
                         : 'var(--colorStatusSuccessForeground1)'};"
              ></div>
            </div>
            <span class="text-xs text-md3-on-surface-variant w-16 text-right">{strength.label}</span>
          </div>
        {/if}
      </div>

      {#if tip || $t('dialog.changePassword.defaultTip')}
        <p class="text-xs text-md3-on-surface-variant flex items-start gap-1.5">
          <span class="cfms-icon-text__icon shrink-0 text-md3-tertiary"><Icon name="info" size="14px" /></span>
          <span>{tip || $t('dialog.changePassword.defaultTip')}</span>
        </p>
      {/if}

      {#if error}
        <div
          class="bg-md3-error-container/60 border border-md3-error/30
                 text-md3-on-error-container text-sm rounded-xl p-3 flex items-start gap-2"
        >
          <span class="cfms-icon-text__icon shrink-0"><Icon name="errorFilled" size="16px" /></span>
          <span>{error}</span>
        </div>
      {/if}

      <!-- Actions -->
      <div class="flex items-center justify-end gap-3 pt-2 pb-4">
        <DialogActionButton onclick={handleCancel} disabled={busy}>
          {$t('common.cancel')}
        </DialogActionButton>
        <DialogActionButton
          type="submit"
          variant="primary"
          disabled={busy || !newPassword}
        >
          {#if busy}
            <ProgressRing size={16} strokeWidth={2.4} label={$t('common.changing')} />
            {$t('common.changing')}
          {:else}
            <Icon name="done" size="16px" />
            {$t('dialog.changePassword.title')}
          {/if}
        </DialogActionButton>
      </div>
    </form>
</ModalFrame>
