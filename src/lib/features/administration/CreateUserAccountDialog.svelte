<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { onDestroy } from 'svelte';
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

  let {
    onSave,
    onClose,
  }: {
    onSave: (username: string, password: string, nickname: string) => Promise<void>;
    onClose: () => void;
  } = $props();

  let username = $state('');
  let nickname = $state('');
  let password = $state('');
  let passwordVisible = $state(false);

  onDestroy(() => {
    password = '';
  });
  let busy = $state(false);
  let error = $state<string | null>(null);
  let usernameInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    void tick().then(() => usernameInput?.focus());
  });

  function randInt(max: number): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }

  function generateRandomPassword(): string {
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#$%^&*()-_=+[]{}';
    const all = lower + upper + digits + symbols;
    const pick = (set: string) => set[randInt(set.length)];
    const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];

    for (let i = chars.length; i < 16; i++) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }

  function generate() {
    password = generateRandomPassword();
    passwordVisible = true;
    error = null;
  }

  async function submit() {
    const cleanUsername = username.trim();
    const cleanNickname = nickname.trim();

    if (!cleanUsername) {
      error = $t('manage.usernameRequired');
      return;
    }

    if (!password) {
      error = $t('manage.passwordRequired');
      return;
    }

    busy = true;
    error = null;
    try {
      await onSave(cleanUsername, password, cleanNickname);
    } catch (err) {
      error = formatUserFacingError(err);
    } finally {
      busy = false;
    }
  }
  const outlinedId = $props.id();
</script>

<ModalFrame
  title={$t('manage.createAccountTitle')}
  maxWidth="max-w-lg"
  closeLabel={$t('common.close')}
  onClose={() => {
    if (!busy) onClose();
  }}
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
        <Icon name="groupAdd" size="20px" />
      </span>
      <p class="text-sm text-md3-on-surface-variant">{$t('manage.createAccountDescription')}</p>
    </div>

    <div class="block">
      <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('manage.username')} disabled={busy}>
        <div data-outlined-content class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="accountCircle" size="18px" />
          </span>
          <input id={`${outlinedId}-1`} data-focus-ring="delegated"
            bind:this={usernameInput}
            bind:value={username}
            class="cfms-native-field w-full pl-10 pr-3 text-sm text-md3-on-surface transition"
            autocomplete="username"
            disabled={busy}
          />
        </div>
      </MdOutlinedField>
    </div>

    <div class="block">
      <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('manage.nickname')} disabled={busy}>
        <div data-outlined-content class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="edit" size="18px" />
          </span>
          <input id={`${outlinedId}-2`} data-focus-ring="delegated"
            bind:value={nickname}
            class="cfms-native-field w-full pl-10 pr-3 text-sm text-md3-on-surface transition"
            autocomplete="off"
            disabled={busy}
            placeholder={username || $t('manage.nickname')}
          />
        </div>
      </MdOutlinedField>
    </div>

    <div class="block">
      <MdOutlinedField inputId={`${outlinedId}-3`} label={$t('dialog.changePassword.newPassword')} disabled={busy}>
        <div data-outlined-content class="relative">
          <span data-field-leading-icon class="absolute flex left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="password" size="18px" />
          </span>
          <input id={`${outlinedId}-3`} data-focus-ring="delegated"
            bind:value={password}
            type={passwordVisible ? 'text' : 'password'}
            class="w-full pl-10 text-sm text-md3-on-surface transition"
            autocomplete="new-password"
            disabled={busy}
          />
        </div>
        {#snippet end()}
          <FluentButton data-fluent-owner="lib-components-create-user-account-dialog"
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
          <FluentButton data-fluent-owner="lib-components-create-user-account-dialog"
            type="button"
            aria-label={passwordVisible ? $t('login.hidePassword') : $t('login.showPassword')}
            disabled={busy}
            onclick={() => (passwordVisible = !passwordVisible)}
            appearance="subtle"
            class="rounded p-1 text-md3-on-surface-variant transition-colors hover:text-md3-on-surface disabled:opacity-45"
            iconOnly
          >
            <Icon name="visibility" size="18px" />
          </FluentButton>
        {/snippet}
      </MdOutlinedField>
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
        disabled={busy || !username.trim() || !password}
      >
        {#if busy}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.saving')} />
          {$t('common.saving')}
        {:else}
          <Icon name="done" size="16px" />
          {$t('common.add')}
        {/if}
      </DialogActionButton>
    </div>
  </form>
</ModalFrame>
