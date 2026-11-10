<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';

  let {
    onDelete,
    onCancel,
    recoveryAvailable = false,
    onRecover,
    onRecovered,
  }: {
    onDelete: () => void;
    onCancel: () => void;
    recoveryAvailable?: boolean;
    onRecover?: (password: string) => Promise<void>;
    onRecovered?: () => void;
  } = $props();

  let showRecovery = $state(false);
  let recoveryPassword = $state('');
  let recoveryVisible = $state(false);
  let recoveryBusy = $state(false);
  let recoveryError = $state<string | null>(null);

  onDestroy(() => {
    recoveryPassword = '';
  });

  async function submitRecovery() {
    if (!onRecover || !onRecovered || recoveryBusy) return;
    recoveryError = null;
    if (!recoveryPassword) {
      recoveryError = $t('dialog.corruptedPreference.recoveryRequired');
      return;
    }

    recoveryBusy = true;
    try {
      await onRecover(recoveryPassword);
      recoveryPassword = '';
      onRecovered();
    } catch (error) {
      recoveryError = error instanceof Error ? error.message : String(error);
    } finally {
      recoveryBusy = false;
    }
  }
</script>

<ModalFrame
  title={$t('dialog.corruptedPreference.title')}
  maxWidth="max-w-md"
  closeLabel={$t('common.close')}
  onClose={onCancel}
>
  <div class="space-y-5 p-5">
    <div class="flex flex-col items-center gap-3 text-center">
      <div
        class="grid h-16 w-16 place-items-center rounded-xl bg-md3-warning-container text-md3-warning"
        aria-hidden="true"
      >
        <Icon name="warningAmber" size="40px" />
      </div>
      <p class="text-sm leading-6 text-md3-on-surface">
        {$t(
          recoveryAvailable
            ? 'dialog.corruptedPreference.bodyWithDek'
            : 'dialog.corruptedPreference.bodyWithoutDek'
        )}
      </p>
    </div>

    {#if recoveryAvailable}
      <div class="space-y-3 rounded-lg border border-md3-outline/70 bg-md3-surface-container p-4">
        <p class="text-sm leading-6 text-md3-on-surface-variant">
          {$t('dialog.corruptedPreference.recoveryHint')}
        </p>
        {#if showRecovery}
          <form
            class="space-y-3"
            onsubmit={(event) => {
              event.preventDefault();
              submitRecovery();
            }}
          >
            <MdOutlinedField inputId="preference-recovery-password" label={$t('dialog.corruptedPreference.recoveryPassword')} disabled={recoveryBusy}>
              <div data-outlined-content class="relative">
                <span data-field-leading-icon class="absolute flex left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
                  <Icon name="password" size="18px" />
                </span>
                <input data-focus-ring="delegated"
                  id="preference-recovery-password"
                  class="w-full pl-10 text-sm text-md3-on-surface transition-colors placeholder:text-md3-on-surface-variant"
                  type={recoveryVisible ? 'text' : 'password'}
                  bind:value={recoveryPassword}
                  autocomplete="current-password"
                  placeholder={$t('dialog.corruptedPreference.recoveryPlaceholder')}
                  disabled={recoveryBusy}
                />
              </div>
              {#snippet end()}
                <FluentButton data-fluent-owner="lib-components-corrupted-preference-dialog"
                  type="button"
                  onclick={() => (recoveryVisible = !recoveryVisible)}
                  aria-label={recoveryVisible ? $t('login.hidePassword') : $t('login.showPassword')}
                  disabled={recoveryBusy}
                  appearance="subtle"
                  class="text-md3-on-surface-variant transition-colors hover:text-md3-on-surface"
                  iconOnly
                >
                  <Icon name="visibility" size="18px" />
                </FluentButton>
              {/snippet}
            </MdOutlinedField>
            {#if recoveryError}
              <p class="text-xs leading-5 text-md3-error">{recoveryError}</p>
            {/if}
            <div class="flex justify-end gap-2">
              <DialogActionButton
                onclick={() => {
                  showRecovery = false;
                  recoveryError = null;
                  recoveryPassword = '';
                }}
                disabled={recoveryBusy}
              >
                {$t('common.cancel')}
              </DialogActionButton>
              <DialogActionButton
                type="submit"
                variant="tonal"
                disabled={recoveryBusy}
              >
                <Icon name="lockOpen" size="16px" />
                {recoveryBusy
                  ? $t('dialog.corruptedPreference.recovering')
                  : $t('dialog.corruptedPreference.recoverSubmit')}
              </DialogActionButton>
            </div>
          </form>
        {:else}
          <FluentButton data-fluent-owner="lib-components-corrupted-preference-dialog"
            type="button"
            onclick={() => (showRecovery = true)}
            appearance="subtle"
            class="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-md3-on-surface transition-colors hover:text-md3-primary-emphasis"
          >
            <span class="flex min-w-0 items-center gap-2">
              <Icon name="lockOpen" size="18px" />
              <span>{$t('dialog.corruptedPreference.recover')}</span>
            </span>
            <Icon name="breadcrumbSep" size="18px" />
          </FluentButton>
        {/if}
      </div>
    {/if}

    <p class="text-center text-sm leading-6 text-md3-on-surface-variant">
      {$t('dialog.corruptedPreference.hint')}
    </p>

    <div class="flex justify-end gap-2">
      <DialogActionButton onclick={onCancel} disabled={recoveryBusy}>
        {$t('dialog.corruptedPreference.cancel')}
      </DialogActionButton>
      <DialogActionButton
        variant="primary"
        onclick={onDelete}
        disabled={recoveryBusy}
      >
        <Icon name="delete" size="16px" />
        {$t('dialog.corruptedPreference.delete')}
      </DialogActionButton>
    </div>
  </div>
</ModalFrame>
