<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';

  let {
    username,
    onSave,
    onClose,
  }: {
    username: string;
    onSave: (
      password: string,
      bypassRequirements: boolean,
      forceUpdateAfterLogin: boolean,
    ) => Promise<void>;
    onClose: () => void;
  } = $props();

  let password = $state('');
  let visible = $state(false);
  let bypassRequirements = $state(false);
  let forceUpdateAfterLogin = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const strength = $derived(estimateStrength(password));

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

  function randInt(max: number): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }

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
      await onSave(password, bypassRequirements, forceUpdateAfterLogin);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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
    <div class="flex items-start gap-3 rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
      <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
        <Icon name="password" size="20px" />
      </span>
      <p class="text-sm text-md3-on-surface-variant">
        {$t('manage.resetPasswordDescription', { values: { username } })}
      </p>
    </div>

    <div>
      <label class="mb-1.5 block text-sm font-medium text-md3-on-surface" for="reset-password">
        {$t('dialog.changePassword.newPassword')}
      </label>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
          <Icon name="password" size="18px" />
        </span>
        <input
          id="reset-password"
          class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-20 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
          type={visible ? 'text' : 'password'}
          placeholder={$t('dialog.changePassword.newPasswordPlaceholder')}
          autocomplete="new-password"
          bind:value={password}
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
            aria-label={visible ? $t('login.hidePassword') : $t('login.showPassword')}
            disabled={busy}
            onclick={() => (visible = !visible)}
          >
            <Icon name="visibility" size="18px" />
          </button>
        </div>
      </div>

      {#if password}
        <div class="mt-2 flex items-center gap-2">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-md3-surface-container-high">
            <div
              class="h-full rounded-full transition-all duration-300"
              style="width: {(strength.score / 5) * 100}%; background: {strength.score <= 1 ? 'var(--md3-error, #ba1a1a)' : strength.score <= 3 ? '#f5a524' : 'var(--md3-primary, #6750a4)'};"
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
        <span>
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
        <span>
          <span class="block font-medium">{$t('manage.forcePasswordUpdate')}</span>
          <span class="text-xs text-md3-on-surface-variant">{$t('manage.forcePasswordUpdateHelp')}</span>
        </span>
      </div>
    </div>

    {#if error}
      <div class="flex items-start gap-2 rounded-lg border border-md3-error/35 bg-md3-error-container/25 p-3 text-sm text-md3-on-error-container">
        <Icon name="errorFilled" size="16px" />
        <p class="min-w-0 break-words">{error}</p>
      </div>
    {/if}

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline/60 pt-4">
      <button
        type="button"
        class="rounded-full bg-md3-surface-container-high px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onclick={onClose}
      >
        {$t('common.cancel')}
      </button>
      <button
        type="submit"
        class="inline-flex items-center gap-2 rounded-full bg-md3-primary px-4 py-2 text-sm font-medium text-md3-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || !password}
      >
        {#if busy}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
          {$t('common.saving')}
        {:else}
          <Icon name="done" size="16px" />
          {$t('manage.resetPassword')}
        {/if}
      </button>
    </div>
  </form>
</ModalFrame>
