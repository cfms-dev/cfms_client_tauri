<script lang="ts">
  // Login page
  //
  // User enters credentials after a WebSocket connection has been established
  // on the /connect page.  Avatar preview updates reactively as the username
  // is typed.
  //
  // Supports two-factor authentication: when the server returns code 202
  // (2FA required), a TwoFactorVerifyDialog is shown so the user can enter
  // their TOTP or recovery code.
  //
  // Reference: LoginModel in reference/src/include/ui/models/login.py
  //            LoginFormController in reference/src/include/controllers/login.py

  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { _ as t } from 'svelte-i18n';
  import {
    authStore,
    fileShortcutValidationStore,
    notificationStore,
    serverStateStore,
  } from "$lib/stores.svelte";
  import {
    login,
    changePassword,
    recoverPreferenceDek,
    disconnect,
    logout,
    getAuthStatus,
    getServerState,
    getUserAvatar,
    downloadAvatar,
    getDownloadTasks,
    reloadTasksForUser,
    loadUserPreference,
    setupPreferenceDek,
    discardUserPreference,
    resetPreferenceDek,
    checkCachedAvatar,
    validateFileShortcuts,
    clearAuthSession,
    type AuthStatus,
  } from "$lib/api";
  import { downloadStore } from "$lib/stores.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ProgressRing from "$lib/components/ProgressRing.svelte";
  import AvatarPreview from "$lib/components/AvatarPreview.svelte";
  import CorruptedPreferenceDialog from "$lib/components/CorruptedPreferenceDialog.svelte";
  import TwoFactorVerifyDialog from "$lib/components/TwoFactorVerifyDialog.svelte";
  import ChangePasswordDialog from "$lib/components/ChangePasswordDialog.svelte";
  import { consumeConnectToLoginTransition, markLoginToConnectTransition } from "$lib/auth-transition";
  import { info } from '@tauri-apps/plugin-log';

  let username = $state("");
  let password = $state("");
  let passwordVisible = $state(false);
  let busy = $state(false);
  let successMessage = $state<string | null>(null);
  let passwordChangeRequired = $state(false);
  let showChangePassword = $state(false);
  let showCorruptedPreferenceDialog = $state(false);
  type UnreadablePreferenceDecision = 'cancel' | 'delete' | 'recovered';
  let corruptedPreferenceResolver: ((decision: UnreadablePreferenceDecision) => void) | null = null;
  let corruptedPreferenceRecoveryAvailable = $state(false);
  let corruptedPreferenceCurrentPassword = $state("");
  let fieldErrors = $state<{ username?: string; password?: string }>({});
  let loadingPhase = $state("");
  let passwordInput: HTMLInputElement | null = $state(null);
  let playConnectTransition = $state(browser ? consumeConnectToLoginTransition() : false);

  // Cached avatar path — populated reactively as the user types a username.
  // When non-null it contains a local filesystem path to a previously
  // downloaded avatar for this username on the current server.
  let cachedAvatarPath = $state<string | null>(null);

  // 2FA state
  let show2faDialog = $state(false);
  // The temporary password is kept in memory during 2FA so we can re-send
  // the login request with the verification code.
  let pendingPassword = $state("");

  // Loading phases after successful login (matching reference's DataLoadingView).
  const loadingPhases = [
    $t('login.loadingUserData'),
    $t('login.settingUpEncryption'),
    $t('login.loadingPreferences'),
    $t('login.downloadingAvatar'),
    $t('login.loadingTasks'),
  ];

  /** Run the post-login loading phases with real backend work.
   *
   *  Mirrors `_complete_login` in the Python reference:
   *  reference/src/include/controllers/login.py */
  async function runLoadingPhases(
    user: string,
    currentPassword: string,
    recoveryAvailable: boolean,
    runPreferenceDekSetup: boolean,
  ): Promise<boolean> {
    // Phase 1: "Loading user data…"
    loadingPhase = loadingPhases[0];
    // Auth data is already stored by the login command.
    await new Promise((r) => setTimeout(r, 200));

    // Phase 2: "Setting up encryption…"
    loadingPhase = loadingPhases[1];
    if (runPreferenceDekSetup) {
      await setupPreferenceDek(currentPassword);
    }
    await new Promise((r) => setTimeout(r, 300));

    // Phase 3: "Loading preferences…"
    loadingPhase = loadingPhases[2];
    if (!(await ensureUserPreferencesReadable(currentPassword, recoveryAvailable))) {
      return false;
    }

    // Phase 4: "Downloading avatar…"
    loadingPhase = loadingPhases[3];
    try {
      const taskData = await getUserAvatar(user);
      if (taskData) {
        const path = await downloadAvatar(taskData, user, true);
        if (path) {
          authStore.avatarPath = path;
        }
      }
    } catch {
      // Non-fatal: avatar download failure does not block login.
    }

    // Phase 5: "Loading tasks…"
    loadingPhase = loadingPhases[4];
    try {
      await reloadTasksForUser();
      const tasks = await getDownloadTasks();
      downloadStore.setAll(tasks);
    } catch {
      // Non-fatal: task reload failure does not block login.
    }

    try {
      fileShortcutValidationStore.apply(await validateFileShortcuts());
    } catch {
      // Non-fatal: shortcut validation failure does not block login.
    }

    return true;
  }

  async function ensureUserPreferencesReadable(
    currentPassword: string,
    recoveryAvailable: boolean,
  ): Promise<boolean> {
    try {
      await loadUserPreference();
      return true;
    } catch (e) {
      if (!isUnreadablePreferenceError(e)) {
        throw e;
      }
    }

    const decision = await askDiscardUnreadablePreferences(currentPassword, recoveryAvailable);
    if (decision === 'cancel') {
      await cancelAuthenticatedSession();
      return false;
    }
    if (decision === 'recovered') {
      await loadUserPreference();
      return true;
    }

    await discardUserPreference();
    await resetPreferenceDek(currentPassword);
    await loadUserPreference();
    return true;
  }

  function askDiscardUnreadablePreferences(
    currentPassword: string,
    recoveryAvailable: boolean,
  ): Promise<UnreadablePreferenceDecision> {
    corruptedPreferenceRecoveryAvailable = recoveryAvailable;
    corruptedPreferenceCurrentPassword = currentPassword;
    showCorruptedPreferenceDialog = true;
    return new Promise((resolve) => {
      corruptedPreferenceResolver = resolve;
    });
  }

  function resolveCorruptedPreferenceDialog(decision: UnreadablePreferenceDecision) {
    showCorruptedPreferenceDialog = false;
    corruptedPreferenceResolver?.(decision);
    corruptedPreferenceResolver = null;
    corruptedPreferenceRecoveryAvailable = false;
    corruptedPreferenceCurrentPassword = "";
  }

  async function handleRecoverPreferenceDek(recoveryPassword: string): Promise<void> {
    await recoverPreferenceDek(recoveryPassword, corruptedPreferenceCurrentPassword);
  }

  function isUnreadablePreferenceError(e: unknown): boolean {
    const message = formatError(e).toLowerCase();
    return (
      message.includes('encrypted preference file found but dek is unavailable')
      || message.includes('preference dek is unavailable')
      || message.includes('failed to decrypt preference file')
      || (message.includes('preference file') && message.includes('is not encrypted'))
      || message.includes('invalid preference data')
    );
  }

  async function cancelAuthenticatedSession() {
    try {
      await clearAuthSession();
    } catch {
      /* backend may already have cleared auth state */
    }
    authStore.clear();
    password = "";
    pendingPassword = "";
    try {
      serverStateStore.apply(await getServerState());
    } catch {
      /* keep the last known connection state */
    }
  }

  function isConnectionFlowError(e: unknown): boolean {
    const message = formatError(e).toLowerCase();
    return (
      message.includes('not connected')
      || message.includes('connection closed')
      || message.includes('connection failed')
      || message.includes('failed to create stream')
      || message.includes('failed to send')
      || message.includes('send failed')
      || message.includes('stream closed')
      || message.includes('websocket')
      || message.includes('tcp connect')
    );
  }

  async function returnToConnectAfterPostLoginBlocked(message: string) {
    try {
      await disconnect();
    } catch {
      try {
        await clearAuthSession();
      } catch {
        /* backend may already be disconnected/cleared */
      }
    }

    authStore.clear();
    serverStateStore.clear();
    password = "";
    pendingPassword = "";
    notificationStore.error(message);
    markLoginToConnectTransition();
    await goto("/connect", { replaceState: true });
  }

  async function handlePostLoginFailure(e: unknown) {
    const message = formatError(e);
    if (isConnectionFlowError(e)) {
      await returnToConnectAfterPostLoginBlocked(message);
      return;
    }

    await cancelAuthenticatedSession();
    notificationStore.error(message);
  }

  async function finalizeAuthenticatedLogin(authResult: AuthStatus) {
    const authStatus = await getAuthStatus();
    const serverState = await getServerState();
    if (!serverState.connected) {
      throw new Error("Connection closed during login setup");
    }

    authStore.apply(authResult);
    authStore.apply(authStatus);
    serverStateStore.apply(serverState);

    // Clear password from JS memory.
    password = "";
    pendingPassword = "";

    // Navigate to home.
    await goto("/home/overview");
  }

  const serverName = $derived(serverStateStore.serverName ?? "CFMS Server");

  /** Check the local avatar cache for the given username + current server.
   *
   *  Mirrors [`AvatarPreviewContainer.update_preview`] in the Python
   *  reference (reference/src/include/ui/controls/views/login.py). */
  async function checkLocalAvatarCache(user: string, server: string): Promise<string | null> {
    // If the server or username is empty, there's nothing to check.
    if (!server || !user.trim()) return null;
    try {
      return await checkCachedAvatar(user);
    } catch {
      // Non-fatal: cache check failure shouldn't break the login page.
      return null;
    }
  }

  // Reactively check the avatar cache whenever the username changes.
  $effect(() => {
    const currentUsername = username.trim();
    const currentServer = serverStateStore.remoteAddress ?? "";

    let cancelled = false;

    if (currentUsername) {
      checkLocalAvatarCache(currentUsername, currentServer)
        .then((path) => {
          if (!cancelled) {
            cachedAvatarPath = path;
          }
        })
        .catch(() => {
          if (!cancelled) {
            cachedAvatarPath = null;
          }
        });
    } else {
      cachedAvatarPath = null;
    }

    return () => {
      cancelled = true;
    };
  });

  // If already logged in, go straight to home.
  onMount(() => {
    if (authStore.isLoggedIn && !authStore.postLoginPending) {
      goto("/home/overview");
    }
  });

  /** Validate fields before submitting. Returns true if valid. */
  function validate(): boolean {
    fieldErrors = {};
    let valid = true;
    if (!username.trim()) {
      fieldErrors.username = $t('login.usernameRequired');
      valid = false;
    }
    if (!password) {
      fieldErrors.password = $t('login.passwordRequired');
      valid = false;
    }
    return valid;
  }

  /** Format an error message for display. */
  function formatError(e: unknown): string {
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message;
    return $t('login.unknownError');
  }

  /** Check whether an error indicates the server requires a password change
   *  before login (codes 4001 / 4002 in the reference implementation). */
  function isPasswordChangeRequired(e: unknown): boolean {
    const msg = formatError(e);
    return msg.includes("Password must be changed before login");
  }

  async function handleLogin() {
    if (!validate()) return;

    busy = true;
    successMessage = null;
    passwordChangeRequired = false;
    let postLoginStarted = false;

    try {
      await info("Attempting login for user: {username}");
      const authResult = await login(username, password);
      await info("Login response received: {authResult}");

      // Check if server requires 2FA.
      if (authResult.requires_2fa) {
        authStore.apply(authResult);
        serverStateStore.apply(await getServerState());
        // Keep password in memory for the 2FA re-submit.
        pendingPassword = password;
        show2faDialog = true;
        return;
      }

      // Regular success — animate the loading phases.
      authStore.beginPostLogin();
      postLoginStarted = true;
      loadingPhase = loadingPhases[0];
      await info("Login successful, running post-login loading phases...");
      if (!(await runLoadingPhases(
        username.trim(),
        password,
        authResult.has_server_preference_dek === true,
        authResult.needs_preference_dek_setup === true,
      ))) return;
      await info("Loading phases complete, finalizing auth state...");

      await finalizeAuthenticatedLogin(authResult);
    } catch (e) {
      if (isPasswordChangeRequired(e)) {
        // The server requires a password change before login (4001/4002).
        // Open the self-change dialog directly so the user can resolve it
        // in-app, mirroring the reference's PasswdUserDialog flow.
        passwordChangeRequired = true;
        showChangePassword = true;
      } else if (postLoginStarted) {
        await handlePostLoginFailure(e);
      } else {
        notificationStore.error(formatError(e));
      }
    } finally {
      busy = false;
      loadingPhase = "";
      authStore.finishPostLogin();
    }
  }

  /** Submit handler for ChangePasswordDialog (self-change flow).
   *  Throws on failure so the dialog can surface the server's message
   *  (e.g. password-rule violations); resolves on success. */
  async function handleChangePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    await changePassword(username, oldPassword, newPassword);
    // Success: close the dialog and let the user sign in with the new password.
    showChangePassword = false;
    passwordChangeRequired = false;
    password = newPassword; // pre-fill so they can sign in straight away
    successMessage = $t('login.passwordChangedSignIn');
    notificationStore.success(successMessage);
  }

  function handleChangePasswordCancel() {
    showChangePassword = false;
  }

  /** Callback from TwoFactorVerifyDialog — re-sends login with 2FA code. */
  async function handle2faVerify(
    code: string,
    isRecoveryCode: boolean,
  ): Promise<boolean> {
    let authResult;

    try {
      authResult = await login(username, pendingPassword, code);

      if (authResult.requires_2fa) {
        // Still requires 2FA — shouldn't happen, but handle gracefully.
        return false;
      }
    } catch (e) {
      // Let the dialog handle the verification error display.
      return false;
    }

    // 2FA is accepted. Close the modal before post-login loading begins so it
    // doesn't cover the loading screen.
    show2faDialog = false;

    try {
      // Success — animate the loading phases.
      authStore.beginPostLogin();
      busy = true;
      loadingPhase = loadingPhases[0];
      if (!(await runLoadingPhases(
        username.trim(),
        pendingPassword,
        authResult.has_server_preference_dek === true,
        authResult.needs_preference_dek_setup === true,
      ))) return true;

      await finalizeAuthenticatedLogin(authResult);

      return true;
    } catch (e) {
      await handlePostLoginFailure(e);
      return true;
    } finally {
      busy = false;
      loadingPhase = "";
      authStore.finishPostLogin();
    }
  }

  /** Callback from TwoFactorVerifyDialog — user cancelled 2FA. */
  function handle2faCancel() {
    show2faDialog = false;
    void cancelAuthenticatedSession();
  }

  async function handleDisconnect() {
    busy = true;
    try {
      await info("Disconnecting from server...");
      await disconnect();
      await logout();
      authStore.clear();
      serverStateStore.clear();
      markLoginToConnectTransition();
      goto("/connect");
    } catch (e) {
      notificationStore.error(formatError(e));
    } finally {
      busy = false;
    }
  }
</script>

<div class="auth-shell" class:auth-shell--connect-intro={playConnectTransition}>
  <section class="auth-panel">
  <div
    class="auth-form-stage"
    class:animate-fade-scale-in={!playConnectTransition}
    class:auth-form-stage--connect-intro={playConnectTransition}
  >
    {#if busy && loadingPhase}
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
          {loadingPhase}
        </p>
        <p class="text-xs text-md3-on-surface-variant">
          {$t('login.setupWait')}
        </p>
      </div>
    {:else}
      <!-- Login form -->
      <div class="text-center mb-6">
        <!-- Server info -->
        <p
          class="text-lg font-bold text-md3-on-surface mb-1"
          style="font-family: var(--font-md3-sans);"
        >
          {serverName}
        </p>
        <p class="text-xs text-md3-on-surface-variant">
          {$t('login.connectedSignIn')}
        </p>
      </div>

      <!-- Avatar preview -->
      <div class="flex justify-center mb-6">
        {#if username.trim()}
          <AvatarPreview {username} size={80} avatarPath={authStore.avatarPath || cachedAvatarPath} />
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
        class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
               border border-md3-outline p-6 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleLogin();
        }}
      >
        <!-- Username -->
        <div>
          <label
            for="username"
            class="block text-sm font-medium mb-1.5 text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
          >
            {$t('login.username')}
          </label>
          <div class="relative">
            <span
              class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant"
            >
              <Icon name="accountCircle" size="18px" />
            </span>
            <input
              id="username"
              type="text"
              class="w-full pl-10 pr-3.5 py-2.5 rounded-xl border
                     {fieldErrors.username
                ? 'border-md3-error'
                : 'border-md3-outline'}
                     bg-md3-field text-md3-on-surface text-sm
                     placeholder:text-md3-on-surface-variant
                     focus:ring-2 focus:ring-md3-primary focus:border-transparent
                     transition-colors"
              placeholder={$t('login.usernamePlaceholder')}
              bind:value={username}
              disabled={busy}
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              onkeydown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  passwordInput?.focus();
                }
              }}
            />
          </div>
          {#if fieldErrors.username}
            <p class="text-xs text-md3-error mt-1 ml-1">
              {fieldErrors.username}
            </p>
          {/if}
        </div>

        <!-- Password -->
        <div>
          <label
            for="password"
            class="block text-sm font-medium mb-1.5 text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
          >
            {$t('login.password')}
          </label>
          <div class="relative">
            <span
              class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant"
            >
              <Icon name="password" size="18px" />
            </span>
            <input
              id="password"
              type={passwordVisible ? "text" : "password"}
              class="w-full pl-10 pr-10 py-2.5 rounded-xl border
                     {fieldErrors.password
                ? 'border-md3-error'
                : 'border-md3-outline'}
                     bg-md3-field text-md3-on-surface text-sm
                     placeholder:text-md3-on-surface-variant
                     focus:ring-2 focus:ring-md3-primary focus:border-transparent
                     transition-colors"
              placeholder={$t('login.passwordPlaceholder')}
              bind:value={password}
              bind:this={passwordInput}
              disabled={busy}
              autocomplete="current-password"
            />
            <button
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant
                     hover:text-md3-on-surface transition-colors"
              onclick={() => (passwordVisible = !passwordVisible)}
              tabindex="-1"
              aria-label={passwordVisible ? $t('login.hidePassword') : $t('login.showPassword')}
            >
              <Icon
                name={passwordVisible ? "visibility" : "visibility"}
                size="18px"
              />
            </button>
          </div>
          {#if fieldErrors.password}
            <p class="text-xs text-md3-error mt-1 ml-1">
              {fieldErrors.password}
            </p>
          {/if}
        </div>

        <!-- Password change required (4001/4002) — offer in-app change. -->
        {#if passwordChangeRequired}
          <div
            class="bg-md3-tertiary-container/70 border border-md3-tertiary/40
                      text-md3-on-tertiary-container text-sm rounded-xl p-4 space-y-3"
          >
            <div class="flex items-start gap-2">
              <span class="shrink-0 mt-0.5"
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
              onclick={() => (showChangePassword = true)}
              disabled={busy}
            >
              <Icon name="lockPerson" size="16px" />
              {$t('login.changePassword')}
            </button>
          </div>
        {/if}

        <!-- Success banner (e.g. after a password change). -->
        {#if successMessage}
          <div
            class="bg-md3-primary/15 border border-md3-primary/30
                   text-md3-on-surface text-sm rounded-xl p-3 flex items-start gap-2"
          >
            <span class="shrink-0 mt-0.5 text-md3-primary-emphasis"
              ><Icon name="checkCircle" size="16px" /></span
            >
            <span>{successMessage}</span>
          </div>
        {/if}

        <!-- Actions row: Disconnect + Login -->
        <div class="flex gap-3 pt-1">
          <button
            type="button"
            class="py-2.5 px-4 rounded-full font-medium
                   border border-md3-outline text-md3-on-surface-variant
                   hover:bg-md3-surface-container-high
                   disabled:opacity-50 transition-all flex items-center gap-1.5"
            style="font-family: var(--font-md3-sans);"
            onclick={handleDisconnect}
            disabled={busy}
          >
            <Icon name="chevronLeft" size="18px" />
            {$t('login.disconnect')}
          </button>

          <button
            type="submit"
            class="flex-1 py-2.5 px-4 rounded-full font-medium
                   bg-md3-primary text-md3-on-primary
                   hover:brightness-110
                   disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            style="font-family: var(--font-md3-sans);"
            disabled={busy}
          >
            {#if busy}
              <ProgressRing size={18} strokeWidth={2.5} label={$t('common.signingIn')} />
              {$t('common.signingIn')}
            {:else}
              <Icon name="login" size="20px" />
              {$t('login.login')}
            {/if}
          </button>
        </div>
      </form>
    {/if}
  </div>
  </section>

  <section class="auth-visual" aria-hidden="true">
    <img
      src="/astronomy.jpg"
      alt=""
      class="auth-visual-image"
    />
  </section>
</div>

<!-- 2FA Verification Dialog -->
{#if show2faDialog}
  <TwoFactorVerifyDialog
    onVerify={handle2faVerify}
    onCancel={handle2faCancel}
    method={authStore.twofaMethod}
  />
{/if}

{#if showCorruptedPreferenceDialog}
  <CorruptedPreferenceDialog
    recoveryAvailable={corruptedPreferenceRecoveryAvailable}
    onRecover={handleRecoverPreferenceDek}
    onRecovered={() => resolveCorruptedPreferenceDialog('recovered')}
    onDelete={() => resolveCorruptedPreferenceDialog('delete')}
    onCancel={() => resolveCorruptedPreferenceDialog('cancel')}
  />
{/if}

<style>
  .auth-shell {
    display: flex;
    min-height: 100%;
    overflow: hidden;
    background: #0e1217;
  }

  .auth-panel {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 100%;
    flex: 0 0 100%;
    align-items: center;
    justify-content: center;
    padding: 3rem 1.25rem;
    background:
      linear-gradient(
        135deg,
        var(--color-md3-bg-gradient-start) 0%,
        var(--color-md3-bg-gradient-mid-1) 28%,
        var(--color-md3-bg-gradient-mid-2) 58%,
        var(--color-md3-bg-gradient-end) 100%
      );
  }

  .auth-form-stage {
    width: 100%;
    max-width: 360px;
  }

  .auth-visual {
    display: none;
    min-height: 100%;
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    background: #0e1217;
  }

  .auth-visual-image {
    height: 100%;
    width: 100%;
    object-fit: cover;
  }

  @media (min-width: 1024px) {
    .auth-panel {
      flex-basis: 520px;
      padding-right: 2rem;
      padding-left: 2rem;
    }

    .auth-visual {
      display: block;
    }

    .auth-shell--connect-intro .auth-panel {
      animation: auth-panel-shrink var(--motion-duration-long4)
        var(--motion-easing-emphasized) both;
      will-change: flex-basis;
    }

    .auth-shell--connect-intro .auth-visual {
      animation: auth-visual-expand var(--motion-duration-long4)
        var(--motion-easing-emphasized) both;
      will-change: flex-basis, opacity;
    }

    .auth-shell--connect-intro .auth-visual-image {
      animation: auth-visual-image-push var(--motion-duration-long4)
        var(--motion-easing-emphasized) both;
      will-change: transform;
    }
  }

  .auth-form-stage--connect-intro {
    animation: auth-form-crossfade var(--motion-duration-long4)
      var(--motion-easing-emphasized) both;
    will-change: opacity, transform, filter;
  }

  @keyframes auth-panel-shrink {
    from {
      flex-basis: 100%;
    }
    to {
      flex-basis: 520px;
    }
  }

  @keyframes auth-visual-expand {
    from {
      flex-basis: 0;
      opacity: 0.96;
    }
    to {
      flex-basis: calc(100% - 520px);
      opacity: 1;
    }
  }

  @keyframes auth-visual-image-push {
    from {
      transform: translate3d(18%, 0, 0) scale(1.04);
    }
    to {
      transform: translate3d(0, 0, 0) scale(1);
    }
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

  @media (prefers-reduced-motion: reduce) {
    .auth-shell--connect-intro .auth-panel,
    .auth-shell--connect-intro .auth-visual,
    .auth-shell--connect-intro .auth-visual-image,
    .auth-form-stage--connect-intro {
      animation: none !important;
    }
  }
</style>

<!-- Change Password Dialog (self-change flow for 4001/4002) -->
{#if showChangePassword}
  <ChangePasswordDialog
    {username}
    initialOldPassword={password}
    onSubmit={handleChangePassword}
    onCancel={handleChangePasswordCancel}
  />
{/if}
