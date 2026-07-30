<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    cancelTwoFactorSetup,
    changePassword,
    clearAuthSession,
    disableTwoFactor,
    getAuthStatus,
    getTwoFactorStatus,
    renameUser,
    serverErrorMessage,
    setupTwoFactor,
    validateTwoFactor,
    type TwoFactorSetup,
    type TwoFactorStatus,
  } from '$lib/api';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ChangePasswordDialog from '$lib/components/ChangePasswordDialog.svelte';
  import AvatarPreview from '$lib/components/AvatarPreview.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  const NICKNAME_MAX_LENGTH = 255;

  let showPasswordDialog = $state(false);
  let editingNickname = $state(false);
  let nicknameInput = $state('');
  let nicknameInputElement = $state<HTMLInputElement | null>(null);
  let nicknameBusy = $state(false);
  let authReady = $state(false);
  let twofa = $state<TwoFactorStatus | null>(null);
  let setup = $state<TwoFactorSetup | null>(null);
  let qrCodeDataUrl = $state<string | null>(null);
  let verifiedBackupCodes = $state<string[]>([]);
  let verificationCode = $state('');
  let disablePassword = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const enabled = $derived(Boolean(twofa?.enabled));
  const statusLabel = $derived(enabled ? $t('common.enabled') : $t('common.disabled'));
  const cleanNickname = $derived(nicknameInput.trim() || null);
  const nicknameCharacterCount = $derived(Array.from(nicknameInput.trim()).length);
  const nicknameTooLong = $derived(nicknameCharacterCount > NICKNAME_MAX_LENGTH);
  const nicknameChanged = $derived.by(() => {
    const username = authStore.username;
    if (!username) return false;
    return (cleanNickname ?? username) !== (authStore.displayName ?? username);
  });
  const canSaveNickname = $derived(
    authStore.isLoggedIn
      && Boolean(authStore.username)
      && nicknameChanged
      && !nicknameTooLong
      && !nicknameBusy,
  );
  const canChangePassword = $derived(
    authStore.isLoggedIn
      && Boolean(authStore.username)
      && authStore.permissions.includes('set_passwd'),
  );
  const canVerify = $derived(Boolean(setup && verificationCode.trim().length > 0));
  const canDisable = $derived(enabled && disablePassword.trim().length > 0);

  $effect(() => {
    if (!status) return;
    notificationStore.success(status, 5000);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  $effect(() => {
    const provisioningUri = setup?.provisioning_uri;
    qrCodeDataUrl = null;
    if (!provisioningUri) return;

    let canceled = false;
    void (async () => {
      try {
        const { toDataURL } = await import('qrcode');
        const dataUrl = await toDataURL(provisioningUri, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 192,
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        });
        if (!canceled) qrCodeDataUrl = dataUrl;
      } catch (err) {
        if (!canceled) error = formatError(err);
      }
    })();

    return () => {
      canceled = true;
    };
  });

  onMount(async () => {
    await refreshTwoFactorStatus();
  });

  async function handleChangePassword(oldPassword: string, newPassword: string): Promise<void> {
    const username = authStore.username;
    if (!authStore.isLoggedIn || !username) {
      throw new Error($t('settings.password.signInRequired'));
    }

    await changePassword(username, oldPassword, newPassword);
    showPasswordDialog = false;
    await clearAuthSession();
    authStore.clear();
    notificationStore.success($t('more.passwordChanged'));
    await goto('/login', { replaceState: true });
  }

  async function beginNicknameEdit() {
    if (!authStore.isLoggedIn || !authStore.username || nicknameBusy) return;
    nicknameInput = authStore.displayName ?? authStore.username;
    editingNickname = true;
    await tick();
    nicknameInputElement?.focus();
    nicknameInputElement?.select();
  }

  function cancelNicknameEdit() {
    if (nicknameBusy) return;
    nicknameInput = '';
    editingNickname = false;
  }

  function handleNicknameKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancelNicknameEdit();
  }

  async function saveNickname() {
    const username = authStore.username;
    if (!canSaveNickname || !username) return;

    nicknameBusy = true;
    try {
      const success = await renameUser(username, cleanNickname);
      if (!success) throw new Error($t('settings.account.nicknameUpdateFailed'));

      if (authStore.isLoggedIn && authStore.username === username) {
        authStore.nickname = cleanNickname ?? username;
      }
      nicknameInput = '';
      editingNickname = false;
      status = $t('settings.account.nicknameUpdated');
    } catch (err) {
      error = formatError(err);
    } finally {
      nicknameBusy = false;
    }
  }

  async function refreshTwoFactorStatus(options?: { preserveVerifiedBackupCodes?: boolean }) {
    loading = true;
    error = null;
    if (!options?.preserveVerifiedBackupCodes) verifiedBackupCodes = [];
    try {
      const auth = await getAuthStatus();
      authReady = auth.has_token;
      if (auth.has_token) {
        twofa = await getTwoFactorStatus();
      } else {
        twofa = { enabled: false, method: null, backup_codes_count: 0 };
      }
    } catch (err) {
      error = formatError(err);
    } finally {
      loading = false;
    }
  }

  async function startSetup() {
    busy = true;
    error = null;
    try {
      setup = await setupTwoFactor();
      verifiedBackupCodes = [];
      verificationCode = '';
      status = $t('settings.twofa.setupStarted');
    } catch (err) {
      error = formatError(err);
    } finally {
      busy = false;
    }
  }

  async function verifySetup() {
    if (!canVerify) return;
    busy = true;
    error = null;
    try {
      const backupCodes = setup?.backup_codes ?? [];
      await validateTwoFactor(verificationCode.trim());
      verifiedBackupCodes = backupCodes;
      setup = null;
      verificationCode = '';
      status = $t('settings.twofa.enabledStatus');
      await refreshTwoFactorStatus({ preserveVerifiedBackupCodes: true });
    } catch (err) {
      error = formatError(err);
    } finally {
      busy = false;
    }
  }

  async function cancelSetup() {
    busy = true;
    error = null;
    try {
      await cancelTwoFactorSetup();
      setup = null;
      verifiedBackupCodes = [];
      verificationCode = '';
      status = $t('settings.twofa.setupCanceled');
    } catch (err) {
      error = formatError(err);
    } finally {
      busy = false;
    }
  }

  async function disableCurrentTwoFactor() {
    if (!canDisable) return;
    busy = true;
    error = null;
    try {
      await disableTwoFactor(disablePassword);
      verifiedBackupCodes = [];
      disablePassword = '';
      status = $t('settings.twofa.disabledStatus');
      await refreshTwoFactorStatus();
    } catch (err) {
      error = formatError(err);
    } finally {
      busy = false;
    }
  }

  function formatError(err: unknown): string {
    return serverErrorMessage(err);
  }
</script>

<div class="workspace-page account-settings-page">
  <SettingsPageHeader
    title={$t('settings.account.title')}
    description={$t('settings.account.description')}
    icon="accountCircle"
  />

  <section
    class="identity-panel"
    aria-label={$t('settings.account.nicknameLabel')}
  >
    <div class="identity-summary">
      <div class="identity-avatar">
        <AvatarPreview
          username={authStore.username ?? $t('common.unknownUser')}
          size={68}
          avatarPath={authStore.avatarPath}
        />
      </div>

      <div class="identity-copy">
        <h2>{authStore.displayName ?? authStore.username ?? $t('common.unknown')}</h2>
        {#if authStore.username && authStore.displayName !== authStore.username}
          <p class="identity-username">@{authStore.username}</p>
        {/if}
        {#if authStore.groups.length > 0}
          <p class="identity-groups">
            <Icon name="groups" size="15px" />
            <span>{authStore.groups.join(', ')}</span>
          </p>
        {/if}
      </div>

      {#if !editingNickname}
        <button
          type="button"
          class="action-button action-button--secondary identity-edit-button"
          title={$t('settings.account.editNickname')}
          aria-label={$t('settings.account.editNickname')}
          disabled={!authStore.isLoggedIn || !authStore.username}
          onclick={() => void beginNicknameEdit()}
        >
          <Icon name="edit" size="18px" />
          <span>{$t('settings.account.editNickname')}</span>
        </button>
      {/if}
    </div>

    {#if editingNickname}
      <form
        class="nickname-editor"
        aria-label={$t('settings.account.editNickname')}
        onsubmit={(event) => {
          event.preventDefault();
          void saveNickname();
        }}
      >
        <label
          for="account-nickname-input"
          class="nickname-editor__label"
        >
          {$t('settings.account.nicknameLabel')}
        </label>

        <div class="nickname-editor__field">
          <div class="field-with-count">
            <input
              id="account-nickname-input"
              bind:this={nicknameInputElement}
              bind:value={nicknameInput}
              class="text-field text-field--counted"
              class:text-field--error={nicknameTooLong}
              type="text"
              name="nickname"
              autocomplete="off"
              aria-describedby="nickname-help nickname-count"
              aria-invalid={nicknameTooLong}
              disabled={nicknameBusy}
              onkeydown={handleNicknameKeydown}
            />
            <span
              id="nickname-count"
              class="field-count"
              class:field-count--error={nicknameTooLong}
            >
              {nicknameCharacterCount}/{NICKNAME_MAX_LENGTH}
            </span>
          </div>
          <span
            id="nickname-help"
            class="field-help"
            class:field-help--error={nicknameTooLong}
          >
            {$t(nicknameTooLong
              ? 'settings.account.nicknameTooLong'
              : 'settings.account.nicknameHint', {
                values: { max: NICKNAME_MAX_LENGTH },
              })}
          </span>
        </div>

        <div class="nickname-editor__actions">
          <button
            type="button"
            class="action-button action-button--secondary"
            title={$t('common.cancel')}
            aria-label={$t('common.cancel')}
            disabled={nicknameBusy}
            onclick={cancelNicknameEdit}
          >
            <Icon name="close" size="18px" />
            <span>{$t('common.cancel')}</span>
          </button>
          <button
            type="submit"
            class="action-button action-button--primary"
            title={$t(nicknameBusy ? 'common.saving' : 'common.save')}
            aria-label={$t(nicknameBusy ? 'common.saving' : 'common.save')}
            disabled={!canSaveNickname}
          >
            {#if nicknameBusy}
              <ProgressRing size={17} strokeWidth={2.2} label={$t('common.saving')} tone="inherit" />
            {:else}
              <Icon name="check" size="18px" />
            {/if}
            <span>{$t(nicknameBusy ? 'common.saving' : 'common.save')}</span>
          </button>
        </div>
      </form>
    {/if}
  </section>

  <section
    class="security-panel"
    aria-label={$t('settings.account.description')}
  >
    <div class="security-row password-row">
      <span class="security-icon" aria-hidden="true">
        <Icon name="password" size="21px" />
      </span>
      <div class="security-copy">
        <h2>{$t('settings.password.accountTitle')}</h2>
        <p>{$t('settings.password.accountHint')}</p>
        <p class="security-note">{$t('settings.password.sessionHint')}</p>
      </div>
      <button
        type="button"
        class="action-button action-button--tonal security-action"
        disabled={!canChangePassword}
        onclick={() => (showPasswordDialog = true)}
      >
        <Icon name="password" size="18px" />
        {$t('settings.password.action')}
      </button>
    </div>

    <div class="security-divider"></div>

    <div class="twofa-section">
      <div class="security-row twofa-heading">
        <span class="security-icon" aria-hidden="true">
          <Icon name="verifiedUser" size="21px" />
        </span>
        <div class="security-copy">
          <h2 id="account-twofa-title">
          {$t('settings.twofa.title')}
          </h2>
          <p>{$t('settings.twofa.description')}</p>
        </div>
        <span
          class="status-chip"
          class:status-chip--active={enabled && !loading}
          class:status-chip--pending={loading}
          aria-live="polite"
        >
          <span class="status-chip__dot" aria-hidden="true"></span>
          {loading ? $t('common.checking') : statusLabel}
        </span>
      </div>

      <div class="twofa-content">
        {#if twofa?.method}
          <dl class="twofa-metadata">
            <div>
              <dt>{$t('settings.twofa.method')}</dt>
              <dd class="uppercase">{twofa.method}</dd>
            </div>
            <div>
              <dt>{$t('settings.twofa.backupCodesCount')}</dt>
              <dd>{twofa.backup_codes_count}</dd>
            </div>
          </dl>
        {/if}

        {#if setup}
          <div class="setup-panel">
            <div class="qr-frame">
              {#if qrCodeDataUrl}
                <img
                  src={qrCodeDataUrl}
                  alt={$t('settings.twofa.provisioningUri')}
                />
              {:else}
                <Icon name="qrCode" size="48px" />
              {/if}
            </div>
            <dl class="setup-details">
              <div>
                <dt>{$t('settings.twofa.secret')}</dt>
                <dd><code>{setup.secret}</code></dd>
              </div>
              <div>
                <dt>{$t('settings.twofa.provisioningUri')}</dt>
                <dd><code>{setup.provisioning_uri}</code></dd>
              </div>
            </dl>
          </div>

          <label class="twofa-field">
            <span>{$t('settings.twofa.verificationCode')}</span>
            <input
              class="text-field"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              bind:value={verificationCode}
              disabled={busy}
            />
          </label>
        {:else if enabled}
          <label class="twofa-field">
            <span>{$t('settings.twofa.currentPassword')}</span>
            <input
              class="text-field"
              type="password"
              autocomplete="current-password"
              bind:value={disablePassword}
              disabled={busy}
            />
          </label>
        {/if}

        {#if verifiedBackupCodes.length > 0}
          <div class="backup-codes">
            <p>{$t('settings.twofa.backupCodes')}</p>
            <div>
              {#each verifiedBackupCodes as code}
                <code>{code}</code>
              {/each}
            </div>
          </div>
        {/if}

        <div class="twofa-actions">
          {#if setup}
            <button
              class="action-button action-button--primary"
              type="button"
              onclick={verifySetup}
              disabled={busy || !canVerify}
            >
              <Icon name="verified" size="18px" />
              {$t('settings.twofa.verifyEnable')}
            </button>
            <button
              class="action-button action-button--secondary"
              type="button"
              onclick={cancelSetup}
              disabled={busy}
            >
              {$t('settings.twofa.cancelSetup')}
            </button>
          {:else if enabled}
            <button
              class="action-button action-button--danger"
              type="button"
              onclick={disableCurrentTwoFactor}
              disabled={busy || !canDisable}
            >
              <Icon name="lockOpen" size="18px" />
              {$t('settings.twofa.disable')}
            </button>
          {:else}
            <button
              class="action-button action-button--tonal"
              type="button"
              onclick={startSetup}
              disabled={loading || busy || !authReady}
            >
              <Icon name="security" size="18px" />
              {$t('settings.twofa.enable')}
            </button>
          {/if}
          <button
            class="action-button action-button--secondary"
            type="button"
            onclick={() => refreshTwoFactorStatus()}
            disabled={loading || busy}
          >
            <Icon name="refresh" size="18px" />
            {$t('common.refresh')}
          </button>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .account-settings-page {
    display: grid;
    width: min(100%, 48rem);
    gap: 1rem;
    margin-inline: auto;
    padding: 1.25rem;
  }

  .identity-panel,
  .security-panel {
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-large, 12px);
    background: var(--color-md3-surface-container);
  }

  .identity-summary {
    display: grid;
    min-width: 0;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    padding: 1.15rem 1.25rem;
  }

  .identity-avatar {
    display: grid;
    padding: 3px;
    border: 1px solid color-mix(in srgb, var(--color-md3-primary) 34%, var(--color-md3-outline));
    border-radius: 9999px;
    background: var(--color-md3-surface-container-high);
  }

  .identity-copy {
    min-width: 0;
  }

  .identity-copy h2,
  .identity-copy p,
  .security-copy h2,
  .security-copy p,
  .backup-codes p {
    margin: 0;
  }

  .identity-copy h2 {
    overflow: hidden;
    color: var(--color-md3-on-surface);
    font: 700 1.08rem/1.28 var(--font-md3-sans);
    letter-spacing: -0.012em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity-username,
  .identity-groups {
    overflow: hidden;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.74rem;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity-username {
    margin-top: 0.2rem !important;
  }

  .identity-groups {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.35rem !important;
  }

  .identity-groups span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nickname-editor {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.85rem;
    border-top: 1px solid var(--color-md3-outline);
    padding: 1rem 1.25rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 54%, transparent);
  }

  .nickname-editor__label {
    min-height: 42px;
    display: flex;
    align-items: center;
    color: var(--color-md3-on-surface);
    font: 650 0.8rem/1.3 var(--font-md3-sans);
  }

  .nickname-editor__field {
    min-width: 0;
  }

  .field-with-count {
    position: relative;
  }

  .text-field {
    width: 100%;
    min-height: 42px;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0.58rem 0.75rem;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
    font: 400 0.84rem/1.35 var(--font-md3-sans);
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      box-shadow var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .text-field--counted {
    padding-inline-end: 4.5rem;
  }

  .text-field--error {
    border-color: var(--color-md3-error);
  }

  .text-field:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }

  .field-count {
    position: absolute;
    top: 50%;
    right: 0.75rem;
    color: var(--color-md3-on-surface-variant);
    font: 0.68rem/1 var(--font-md3-mono);
    font-variant-numeric: tabular-nums;
    transform: translateY(-50%);
  }

  .field-count--error,
  .field-help--error {
    color: var(--color-md3-error);
  }

  .field-help {
    display: block;
    margin-top: 0.35rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.68rem;
    line-height: 1.45;
  }

  .nickname-editor__actions,
  .twofa-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .nickname-editor__actions {
    min-height: 42px;
    align-items: center;
  }

  .action-button {
    display: inline-flex;
    min-height: 34px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.42rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 5px);
    padding: 0.42rem 0.72rem;
    font: 650 0.76rem/1 var(--font-md3-sans);
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .action-button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .action-button:active:not(:disabled) {
    transform: scale(0.97);
  }

  .action-button:disabled {
    cursor: not-allowed;
    opacity: 0.44;
  }

  .action-button--primary {
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .action-button--primary:hover:not(:disabled) {
    background: var(--color-md3-primary-emphasis);
  }

  .action-button--tonal {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .action-button--tonal:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-md3-primary) 38%, var(--color-md3-outline));
  }

  .action-button--secondary {
    border-color: var(--color-md3-outline);
    color: var(--color-md3-on-surface);
    background: transparent;
  }

  .action-button--secondary:hover:not(:disabled) {
    background: var(--color-md3-surface-container-high);
  }

  .action-button--danger {
    border-color: color-mix(in srgb, var(--color-md3-error) 34%, var(--color-md3-outline));
    color: var(--color-md3-error);
    background: color-mix(in srgb, var(--color-md3-error-container) 70%, transparent);
  }

  .action-button--danger:hover:not(:disabled) {
    border-color: var(--color-md3-error);
    background: var(--color-md3-error-container);
  }

  .security-row {
    display: grid;
    min-width: 0;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.85rem;
  }

  .password-row {
    align-items: center;
    padding: 1.15rem 1.25rem;
  }

  .security-icon {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: var(--explorer-radius-small, 5px);
    color: var(--color-md3-primary-emphasis);
    background: var(--color-md3-primary-container);
  }

  .security-copy {
    min-width: 0;
  }

  .security-copy h2 {
    color: var(--color-md3-on-surface);
    font: 650 0.86rem/1.3 var(--font-md3-sans);
    letter-spacing: -0.006em;
  }

  .security-copy p {
    max-width: 68ch;
    margin-top: 0.24rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
    line-height: 1.5;
  }

  .security-copy .security-note {
    margin-top: 0.48rem;
    color: color-mix(in srgb, var(--color-md3-on-surface-variant) 88%, transparent);
    font-size: 0.68rem;
  }

  .security-action {
    align-self: center;
  }

  .security-divider {
    height: 1px;
    margin-inline: 1.25rem;
    background: var(--color-md3-outline);
  }

  .twofa-section {
    padding: 1.15rem 1.25rem 1.25rem;
  }

  .twofa-heading {
    grid-template-columns: 38px minmax(0, 1fr) auto;
  }

  .status-chip {
    display: inline-flex;
    min-height: 26px;
    align-items: center;
    gap: 0.42rem;
    border-radius: 9999px;
    padding: 0.28rem 0.62rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-high);
    font: 650 0.68rem/1 var(--font-md3-sans);
    white-space: nowrap;
  }

  .status-chip__dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: currentColor;
  }

  .status-chip--active {
    color: var(--color-md3-success);
    background: color-mix(in srgb, var(--color-md3-success) 12%, transparent);
  }

  .status-chip--pending .status-chip__dot {
    animation: status-pulse 1.4s var(--motion-easing-standard) infinite;
  }

  .twofa-content {
    margin-left: 3.3rem;
  }

  .twofa-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin: 0.9rem 0 0;
  }

  .twofa-metadata > div {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-small, 5px);
    padding: 0.38rem 0.55rem;
    background: var(--color-md3-surface-container-high);
  }

  .twofa-metadata dt {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.66rem;
  }

  .twofa-metadata dd {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 600 0.7rem/1.2 var(--font-md3-mono);
  }

  .setup-panel {
    display: grid;
    grid-template-columns: 184px minmax(0, 1fr);
    gap: 1rem;
    margin-top: 1rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0.85rem;
    background: var(--color-md3-surface-container-high);
  }

  .qr-frame {
    display: grid;
    width: 184px;
    height: 184px;
    place-items: center;
    overflow: hidden;
    border: 1px solid rgb(0 0 0 / 0.14);
    border-radius: var(--explorer-radius-small, 5px);
    padding: 0.45rem;
    color: #5d5d5d;
    background: #fff;
  }

  .qr-frame img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .setup-details {
    min-width: 0;
    margin: 0;
  }

  .setup-details > div + div {
    margin-top: 0.85rem;
  }

  .setup-details dt {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.68rem;
  }

  .setup-details dd {
    margin: 0.3rem 0 0;
  }

  .setup-details code {
    display: block;
    overflow-wrap: anywhere;
    color: var(--color-md3-on-surface);
    font: 0.7rem/1.55 var(--font-md3-mono);
  }

  .twofa-field {
    display: grid;
    max-width: 28rem;
    gap: 0.38rem;
    margin-top: 1rem;
    color: var(--color-md3-on-surface);
    font: 650 0.76rem/1.3 var(--font-md3-sans);
  }

  .backup-codes {
    margin-top: 1rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0.85rem;
    background: var(--color-md3-surface-container-high);
  }

  .backup-codes p {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.7rem;
  }

  .backup-codes > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem 1rem;
    margin-top: 0.55rem;
  }

  .backup-codes code {
    color: var(--color-md3-on-surface);
    font: 0.74rem/1.4 var(--font-md3-mono);
  }

  .twofa-actions {
    margin-top: 1rem;
  }

  @keyframes status-pulse {
    0%, 100% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }

  @media (min-width: 640px) {
    .account-settings-page {
      padding: 1.5rem;
    }
  }

  @media (max-width: 640px) {
    .identity-summary {
      grid-template-columns: auto minmax(0, 1fr);
      padding: 1rem;
    }

    .identity-edit-button {
      grid-column: 1 / -1;
      width: 100%;
    }

    .nickname-editor {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.5rem;
      padding: 1rem;
    }

    .nickname-editor__label {
      min-height: auto;
    }

    .nickname-editor__actions {
      justify-content: flex-end;
    }

    .password-row,
    .twofa-section {
      padding: 1rem;
    }

    .security-divider {
      margin-inline: 1rem;
    }

    .password-row {
      grid-template-columns: 38px minmax(0, 1fr);
    }

    .security-action {
      grid-column: 1 / -1;
      width: 100%;
    }

    .twofa-content {
      margin-left: 0;
    }

    .setup-panel {
      grid-template-columns: minmax(0, 1fr);
    }

    .qr-frame {
      width: min(100%, 184px);
      height: auto;
      aspect-ratio: 1;
    }
  }

  @media (max-width: 420px) {
    .account-settings-page {
      padding: 1rem;
    }

    .identity-summary {
      gap: 0.75rem;
    }

    .twofa-heading {
      grid-template-columns: 34px minmax(0, 1fr);
    }

    .twofa-heading .security-icon {
      width: 34px;
      height: 34px;
    }

    .status-chip {
      grid-column: 2;
      width: fit-content;
    }

    .backup-codes > div {
      grid-template-columns: minmax(0, 1fr);
    }

    .twofa-actions .action-button {
      width: 100%;
    }
  }

  @media (pointer: coarse) {
    .action-button {
      min-height: 44px;
    }
  }
</style>

{#if showPasswordDialog && canChangePassword && authStore.username}
  <ChangePasswordDialog
    username={authStore.username}
    tip={$t('more.passwordTip')}
    onSubmit={handleChangePassword}
    onCancel={() => (showPasswordDialog = false)}
  />
{/if}
