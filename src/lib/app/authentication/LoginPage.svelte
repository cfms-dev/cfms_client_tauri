<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
  import { unlockPreferenceDek, discardLockedPreferenceData } from "$lib/api";
  import Icon from "$lib/shared/ui/Icon.svelte";
  import ProgressRing from "$lib/shared/ui/ProgressRing.svelte";
  import AvatarPreview from "$lib/features/authentication/AvatarPreview.svelte";
  import AuthServerContext from "$lib/features/authentication/AuthServerContext.svelte";
  import ConnectionSecurity from '$lib/features/connection/ConnectionSecurity.svelte';
  import AuthScene from "$lib/shared/ui/AuthScene.svelte";
  import AccountDisabledNotice from "$lib/features/authentication/AccountDisabledNotice.svelte";
  import DialogActionButton from "$lib/shared/ui/DialogActionButton.svelte";
  import FluentTextInput from "$lib/shared/ui/FluentTextInput.svelte";
  import FluentButton from "$lib/shared/ui/FluentButton.svelte";
  import MdOutlinedField from "$lib/shared/ui/MdOutlinedField.svelte";
  import ModalFrame from "$lib/shared/ui/ModalFrame.svelte";
  import CorruptedPreferenceDialog from "$lib/features/authentication/CorruptedPreferenceDialog.svelte";
  import AuthenticationDialog from "$lib/features/authentication/AuthenticationDialog.svelte";
  import ChangePasswordDialog from "$lib/features/authentication/ChangePasswordDialog.svelte";
  import { flyScale } from '$lib/shared/motion/transitions';
  import { openKeyboardShortcutHelp } from '$lib/shared/ui/keyboard';
  import PrivateKeyField from '$lib/features/authentication/PrivateKeyField.svelte';
  import SignInOptions from '$lib/features/authentication/SignInOptions.svelte';
  import PublicKeyVerification from '$lib/features/authentication/PublicKeyVerification.svelte';
  import PreferenceUnlockDialog from '$lib/features/authentication/PreferenceUnlockDialog.svelte';
  import { createLoginFlow } from './LoginPage.svelte.ts';
  const workspace = createLoginFlow();
  const { measureCredential } = workspace;
</script>

<AuthScene view="login" animate={workspace.playConnectTransition}>
  <div class="auth-route-toolbar">
    <button
      type="button"
      class="inline-flex h-9 w-9 items-center justify-center rounded-full text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
      title={$t('keyboard.openHelp')}
      aria-label={$t('keyboard.openHelp')}
      aria-keyshortcuts="Control+/ Meta+/"
      onclick={openKeyboardShortcutHelp}
    >
      <Icon name="keyboard" size="18px" />
    </button>
  </div>
  <section class="auth-panel auth-scene-panel">
  <div
    class="auth-form-stage"
    class:animate-fade-scale-in={!workspace.playConnectTransition}
    class:auth-form-stage--connect-intro={workspace.playConnectTransition}
    class:auth-form-stage--server-context={workspace.accountDisabled || !(workspace.busy && workspace.loadingPhase)}
  >
    {#if !workspace.accountDisabled && workspace.busy && workspace.loadingPhase}
      <!-- Data loading state -->
      <div
        class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                  border border-md3-outline p-10 text-center space-y-4"
      >
        <div class="flex justify-center">
          <ProgressRing size={36} strokeWidth={3.5} label={$t('common.loadingEllipsis')} />
        </div>
        <p
          class="text-sm font-medium text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {workspace.loadingPhase}
        </p>
        <p class="text-xs text-md3-on-surface-variant">
          {$t('login.setupWait')}
        </p>
      </div>
    {:else}
      <div class="login-server-status">
        <AuthServerContext label={$t('login.signInToServer', { values: { serverName: workspace.serverName } })} />
        <ConnectionSecurity />
      </div>

      <div class="auth-content-stage">
      {#if workspace.accountDisabled}
        <div class="auth-state-view" out:flyScale={{ y: -6, duration: 180 }}>
          <AccountDisabledNotice
            title={$t('login.accountDisabledTitle')}
            username={workspace.disabledAccountName}
            description={$t('login.accountDisabledContactAdmin')}
            requestTimeLabel={$t('login.accountDisabledRequestTime')}
            requestTime={workspace.accountDisabledRequestTimeText}
            backLabel={$t('common.back')}
            reason={workspace.accountDisabledReason
              ? $t('login.accountDisabledReasonProvided', { values: { reason: workspace.accountDisabledReason } })
              : $t('login.accountDisabledReasonUnavailable')}
            onBack={workspace.returnFromAccountDisabled}
          />
        </div>
      {:else}
        <!-- Login form -->
        <div
          class="login-view"
          in:flyScale={{ y: 8, duration: workspace.returningFromAccountDisabled ? 300 : 0 }}
          onintroend={workspace.finishAccountDisabledReturn}
        >
      <!-- Avatar preview -->
      <div class="flex justify-center mb-6">
        {#if workspace.username.trim()}
          <AvatarPreview username={workspace.username} size={80} avatarPath={authStore.avatarPath || workspace.cachedAvatarPath} />
        {:else}
          <div
            class="w-20 h-20 rounded-full bg-md3-surface-container-high
                      flex items-center justify-center"
          >
            <span class="text-md3-on-surface-variant">
              <Icon name="accountCircle" size="64px" />
            </span>
          </div>
        {/if}
      </div>

      <!-- Login form — MD3 card -->
      <form
        class="login-form-card backdrop-blur-sm rounded-xl
               border border-md3-outline p-6 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          workspace.handleLogin();
        }}
      >
        <!-- Username -->
        <div>
          <FluentTextInput
            id="username"
            controlSize="large"
            label={$t('login.username')}
            invalid={Boolean(workspace.fieldErrors.username)}
            validationMessage={workspace.fieldErrors.username}
            describedBy={workspace.fieldErrors.username ? 'login-username-error' : undefined}
            placeholder={$t('login.usernamePlaceholder')}
            bind:value={workspace.username}
            bind:this={workspace.usernameInput}
            disabled={workspace.busy}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (workspace.loginMethod === 'password') workspace.passwordInput?.focus();
                else document.querySelector<HTMLElement>('.key-picker')?.focus();
              }
            }}
          >
            {#snippet start()}<Icon name="accountCircle" size={20} />{/snippet}
          </FluentTextInput>
          {#if workspace.fieldErrors.username}
            <p id="login-username-error" role="alert" class="text-xs text-md3-error mt-1 ml-1">
              {workspace.fieldErrors.username}
            </p>
          {/if}
        </div>

        <div class="login-credential-region" style:height={workspace.credentialHeight ? `${workspace.credentialHeight}px` : undefined}>
        <div class="login-credential-content" use:measureCredential>
        {#if workspace.loginMethod === 'password'}
        <div>
          <MdOutlinedField
            inputId="password"
            controlSize="large"
            label={$t('login.password')}
            error={Boolean(workspace.fieldErrors.password)}
          >
            <span data-field-leading-icon class="login-text-field__leading-icon">
              <Icon name="password" size="18px" />
            </span>
            <input
              id="password"
              aria-invalid={Boolean(workspace.fieldErrors.password)}
              aria-describedby={workspace.fieldErrors.password ? 'login-password-error' : undefined}
              type={workspace.passwordVisible ? "text" : "password"}
              data-focus-ring="delegated"
              class="login-text-field__input"
              placeholder={$t('login.passwordPlaceholder')}
              bind:value={workspace.password}
              bind:this={workspace.passwordInput}
              disabled={workspace.busy}
              autocomplete="current-password"
            />
            {#snippet end()}
              <button
                type="button"
                class="login-text-field__trailing-button"
                onclick={() => (workspace.passwordVisible = !workspace.passwordVisible)}
                aria-label={workspace.passwordVisible ? $t('login.hidePassword') : $t('login.showPassword')}
              >
                <Icon
                  name={workspace.passwordVisible ? "visibility" : "visibility"}
                  size="18px"
                />
              </button>
            {/snippet}
          </MdOutlinedField>
          {#if workspace.fieldErrors.password}
            <p id="login-password-error" role="alert" class="text-xs text-md3-error mt-1 ml-1">
              {workspace.fieldErrors.password}
            </p>
          {/if}
          <div class="password-field-actions">
            <button type="button" class="forgot-password-button" onclick={() => (workspace.showForgotPasswordDialog = true)} disabled={workspace.busy}>
              {$t('login.forgotPassword')}
            </button>
          </div>
        </div>

        {:else}
          <PrivateKeyField bind:selection={workspace.privateKey} bind:passphrase={workspace.keyPassphrase} disabled={workspace.busy} invalid={Boolean(workspace.fieldErrors.password)} describedBy={workspace.fieldErrors.password ? 'login-key-error' : undefined} />
          {#if workspace.fieldErrors.password}<p id="login-key-error" role="alert" class="text-xs text-md3-error mt-2">{workspace.fieldErrors.password}</p>{/if}
        {/if}
        </div>
        </div>

        <!-- Password change required (4001/4002) — offer in-app change. -->
        {#if workspace.passwordChangeRequired}
          <div
            class="bg-md3-tertiary-container/70 border border-md3-tertiary/40
                      text-md3-on-tertiary-container text-sm rounded-xl p-4 space-y-3"
          >
            <div class="flex items-start gap-2">
              <span class="cfms-icon-text__icon shrink-0"
                ><Icon name="lockPerson" size="18px" /></span
              >
              <div>
                <p class="font-medium">{$t('login.passwordChangeRequired')}</p>
                <p class="mt-1">
                  {$t('login.passwordChangeRequiredBody')}
                </p>
              </div>
            </div>
            <button
              type="button"
              class="w-full py-2 px-4 rounded-full font-medium text-sm
                     bg-md3-tertiary text-md3-on-tertiary
                     hover:brightness-110 transition-all
                     flex items-center justify-center gap-2"
              style="font-family: var(--font-md3-sans);"
              onclick={() => (workspace.showChangePassword = true)}
              disabled={workspace.busy}
            >
              <Icon name="lockPerson" size="16px" />
              {$t('login.changePassword')}
            </button>
          </div>
        {/if}

        <!-- Success banner (e.g. after a password change). -->
        {#if workspace.successMessage}
          <div
            class="bg-md3-primary/15 border border-md3-primary/30
                   text-md3-on-surface text-sm rounded-xl p-3 flex items-start gap-2"
          >
            <span class="cfms-icon-text__icon shrink-0 text-md3-primary-emphasis"
              ><Icon name="checkCircle" size="16px" /></span
            >
            <span>{workspace.successMessage}</span>
          </div>
        {/if}

        <div class="login-primary-row">
        <FluentButton appearance="primary" type="submit" class="login-primary-action" disabled={workspace.busy || (workspace.loginMethod === 'publickey' && workspace.privateKey?.encrypted && !workspace.keyPassphrase)}>
          {#if workspace.busy}
            <ProgressRing tone="inherit" size={18} strokeWidth={2.5} label={$t('common.signingIn')} />
            {$t('common.signingIn')}
          {:else}
            {$t('login.login')}
            <Icon name="arrowForward" size="19px" />
          {/if}
        </FluentButton>
        </div>
        {#if workspace.publicKeyPending}
          <button type="button" class="login-cancel" onclick={workspace.cancelKeyLogin}>{$t('common.cancel')}</button>
        {/if}
        <SignInOptions value={workspace.loginMethod} disabled={workspace.busy} onchange={workspace.switchLoginMethod} />
        <div class="login-footer-actions">
          <button type="button" class="login-disconnect" onclick={workspace.handleDisconnect} disabled={workspace.busy}>
            <Icon name="chevronLeft" size="16px" />{$t('login.disconnect')}
          </button>
        </div>
      </form>
        </div>
      {/if}
      </div>
    {/if}
  </div>
  </section>

</AuthScene>

{#if workspace.keyInteraction}
  <ModalFrame title={$t('publicKey.keyTitle')} onClose={workspace.cancelKeyLogin} maxWidth="max-w-md">
    <PublicKeyVerification interactionId={workspace.keyInteraction} onComplete={(completed) => { if (workspace.keyInteraction === completed) workspace.keyInteraction = null; }} onCancel={() => { workspace.keyInteraction = null; }} />
  </ModalFrame>
{/if}
{#if workspace.migrationVisible}
  <PreferenceUnlockDialog
    onUnlock={async (oldPassword) => { await unlockPreferenceDek(oldPassword); workspace.migrationResolver?.(true); }}
    onDiscard={async () => { await discardLockedPreferenceData(); workspace.migrationResolver?.(true); }}
    onCancel={() => workspace.migrationResolver?.(false)}
  />
{/if}

<!-- 2FA Verification Dialog -->
{#if workspace.show2faDialog}
  <AuthenticationDialog
    title={$t('authentication.mfaTitle')}
    onVerify={workspace.handle2faVerify}
    onCancel={workspace.handle2faCancel}
    methods={authStore.authenticationMethods}
    allowPublicKey
  />
{/if}

{#if workspace.showCorruptedPreferenceDialog}
  <CorruptedPreferenceDialog
    recoveryAvailable={workspace.corruptedPreferenceRecoveryAvailable}
    onRecover={workspace.handleRecoverPreferenceDek}
    onRecovered={() => workspace.resolveCorruptedPreferenceDialog('recovered')}
    onDelete={() => workspace.resolveCorruptedPreferenceDialog('delete')}
    onCancel={() => workspace.resolveCorruptedPreferenceDialog('cancel')}
  />
{/if}

{#if workspace.showForgotPasswordDialog}
  <ModalFrame
    title={$t('dialog.forgotPassword.title')}
    maxWidth="max-w-md"
    closeLabel={$t('common.close')}
    onClose={() => (workspace.showForgotPasswordDialog = false)}
  >
    <div class="space-y-5 p-5">
      <div class="space-y-4 text-sm leading-6 text-md3-on-surface-variant">
        <p>{$t('dialog.forgotPassword.contactAdmin')}</p>
      </div>

      <div class="flex justify-end">
        <DialogActionButton
          variant="primary"
          onclick={() => (workspace.showForgotPasswordDialog = false)}
        >
          {$t('dialog.forgotPassword.confirm')}
        </DialogActionButton>
      </div>
    </div>
  </ModalFrame>
{/if}

<style>
  .password-field-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.25rem;
  }

  .forgot-password-button {
    border: 0;
    padding: 0.375rem 0;
    color: var(--explorer-accent);
    background: transparent;
    font-family: var(--font-md3-sans);
    font-size: 0.75rem;
    font-weight: 400;
    /* text-decoration-line: underline; */
    text-decoration-color: transparent;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.2em;
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      text-decoration-color var(--motion-duration-short4) var(--motion-easing-standard),
      text-shadow var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .forgot-password-button:hover:not(:disabled),
  .forgot-password-button:focus-visible:not(:disabled) {
    color: var(--explorer-text);
    text-decoration-color: var(--explorer-accent);
  }



  .forgot-password-button:disabled {
    opacity: 0.5;
  }

  .login-form-card {
    background: transparent;
    border: 0;
    padding: 0;
  }
  .login-primary-row { margin-top: 24px; }
  .login-primary-row :global(.login-primary-action) { width: 100%; min-height: 44px; }
  .login-primary-row :global(.login-primary-action)::part(content) { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  .login-credential-region { transition: height 180ms var(--motion-easing-standard, ease-out); }
  .login-credential-content { padding: 2px 0; }
  .auth-panel { max-height: calc(100dvh - var(--app-titlebar-height, 0px)); overflow-y: auto; overscroll-behavior-y: contain; }
  @media (max-height: 800px) { .auth-panel.auth-scene-panel { padding-top: 1.5rem; padding-bottom: 1.5rem; } }
  @media (prefers-reduced-motion: reduce) { .login-credential-region { transition: none; } }
  .login-cancel { display: block; margin: 0.5rem auto; padding: 0.5rem 1rem; border: 0; background: transparent; color: var(--explorer-text-muted); cursor: pointer; }
  .login-form-card :global(.sign-in-options) { padding-top: 0.5rem; }
  .login-footer-actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-top: 0.75rem; }
  .login-disconnect { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.4rem 0; border: 0; background: transparent; color: var(--explorer-text-muted); font-size: 0.75rem; cursor: pointer; }
  .login-disconnect:hover:not(:disabled) { color: var(--explorer-text); }
  .login-disconnect:disabled { opacity: 0.5; cursor: default; }
  @media (pointer: coarse) {
    .login-disconnect, .forgot-password-button { min-height: 44px; }
  }

  .login-text-field__leading-icon {
    display: inline-flex;
    flex: none;
    padding-left: 0.75rem;
    color: var(--explorer-text-muted);
  }

  .login-text-field__input {
    min-width: 0;
    flex: 1 1 auto;
    border: 0;
    background: transparent;
    color: var(--explorer-text);
    padding: 0 0.875rem 0 0.625rem;
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    outline: none;
  }

  .login-text-field__input::placeholder {
    color: var(--explorer-text-muted);
  }

  .login-text-field__input:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .login-text-field__trailing-button {
    border: 0;
    padding: 0;
    color: var(--explorer-text-muted);
    background: transparent;
    transition:
      color 120ms ease,
      filter 120ms ease;
  }

  .login-text-field__trailing-button:hover {
    color: var(--explorer-accent);
    background: transparent;
  }

  .auth-panel {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 100%;
    flex: 0 0 100%;
    /* Keep short forms centered while leaving overflowing forms reachable. */
    align-items: safe center;
    justify-content: center;
    padding: 3rem 1.25rem;
    background: var(--colorNeutralBackground2);
  }

  .auth-form-stage {
    display: grid;
    width: 100%;
    max-width: 336px;
    align-items: center;
  }

  .auth-form-stage--server-context {
    min-height: min(32rem, calc(100dvh - 6rem));
    grid-template-rows: auto 1fr;
    align-items: stretch;
  }

  .auth-content-stage {
    display: grid;
    min-height: 0;
    padding-top: 2rem;
  }

  .login-server-status { display: grid; gap: 12px; }

  .auth-state-view,
  .login-view {
    grid-area: 1 / 1;
    width: 100%;
    min-width: 0;
    align-self: start;
  }

  @media (min-width: 1024px) {
    .auth-panel {
      padding-right: 2rem;
      padding-left: 2rem;
    }
  }

  .auth-form-stage--connect-intro {
    animation: auth-form-crossfade var(--auth-transition-duration)
      var(--auth-transition-easing) both;
    will-change: opacity, transform, filter;
  }

  @keyframes auth-form-crossfade {
    0% {
      opacity: 0;
      transform: translate3d(0, 4px, 0) scale(0.985);
      filter: blur(5px);
    }
    28% {
      opacity: 0;
      transform: translate3d(0, 4px, 0) scale(0.985);
      filter: blur(5px);
    }
    72% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
      filter: blur(0);
    }
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
      filter: blur(0);
    }
  }

</style>

<!-- Change Password Dialog (self-change flow for 4001/4002) -->
{#if workspace.showChangePassword}
  <ChangePasswordDialog
    username={workspace.username}
    onSubmit={workspace.handleChangePassword}
    onCancel={workspace.handleChangePasswordCancel}
  />
{/if}
