<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';

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
        class="grid h-16 w-16 place-items-center rounded-2xl bg-md3-warning-container text-md3-warning"
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
      <div class="space-y-3 rounded-lg border border-md3-outline/70 bg-md3-surface-container/70 p-4">
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
            <label
              class="block text-sm font-medium text-md3-on-surface"
              for="preference-recovery-password"
            >
              {$t('dialog.corruptedPreference.recoveryPassword')}
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
                <Icon name="password" size="18px" />
              </span>
              <input
                id="preference-recovery-password"
                class="w-full rounded-xl border border-md3-outline bg-md3-field py-2.5 pl-10 pr-10 text-sm text-md3-on-surface transition-colors placeholder:text-md3-on-surface-variant focus:border-transparent focus:ring-2 focus:ring-md3-primary"
                type={recoveryVisible ? 'text' : 'password'}
                bind:value={recoveryPassword}
                autocomplete="current-password"
                placeholder={$t('dialog.corruptedPreference.recoveryPlaceholder')}
                disabled={recoveryBusy}
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant transition-colors hover:text-md3-on-surface"
                onclick={() => (recoveryVisible = !recoveryVisible)}
                tabindex="-1"
                aria-label={recoveryVisible ? $t('login.hidePassword') : $t('login.showPassword')}
                disabled={recoveryBusy}
              >
                <Icon name="visibility" size="18px" />
              </button>
            </div>
            {#if recoveryError}
              <p class="text-xs leading-5 text-md3-error">{recoveryError}</p>
            {/if}
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-full px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high"
                onclick={() => {
                  showRecovery = false;
                  recoveryError = null;
                  recoveryPassword = '';
                }}
                disabled={recoveryBusy}
              >
                {$t('common.cancel')}
              </button>
              <button
                type="submit"
                class="flex items-center gap-2 rounded-full bg-md3-tertiary px-4 py-2 text-sm font-medium text-md3-on-tertiary transition-all hover:brightness-110 disabled:opacity-60"
                disabled={recoveryBusy}
              >
                <Icon name="lockOpen" size="16px" />
                {recoveryBusy
                  ? $t('dialog.corruptedPreference.recovering')
                  : $t('dialog.corruptedPreference.recoverSubmit')}
              </button>
            </div>
          </form>
        {:else}
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-md3-on-surface transition-colors hover:text-md3-primary-emphasis"
            onclick={() => (showRecovery = true)}
          >
            <span class="flex min-w-0 items-center gap-2">
              <Icon name="lockOpen" size="18px" />
              <span>{$t('dialog.corruptedPreference.recover')}</span>
            </span>
            <Icon name="breadcrumbSep" size="18px" />
          </button>
        {/if}
      </div>
    {/if}

    <p class="text-center text-sm leading-6 text-md3-on-surface-variant">
      {$t('dialog.corruptedPreference.hint')}
    </p>

    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="rounded-full px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high"
        onclick={onCancel}
        disabled={recoveryBusy}
      >
        {$t('dialog.corruptedPreference.cancel')}
      </button>
      <button
        type="button"
        class="flex items-center gap-2 rounded-full bg-md3-primary px-4 py-2 text-sm font-medium text-md3-on-primary transition-all hover:brightness-110"
        onclick={onDelete}
        disabled={recoveryBusy}
      >
        <Icon name="delete" size="16px" />
        {$t('dialog.corruptedPreference.delete')}
      </button>
    </div>
  </div>
</ModalFrame>
