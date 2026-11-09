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

  import { onDestroy, onMount, tick } from "svelte";
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
    loginWithPublicKey,
    cancelPublicKeyAuthentication,
    releaseAuthPrivateKey,
    preparePreferenceUnlock,
    unlockPreferenceDek,
    discardLockedPreferenceData,
    type AuthPrivateKeyInfo,
    type PublicKeyInteraction,
    completeLoginMfa,
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
    serverErrorData,
    isLockdownError,
    serverErrorMessage,
    serverRetryAfterSeconds,
    serverErrorStatus,
    type AuthStatus,
    type ServerState,
  } from "$lib/api";
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import { downloadStore } from "$lib/stores.svelte";
  import { appearanceStore } from "$lib/appearance.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ProgressRing from "$lib/components/ProgressRing.svelte";
  import AvatarPreview from "$lib/components/AvatarPreview.svelte";
  import AuthServerContext from "$lib/components/AuthServerContext.svelte";
  import ConnectionSecurity from '$lib/components/ConnectionSecurity.svelte';
  import AuthScene from "$lib/components/AuthScene.svelte";
  import AccountDisabledNotice from "$lib/components/AccountDisabledNotice.svelte";
  import DialogActionButton from "$lib/components/DialogActionButton.svelte";
  import FluentTextInput from "$lib/components/FluentTextInput.svelte";
  import FluentButton from "$lib/components/FluentButton.svelte";
  import MdOutlinedField from "$lib/components/MdOutlinedField.svelte";
  import ModalFrame from "$lib/components/ModalFrame.svelte";
  import CorruptedPreferenceDialog from "$lib/components/CorruptedPreferenceDialog.svelte";
  import AuthenticationDialog from "$lib/components/AuthenticationDialog.svelte";
  import ChangePasswordDialog from "$lib/components/ChangePasswordDialog.svelte";
  import { consumeConnectToLoginTransition, markLoginToConnectTransition } from "$lib/auth-transition";
  import { shouldDeferPostLoginForLockdown } from '$lib/auth-lockdown';
  import { formatLocalDateTimeWithUtcOffset } from '$lib/date-time';
  import { flyScale } from '$lib/motion/transitions';
  import { info } from '@tauri-apps/plugin-log';
  import { openKeyboardShortcutHelp } from '$lib/keyboard';

  import PrivateKeyField from '$lib/components/PrivateKeyField.svelte';
  import SignInOptions from '$lib/components/SignInOptions.svelte';
  import PublicKeyVerification from '$lib/components/PublicKeyVerification.svelte';
  import PreferenceUnlockDialog from '$lib/components/PreferenceUnlockDialog.svelte';
  import { publicKeyError } from '$lib/public-key-errors';

  let loginMethod = $state<'password' | 'publickey'>('password');
  let privateKey = $state<AuthPrivateKeyInfo | null>(null);
  let keyPassphrase = $state('');
  let publicKeyPending = $state(false);
  let keyInteraction = $state<string | null>(null);
  let migrationVisible = $state(false);
  let migrationResolver: ((unlocked: boolean) => void) | null = null;
  let username = $state("");
  let password = $state("");
  let passwordVisible = $state(false);
  let busy = $state(false);
  let successMessage = $state<string | null>(null);
  let passwordChangeRequired = $state(false);
  let showChangePassword = $state(false);
  let showForgotPasswordDialog = $state(false);
  let showCorruptedPreferenceDialog = $state(false);
  type UnreadablePreferenceDecision = 'cancel' | 'delete' | 'recovered';
  let corruptedPreferenceResolver: ((decision: UnreadablePreferenceDecision) => void) | null = null;
  let corruptedPreferenceRecoveryAvailable = $state(false);
  let corruptedPreferenceCurrentPassword = $state("");
  let fieldErrors = $state<{ username?: string; password?: string }>({});
  let loadingPhase = $state("");
  let accountDisabled = $state(false);
  let disabledAccountName = $state("");
  let accountDisabledReason = $state<string | null>(null);
  let accountDisabledRequestTime = $state<number | null>(null);
  let returningFromAccountDisabled = $state(false);
  let usernameInput: { focus(options?: FocusOptions): void; select(): void } | null = $state(null);
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

  // JavaScript strings cannot be reliably overwritten. Drop all live references
  // as soon as this route is destroyed to minimize their WebView residency.
  onDestroy(() => {
    if (publicKeyPending) void cancelPublicKeyAuthentication().catch(() => {});
    keyPassphrase = '';
    migrationResolver?.(false);
    migrationResolver = null;
    password = "";
    pendingPassword = "";
    corruptedPreferenceCurrentPassword = "";
    corruptedPreferenceResolver = null;
  });

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
    if (loginMethod === 'publickey') {
      const unlock = await preparePreferenceUnlock();
      if (unlock === 'password_required') {
        migrationVisible = true;
        const unlocked = await new Promise<boolean>((resolve) => { migrationResolver = resolve; });
        migrationVisible = false;
        migrationResolver = null;
        if (!unlocked) { await cancelAuthenticatedSession(); return false; }
      }
    } else if (runPreferenceDekSetup) {
      await setupPreferenceDek(currentPassword);
    }
    await new Promise((r) => setTimeout(r, 300));

    // Phase 3: "Loading preferences…"
    loadingPhase = loadingPhases[2];
    if (!(await ensureUserPreferencesReadable(currentPassword, recoveryAvailable))) {
      return false;
    }
    await appearanceStore.load(
      `user:${serverStateStore.remoteAddress ?? 'local'}:${user}`,
      true,
    );

    // Phase 4: "Downloading avatar…"
    loadingPhase = loadingPhases[3];
    try {
      const taskData = await getUserAvatar(authStore.userId!);
      if (taskData) {
        const path = await downloadAvatar(taskData, user, true);
        if (path) {
          authStore.avatarPath = path;
        }
      }
    } catch (error) {
      if (isLockdownError(error)) throw error;
      // Non-fatal: avatar download failure does not block login.
    }

    // Phase 5: "Loading tasks…"
    loadingPhase = loadingPhases[4];
    try {
      await reloadTasksForUser();
      const tasks = await getDownloadTasks();
      downloadStore.setAll(tasks);
    } catch (error) {
      if (isLockdownError(error)) throw error;
      // Non-fatal: task reload failure does not block login.
    }

    try {
      fileShortcutValidationStore.apply(await validateFileShortcuts());
    } catch (error) {
      if (isLockdownError(error)) throw error;
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
    await appearanceStore.load('global', true);
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
    await appearanceStore.load('global', true);
    password = "";
    pendingPassword = "";
    notificationStore.error(message);
    markLoginToConnectTransition();
    await goto("/connect", { replaceState: true });
  }

  async function handlePostLoginFailure(e: unknown) {
    if (isLockdownError(e)) {
      await enterLockdownAfterIncompleteLogin(e);
      return;
    }

    const message = formatError(e);
    if (isConnectionFlowError(e)) {
      await returnToConnectAfterPostLoginBlocked(message);
      return;
    }

    await cancelAuthenticatedSession();
    notificationStore.error(message);
  }

  function lockdownReasonFromError(error: unknown): string | null | undefined {
    const data = serverErrorData(error);
    if (!data || !Object.hasOwn(data, 'reason')) return undefined;
    if (typeof data.reason !== 'string') return null;
    return data.reason.trim() || null;
  }

  async function enterLockdownAfterIncompleteLogin(
    error?: unknown,
    knownServerState?: ServerState,
  ) {
    if (knownServerState) {
      serverStateStore.apply(knownServerState);
    } else {
      try {
        serverStateStore.apply(await getServerState());
      } catch {
        /* Preserve the last known connection metadata. */
      }
    }

    serverStateStore.lockdown = true;
    const responseReason = lockdownReasonFromError(error);
    if (responseReason !== undefined) {
      serverStateStore.lockdownReason = responseReason;
    }

    try {
      await clearAuthSession();
    } catch {
      /* Continue clearing the webview state even if native cleanup fails. */
    }

    authStore.clear();
    password = "";
    pendingPassword = "";
    show2faDialog = false;
    showCorruptedPreferenceDialog = false;
    corruptedPreferenceResolver = null;
    corruptedPreferenceRecoveryAvailable = false;
    corruptedPreferenceCurrentPassword = "";
    try {
      await appearanceStore.load('global', true);
    } catch {
      /* Lockdown routing must not depend on an appearance preference read. */
    }
    await goto('/lockdown', { replaceState: true });
  }

  async function deferPostLoginIfLocked(authResult: AuthStatus): Promise<boolean> {
    const serverState = await getServerState();
    serverStateStore.apply(serverState);
    if (!shouldDeferPostLoginForLockdown(serverState, authResult)) return false;

    await enterLockdownAfterIncompleteLogin(undefined, serverState);
    return true;
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

    const destination = shouldDeferPostLoginForLockdown(serverState, authStatus)
      ? '/lockdown'
      : '/home/overview';
    await goto(destination);
  }

  const serverName = $derived(serverStateStore.serverName ?? "CFMS Server");
  const accountDisabledRequestTimeText = $derived.by(() =>
    accountDisabledRequestTime === null
      ? ""
      : formatLocalDateTimeWithUtcOffset(accountDisabledRequestTime),
  );

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
      return;
    }
    void focusUsernameInput();
  });

  async function focusUsernameInput() {
    await tick();
    if (busy) return;
    usernameInput?.focus({ preventScroll: true });
    usernameInput?.select();
  }

  /** Validate fields before submitting. Returns true if valid. */
  function validate(): boolean {
    fieldErrors = {};
    let valid = true;
    if (!username.trim()) {
      fieldErrors.username = $t('login.usernameRequired');
      valid = false;
    }
    if (loginMethod === 'password' && !password) {
      fieldErrors.password = $t('login.passwordRequired');
      valid = false;
    }
    if (loginMethod === 'publickey' && !privateKey) {
      fieldErrors.password = $t('publicKey.selectRequired'); valid = false;
    }
    if (!valid) void tick().then(() => {
      if (fieldErrors.username) usernameInput?.focus();
      else if (loginMethod === 'password') passwordInput?.focus();
      else document.querySelector<HTMLButtonElement>('.key-picker')?.focus();
    });
    return valid;
  }

  let credentialHeight = $state(0);
  function measureCredential(node: HTMLDivElement) {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { credentialHeight = node.getBoundingClientRect().height; });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function switchLoginMethod(method: 'password' | 'publickey') {
    if (busy || method === loginMethod) return;
    password = ''; passwordVisible = false; keyPassphrase = ''; fieldErrors = {};
    successMessage = null; passwordChangeRequired = false;
    if (privateKey) void releaseAuthPrivateKey(privateKey.keyRef).catch(() => {});
    privateKey = null; loginMethod = method;
  }

  function receiveKeyInteraction(event: PublicKeyInteraction) {
    if (event.kind === 'select_key') keyInteraction = event.interaction_id;
  }

  async function cancelKeyLogin() {
    await cancelPublicKeyAuthentication();
    keyInteraction = null;
  }

  /** Format an error message for display. */
  function formatError(e: unknown): string {
    if (typeof e === "string" || e instanceof Error) return publicKeyError(e, $t);
    return $t('login.unknownError');
  }

  /** Check whether an error indicates the server requires a password change
   *  before login (codes 4001 / 4002 in the reference implementation). */
  function isPasswordChangeRequired(e: unknown): boolean {
    const msg = serverErrorMessage(e);
    return msg.includes("Password must be changed before login");
  }

  function isAccountDisabledError(e: unknown): boolean {
    return serverErrorStatus(e) === 4003;
  }

  function throttledMessage(e: unknown): string | null {
    if (serverErrorStatus(e) !== 429) return null;
    const seconds = serverRetryAfterSeconds(e);
    return seconds === null
      ? $t('login.tooManyAttempts')
      : $t('login.tooManyAttemptsRetry', { values: { seconds } });
  }

  function getAccountDisabledReason(e: unknown): string | null {
    const reason = serverErrorData(e)?.reason;
    if (typeof reason !== "string") return null;
    const trimmed = reason.trim();
    return trimmed || null;
  }

  async function enterAccountDisabledState(requestedAt: number, reason: string | null) {
    const accountName = username.trim();

    // A 4003 can also arrive while completing 2FA. Clear any partial native
    // auth state while preserving the current server connection.
    try {
      await clearAuthSession();
    } catch {
      /* no partial auth state may have been created yet */
    }

    authStore.clear();
    password = "";
    pendingPassword = "";
    show2faDialog = false;
    disabledAccountName = accountName;
    accountDisabledReason = reason;
    accountDisabledRequestTime = requestedAt;
    returningFromAccountDisabled = false;
    accountDisabled = true;
  }

  async function returnFromAccountDisabled() {
    returningFromAccountDisabled = true;
    accountDisabled = false;
    accountDisabledReason = null;
    fieldErrors = {};
    await focusUsernameInput();
  }

  function finishAccountDisabledReturn() {
    returningFromAccountDisabled = false;
    accountDisabledRequestTime = null;
  }

  async function handleLogin() {
    if (busy || !validate()) return;

    busy = true;
    successMessage = null;
    passwordChangeRequired = false;
    let postLoginStarted = false;
    let loginRequestedAt = Date.now();

    try {
      await info("Attempting login for user: {username}");
      loginRequestedAt = Date.now();
      let authResult;
      if (loginMethod === 'publickey') {
        publicKeyPending = true;
        try { authResult = await loginWithPublicKey(username.trim(), privateKey!.keyRef, keyPassphrase, receiveKeyInteraction); }
        finally { publicKeyPending = false; keyPassphrase = ''; keyInteraction = null; }
        privateKey = null;
      } else { authResult = await login(username.trim(), password); }
      await info("Login response received: {authResult}");

      // Check if server requires 2FA.
      if (authResult.requires_2fa) {
        authStore.apply(authResult);
        serverStateStore.apply(await getServerState());
        // Keep the password only for post-login preference key decryption.
        pendingPassword = password;
        show2faDialog = true;
        return;
      }

      // Regular success — gate post-login work on the latest lockdown state.
      authStore.beginPostLogin();
      postLoginStarted = true;
      if (await deferPostLoginIfLocked(authResult)) return;

      // Animate the loading phases only after lockdown gating succeeds.
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
      const throttleError = throttledMessage(e);
      if (throttleError) {
        notificationStore.warning(throttleError, 5000);
      } else if (isAccountDisabledError(e)) {
        await enterAccountDisabledState(loginRequestedAt, getAccountDisabledReason(e));
      } else if (isPasswordChangeRequired(e)) {
        // The server requires a password change before login (4001/4002).
        // Open the self-change dialog directly so the user can resolve it
        // in-app, mirroring the reference's PasswdUserDialog flow.
        passwordChangeRequired = true;
        showChangePassword = true;
      } else if (postLoginStarted) {
        await handlePostLoginFailure(e);
      } else if (e !== 'publicKey.cancelled') {
        notificationStore.error(formatError(e));
      }
      if (loginMethod === 'publickey' && e !== 'publicKey.wrongPassphrase') privateKey = null;
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
    newPassword: string,
  ): Promise<void> {
    await changePassword(username, newPassword);
    authStore.clear();
    pendingPassword = '';
    // Success: close the dialog and let the user sign in with the new password.
    showChangePassword = false;
    passwordChangeRequired = false;
    password = newPassword; // pre-fill so they can sign in straight away
    successMessage = $t('login.passwordChangedSignIn');
    notificationStore.success(successMessage);
  }

  function handleChangePasswordCancel() {
    showChangePassword = false;
    void clearAuthSession();
    authStore.clear();
  }

  /** Exchange the server-issued AUTH token for a completed login. */
  async function handle2faVerify(
    method: string,
    data: Record<string, import('$lib/api').JsonValue>,
    onInteraction?: (event: PublicKeyInteraction) => void,
  ): Promise<boolean> {
    let authResult;
    const loginRequestedAt = Date.now();

    try {
      if (method === 'publickey') {
        publicKeyPending = true;
        try { authResult = await loginWithPublicKey('', String(data.keyRef), String(data.passphrase), onInteraction ?? (() => {}), true); }
        finally { publicKeyPending = false; }
      } else { authResult = await completeLoginMfa(method, data); }

      if (authResult.requires_2fa) {
        // Still requires 2FA — shouldn't happen, but handle gracefully.
        return false;
      }
    } catch (e) {
      if (isAccountDisabledError(e)) {
        await enterAccountDisabledState(loginRequestedAt, getAccountDisabledReason(e));
        return true;
      }
      if (isPasswordChangeRequired(e)) {
        show2faDialog = false;
        passwordChangeRequired = true;
        showChangePassword = true;
        return true;
      }
      const throttleError = throttledMessage(e);
      if (throttleError) throw new Error(throttleError);
      if (method === 'publickey') throw e;
      // Let the dialog handle the verification error display.
      return false;
    }

    // 2FA is accepted. Close the modal before lockdown gating/loading begins
    // so it does not cover the next full-screen state.
    show2faDialog = false;

    try {
      // Success — gate post-login work on the latest lockdown state.
      authStore.beginPostLogin();
      busy = true;
      if (await deferPostLoginIfLocked(authResult)) return true;

      // Animate the loading phases only after lockdown gating succeeds.
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

<AuthScene view="login" animate={playConnectTransition}>
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
    class:animate-fade-scale-in={!playConnectTransition}
    class:auth-form-stage--connect-intro={playConnectTransition}
    class:auth-form-stage--server-context={accountDisabled || !(busy && loadingPhase)}
  >
    {#if !accountDisabled && busy && loadingPhase}
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
      <div class="login-server-status">
        <AuthServerContext label={$t('login.signInToServer', { values: { serverName } })} />
        <ConnectionSecurity />
      </div>

      <div class="auth-content-stage">
      {#if accountDisabled}
        <div class="auth-state-view" out:flyScale={{ y: -6, duration: 180 }}>
          <AccountDisabledNotice
            title={$t('login.accountDisabledTitle')}
            username={disabledAccountName}
            description={$t('login.accountDisabledContactAdmin')}
            requestTimeLabel={$t('login.accountDisabledRequestTime')}
            requestTime={accountDisabledRequestTimeText}
            backLabel={$t('common.back')}
            reason={accountDisabledReason
              ? $t('login.accountDisabledReasonProvided', { values: { reason: accountDisabledReason } })
              : $t('login.accountDisabledReasonUnavailable')}
            onBack={returnFromAccountDisabled}
          />
        </div>
      {:else}
        <!-- Login form -->
        <div
          class="login-view"
          in:flyScale={{ y: 8, duration: returningFromAccountDisabled ? 300 : 0 }}
          onintroend={finishAccountDisabledReturn}
        >
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
        class="login-form-card backdrop-blur-sm rounded-xl
               border border-md3-outline p-6 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleLogin();
        }}
      >
        <!-- Username -->
        <div>
          <FluentTextInput
            id="username"
            controlSize="large"
            label={$t('login.username')}
            invalid={Boolean(fieldErrors.username)}
            validationMessage={fieldErrors.username}
            describedBy={fieldErrors.username ? 'login-username-error' : undefined}
            placeholder={$t('login.usernamePlaceholder')}
            bind:value={username}
            bind:this={usernameInput}
            disabled={busy}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (loginMethod === 'password') passwordInput?.focus();
                else document.querySelector<HTMLElement>('.key-picker')?.focus();
              }
            }}
          >
            {#snippet start()}<Icon name="accountCircle" size={20} />{/snippet}
          </FluentTextInput>
          {#if fieldErrors.username}
            <p id="login-username-error" role="alert" class="text-xs text-md3-error mt-1 ml-1">
              {fieldErrors.username}
            </p>
          {/if}
        </div>

        <div class="login-credential-region" style:height={credentialHeight ? `${credentialHeight}px` : undefined}>
        <div class="login-credential-content" use:measureCredential>
        {#if loginMethod === 'password'}
        <div>
          <MdOutlinedField
            inputId="password"
            controlSize="large"
            label={$t('login.password')}
            error={Boolean(fieldErrors.password)}
          >
            <span data-field-leading-icon class="login-text-field__leading-icon">
              <Icon name="password" size="18px" />
            </span>
            <input
              id="password"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
              type={passwordVisible ? "text" : "password"}
              data-focus-ring="delegated"
              class="login-text-field__input"
              placeholder={$t('login.passwordPlaceholder')}
              bind:value={password}
              bind:this={passwordInput}
              disabled={busy}
              autocomplete="current-password"
            />
            {#snippet end()}
              <button
                type="button"
                class="login-text-field__trailing-button"
                onclick={() => (passwordVisible = !passwordVisible)}
                aria-label={passwordVisible ? $t('login.hidePassword') : $t('login.showPassword')}
              >
                <Icon
                  name={passwordVisible ? "visibility" : "visibility"}
                  size="18px"
                />
              </button>
            {/snippet}
          </MdOutlinedField>
          {#if fieldErrors.password}
            <p id="login-password-error" role="alert" class="text-xs text-md3-error mt-1 ml-1">
              {fieldErrors.password}
            </p>
          {/if}
          <div class="password-field-actions">
            <button type="button" class="forgot-password-button" onclick={() => (showForgotPasswordDialog = true)} disabled={busy}>
              {$t('login.forgotPassword')}
            </button>
          </div>
        </div>

        {:else}
          <PrivateKeyField bind:selection={privateKey} bind:passphrase={keyPassphrase} disabled={busy} invalid={Boolean(fieldErrors.password)} describedBy={fieldErrors.password ? 'login-key-error' : undefined} />
          {#if fieldErrors.password}<p id="login-key-error" role="alert" class="text-xs text-md3-error mt-2">{fieldErrors.password}</p>{/if}
        {/if}
        </div>
        </div>

        <!-- Password change required (4001/4002) — offer in-app change. -->
        {#if passwordChangeRequired}
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
            <span class="cfms-icon-text__icon shrink-0 text-md3-primary-emphasis"
              ><Icon name="checkCircle" size="16px" /></span
            >
            <span>{successMessage}</span>
          </div>
        {/if}

        <div class="login-primary-row">
        <FluentButton appearance="primary" type="submit" class="login-primary-action" disabled={busy || (loginMethod === 'publickey' && privateKey?.encrypted && !keyPassphrase)}>
          {#if busy}
            <ProgressRing tone="inherit" size={18} strokeWidth={2.5} label={$t('common.signingIn')} />
            {$t('common.signingIn')}
          {:else}
            {$t('login.login')}
            <Icon name="arrowForward" size="19px" />
          {/if}
        </FluentButton>
        </div>
        {#if publicKeyPending}
          <button type="button" class="login-cancel" onclick={cancelKeyLogin}>{$t('common.cancel')}</button>
        {/if}
        <SignInOptions value={loginMethod} disabled={busy} onchange={switchLoginMethod} />
        <div class="login-footer-actions">
          <button type="button" class="login-disconnect" onclick={handleDisconnect} disabled={busy}>
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

{#if keyInteraction}
  <ModalFrame title={$t('publicKey.keyTitle')} onClose={cancelKeyLogin} maxWidth="max-w-md">
    <PublicKeyVerification interactionId={keyInteraction} onComplete={(completed) => { if (keyInteraction === completed) keyInteraction = null; }} onCancel={() => { keyInteraction = null; }} />
  </ModalFrame>
{/if}
{#if migrationVisible}
  <PreferenceUnlockDialog
    onUnlock={async (oldPassword) => { await unlockPreferenceDek(oldPassword); migrationResolver?.(true); }}
    onDiscard={async () => { await discardLockedPreferenceData(); migrationResolver?.(true); }}
    onCancel={() => migrationResolver?.(false)}
  />
{/if}

<!-- 2FA Verification Dialog -->
{#if show2faDialog}
  <AuthenticationDialog
    title={$t('authentication.mfaTitle')}
    onVerify={handle2faVerify}
    onCancel={handle2faCancel}
    methods={authStore.authenticationMethods}
    allowPublicKey
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

{#if showForgotPasswordDialog}
  <ModalFrame
    title={$t('dialog.forgotPassword.title')}
    maxWidth="max-w-md"
    closeLabel={$t('common.close')}
    onClose={() => (showForgotPasswordDialog = false)}
  >
    <div class="space-y-5 p-5">
      <div class="space-y-4 text-sm leading-6 text-md3-on-surface-variant">
        <p>{$t('dialog.forgotPassword.contactAdmin')}</p>
      </div>

      <div class="flex justify-end">
        <DialogActionButton
          variant="primary"
          onclick={() => (showForgotPasswordDialog = false)}
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
{#if showChangePassword}
  <ChangePasswordDialog
    {username}
    onSubmit={handleChangePassword}
    onCancel={handleChangePasswordCancel}
  />
{/if}
