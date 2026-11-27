<script lang="ts">
  import MdOutlinedField from '#lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '#lib/shared/ui/FluentButton.svelte';
  import { onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '#lib/shared/ui/DialogActionButton.svelte';
  import Icon from '#lib/shared/ui/Icon.svelte';
  import MdSwitch from '#lib/shared/ui/MdSwitch.svelte';
  import ProgressRing from '#lib/shared/ui/ProgressRing.svelte';
  import ModalFrame from '#lib/shared/ui/ModalFrame.svelte';
  import { formatUserFacingError } from '#lib/shared/errors/user-facing-errors.ts';
  import { estimatePasswordStrength, generateRandomPassword } from '#lib/shared/password.ts';

  let {
    username,
    canDisableTwoFactor = false,
    onSave,
    onClose,
  }: {
    username: string;
    canDisableTwoFactor?: boolean;
    onSave: (
      password: string,
      bypassRequirements: boolean,
      forceUpdateAfterLogin: boolean,
      disableTwoFactorAfterReset: boolean,
    ) => Promise<void>;
    onClose: () => void;
  } = $props();

  let password = $state('');
  let visible = $state(false);
  let bypassRequirements = $state(false);
  let forceUpdateAfterLogin = $state(false);
  let disableTwoFactorAfterReset = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onDestroy(() => {
    password = '';
  });

  const strength = $derived.by(() => {
    const result = estimatePasswordStrength(password);
    return { score: result.score, label: result.labelKey ? $t(result.labelKey) : '' };
  });

  function generate() {
    password = generateRandomPassword();
    visible = true;
    error = null;
  }

  async function submit() {
    if (!password) {
      error = $t('manage.passwordRequired');
      return;
    }

    busy = true;
    error = null;
    try {
      await onSave(
        password,
        bypassRequirements,
        forceUpdateAfterLogin,
        disableTwoFactorAfterReset,
      );
    } catch (err) {
      error = formatUserFacingError(err);
    } finally {
      busy = false;
    }
  }
</script>

<ModalFrame
  title={$t('manage.resetPasswordTitle', { values: { username } })}
  maxWidth="max-w-lg"
  closeLabel={$t('common.close')}
  onClose={onClose}
>
  <form
    class="space-y-5 p-5"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <div class="flex items-start gap-3 rounded-lg border border-md3-outline/60 bg-md3-surface-container-high p-3">
      <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
        <Icon name="password" size="20px" />
      </span>
      <p class="text-sm text-md3-on-surface-variant">
        {$t('manage.resetPasswordDescription', { values: { username } })}
      </p>
    </div>

    <div>
      <MdOutlinedField inputId="reset-password" label={$t('dialog.changePassword.newPassword')} disabled={busy}>
        <div data-outlined-content class="relative">
          <span data-field-leading-icon class="absolute flex left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="password" size="18px" />
          </span>
          <input data-focus-ring="delegated"
            id="reset-password"
            class="w-full pl-10 text-sm text-md3-on-surface transition"
            type={visible ? 'text' : 'password'}
            placeholder={$t('dialog.changePassword.newPasswordPlaceholder')}
            autocomplete="new-password"
            bind:value={password}
            disabled={busy}
          />
        </div>
        {#snippet end()}
          <FluentButton data-fluent-owner="lib-components-reset-user-password-dialog"
            type="button"
            title={$t('dialog.changePassword.generateStrongPassword')}
            disabled={busy}
            onclick={generate}
            appearance="subtle"
            class="rounded p-1 text-md3-on-surface-variant transition-colors hover:text-md3-primary-emphasis disabled:opacity-45"
            iconOnly
            aria-label={$t('dialog.changePassword.generateStrongPassword')}
          >
            <Icon name="ifl" size="18px" />
          </FluentButton>
          <FluentButton data-fluent-owner="lib-components-reset-user-password-dialog"
            type="button"
            aria-label={visible ? $t('login.hidePassword') : $t('login.showPassword')}
            disabled={busy}
            onclick={() => (visible = !visible)}
            appearance="subtle"
            class="rounded p-1 text-md3-on-surface-variant transition-colors hover:text-md3-on-surface disabled:opacity-45"
            iconOnly
          >
            <Icon name="visibility" size="18px" />
          </FluentButton>
        {/snippet}
      </MdOutlinedField>

      {#if password}
        <div class="mt-2 flex items-center gap-2">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-md3-surface-container-high">
            <div
              class="h-full rounded-full transition-all duration-300"
              style="width: {(strength.score / 5) * 100}%; background: {strength.score <= 1 ? 'var(--colorStatusDangerForeground1)' : strength.score <= 3 ? 'var(--colorStatusWarningForeground1)' : 'var(--colorStatusSuccessForeground1)'};"
            ></div>
          </div>
          <span class="w-16 text-right text-xs text-md3-on-surface-variant">{strength.label}</span>
        </div>
      {/if}
    </div>

    <div class="space-y-2 rounded-lg border border-md3-outline/60 p-3">
      <div class="flex items-start gap-3 text-sm text-md3-on-surface">
        <MdSwitch
          bind:checked={bypassRequirements}
          disabled={busy}
          ariaLabel={$t('manage.bypassPasswordRequirements')}
        />
        <span class="min-w-0 flex-1 break-words">
          <span class="block font-medium">{$t('manage.bypassPasswordRequirements')}</span>
          <span class="text-xs text-md3-on-surface-variant">{$t('manage.bypassPasswordRequirementsHelp')}</span>
        </span>
      </div>
      <div class="flex items-start gap-3 text-sm text-md3-on-surface">
        <MdSwitch
          bind:checked={forceUpdateAfterLogin}
          disabled={busy}
          ariaLabel={$t('manage.forcePasswordUpdate')}
        />
        <span class="min-w-0 flex-1 break-words">
          <span class="block font-medium">{$t('manage.forcePasswordUpdate')}</span>
          <span class="text-xs text-md3-on-surface-variant">{$t('manage.forcePasswordUpdateHelp')}</span>
        </span>
      </div>
      {#if canDisableTwoFactor}
        <div class="flex items-start gap-3 text-sm text-md3-on-surface">
          <MdSwitch
            bind:checked={disableTwoFactorAfterReset}
            disabled={busy}
            ariaLabel={$t('manage.disableTwoFactorWithPasswordReset')}
          />
          <span class="min-w-0 flex-1 break-words">
            <span class="block font-medium">{$t('manage.disableTwoFactorWithPasswordReset')}</span>
            <span class="text-xs text-md3-on-surface-variant">{$t('manage.disableTwoFactorWithPasswordResetHelp')}</span>
          </span>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="flex items-start gap-2 rounded-lg border border-md3-error/35 bg-md3-error-container/25 p-3 text-sm text-md3-on-error-container">
        <span class="cfms-icon-text__icon"><Icon name="errorFilled" size="16px" /></span>
        <p class="min-w-0 break-words">{error}</p>
      </div>
    {/if}

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline/60 pt-4">
      <DialogActionButton disabled={busy} onclick={onClose}>
        {$t('common.cancel')}
      </DialogActionButton>
      <DialogActionButton
        type="submit"
        variant="primary"
        disabled={busy || !password}
      >
        {#if busy}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
          {$t('common.saving')}
        {:else}
          <Icon name="done" size="16px" />
          {$t('manage.resetPassword')}
        {/if}
      </DialogActionButton>
    </div>
  </form>
</ModalFrame>
