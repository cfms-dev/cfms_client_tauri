<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

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
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
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
    <div class="flex items-start gap-3 rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
      <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
        <Icon name="groupAdd" size="20px" />
      </span>
      <p class="text-sm text-md3-on-surface-variant">{$t('manage.createAccountDescription')}</p>
    </div>

    <label class="block">
      <span class="mb-1.5 block text-sm font-medium text-md3-on-surface">{$t('manage.username')}</span>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
          <Icon name="accountCircle" size="18px" />
        </span>
        <input
          bind:this={usernameInput}
          bind:value={username}
          class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-3 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
          autocomplete="username"
          disabled={busy}
        />
      </div>
    </label>

    <label class="block">
      <span class="mb-1.5 block text-sm font-medium text-md3-on-surface">{$t('manage.nickname')}</span>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
          <Icon name="edit" size="18px" />
        </span>
        <input
          bind:value={nickname}
          class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-3 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
          autocomplete="off"
          disabled={busy}
          placeholder={username || $t('manage.nickname')}
        />
      </div>
    </label>

    <label class="block">
      <span class="mb-1.5 block text-sm font-medium text-md3-on-surface">{$t('dialog.changePassword.newPassword')}</span>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
          <Icon name="password" size="18px" />
        </span>
        <input
          bind:value={password}
          type={passwordVisible ? 'text' : 'password'}
          class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-20 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
          autocomplete="new-password"
          disabled={busy}
        />
        <div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <button
            type="button"
            class="rounded-full p-1 text-md3-on-surface-variant transition-colors hover:text-md3-primary-emphasis disabled:opacity-45"
            title={$t('dialog.changePassword.generateStrongPassword')}
            disabled={busy}
            onclick={generate}
          >
            <Icon name="ifl" size="18px" />
          </button>
          <button
            type="button"
            class="rounded-full p-1 text-md3-on-surface-variant transition-colors hover:text-md3-on-surface disabled:opacity-45"
            aria-label={passwordVisible ? $t('login.hidePassword') : $t('login.showPassword')}
            disabled={busy}
            onclick={() => (passwordVisible = !passwordVisible)}
          >
            <Icon name="visibility" size="18px" />
          </button>
        </div>
      </div>
    </label>

    {#if error}
      <div class="flex items-start gap-2 rounded-lg border border-md3-error/35 bg-md3-error-container/25 p-3 text-sm text-md3-on-error-container">
        <Icon name="errorFilled" size="16px" />
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
