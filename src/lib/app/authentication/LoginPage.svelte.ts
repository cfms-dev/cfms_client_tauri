import { onDestroy, onMount, tick } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { _ as t } from 'svelte-i18n';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { fileShortcutValidationStore } from "$lib/features/files/shortcut-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import {
  login,
  loginWithPublicKey,
  cancelPublicKeyAuthentication,
  releaseAuthPrivateKey,
  preparePreferenceUnlock,
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
import { downloadStore } from "$lib/features/transfers/download-state.svelte.ts";
import { appearanceStore } from "$lib/features/settings/appearance.svelte.ts";
import { consumeConnectToLoginTransition, markLoginToConnectTransition } from "$lib/features/authentication/auth-transition";
import { shouldDeferPostLoginForLockdown } from '$lib/features/authentication/auth-lockdown';
import { formatLocalDateTimeWithUtcOffset } from '$lib/shared/format/date-time';
import { info } from '$lib/shared/platform/native-log';
import { publicKeyError } from '$lib/features/authentication/public-key-errors';
import { fromStore } from 'svelte/store';

export type UnreadablePreferenceDecision = 'cancel' | 'delete' | 'recovered';

/** Per-view workflow; reusable business rules live in features. */
export function createLoginFlow() {
  const translator = fromStore(t);

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

  let cachedAvatarPath = $state<string | null>(null);

  let show2faDialog = $state(false);

  let pendingPassword = $state("");

  onDestroy(() => {
    if (publicKeyPending) void cancelPublicKeyAuthentication().catch(() => { });
    keyPassphrase = '';
    migrationResolver?.(false);
    migrationResolver = null;
    password = "";
    pendingPassword = "";
    corruptedPreferenceCurrentPassword = "";
    corruptedPreferenceResolver = null;
  });

  const loadingPhases = [
    translator.current('login.loadingUserData'),
    translator.current('login.settingUpEncryption'),
    translator.current('login.loadingPreferences'),
    translator.current('login.downloadingAvatar'),
    translator.current('login.loadingTasks'),
  ];

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

  function validate(): boolean {
    fieldErrors = {};
    let valid = true;
    if (!username.trim()) {
      fieldErrors.username = translator.current('login.usernameRequired');
      valid = false;
    }
    if (loginMethod === 'password' && !password) {
      fieldErrors.password = translator.current('login.passwordRequired');
      valid = false;
    }
    if (loginMethod === 'publickey' && !privateKey) {
      fieldErrors.password = translator.current('publicKey.selectRequired'); valid = false;
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
    if (privateKey) void releaseAuthPrivateKey(privateKey.keyRef).catch(() => { });
    privateKey = null; loginMethod = method;
  }

  function receiveKeyInteraction(event: PublicKeyInteraction) {
    if (event.kind === 'select_key') keyInteraction = event.interaction_id;
  }

  async function cancelKeyLogin() {
    await cancelPublicKeyAuthentication();
    keyInteraction = null;
  }

  function formatError(e: unknown): string {
    if (typeof e === "string" || e instanceof Error) return publicKeyError(e, translator.current);
    return translator.current('login.unknownError');
  }

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
      ? translator.current('login.tooManyAttempts')
      : translator.current('login.tooManyAttemptsRetry', { values: { seconds } });
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
    successMessage = translator.current('login.passwordChangedSignIn');
    notificationStore.success(successMessage);
  }

  function handleChangePasswordCancel() {
    showChangePassword = false;
    void clearAuthSession();
    authStore.clear();
  }

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
        try { authResult = await loginWithPublicKey('', String(data.keyRef), String(data.passphrase), onInteraction ?? (() => { }), true); }
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

  return {

    get accountDisabled() { return accountDisabled; },
    set accountDisabled(value) { accountDisabled = value; },
    get accountDisabledReason() { return accountDisabledReason; },
    set accountDisabledReason(value) { accountDisabledReason = value; },
    get accountDisabledRequestTimeText() { return accountDisabledRequestTimeText; },
    get busy() { return busy; },
    set busy(value) { busy = value; },
    get cachedAvatarPath() { return cachedAvatarPath; },
    set cachedAvatarPath(value) { cachedAvatarPath = value; },
    cancelKeyLogin,
    get corruptedPreferenceRecoveryAvailable() { return corruptedPreferenceRecoveryAvailable; },
    set corruptedPreferenceRecoveryAvailable(value) { corruptedPreferenceRecoveryAvailable = value; },
    get credentialHeight() { return credentialHeight; },
    set credentialHeight(value) { credentialHeight = value; },
    get disabledAccountName() { return disabledAccountName; },
    set disabledAccountName(value) { disabledAccountName = value; },
    get fieldErrors() { return fieldErrors; },
    set fieldErrors(value) { fieldErrors = value; },
    finishAccountDisabledReturn,
    handle2faCancel,
    handle2faVerify,
    handleChangePassword,
    handleChangePasswordCancel,
    handleDisconnect,
    handleLogin,
    handleRecoverPreferenceDek,
    get keyInteraction() { return keyInteraction; },
    set keyInteraction(value) { keyInteraction = value; },
    get keyPassphrase() { return keyPassphrase; },
    set keyPassphrase(value) { keyPassphrase = value; },
    get loadingPhase() { return loadingPhase; },
    set loadingPhase(value) { loadingPhase = value; },
    get loginMethod() { return loginMethod; },
    set loginMethod(value) { loginMethod = value; },
    measureCredential,
    get migrationResolver() { return migrationResolver; },
    set migrationResolver(value) { migrationResolver = value; },
    get migrationVisible() { return migrationVisible; },
    set migrationVisible(value) { migrationVisible = value; },
    get password() { return password; },
    set password(value) { password = value; },
    get passwordChangeRequired() { return passwordChangeRequired; },
    set passwordChangeRequired(value) { passwordChangeRequired = value; },
    get passwordInput() { return passwordInput; },
    set passwordInput(value) { passwordInput = value; },
    get passwordVisible() { return passwordVisible; },
    set passwordVisible(value) { passwordVisible = value; },
    get playConnectTransition() { return playConnectTransition; },
    set playConnectTransition(value) { playConnectTransition = value; },
    get privateKey() { return privateKey; },
    set privateKey(value) { privateKey = value; },
    get publicKeyPending() { return publicKeyPending; },
    set publicKeyPending(value) { publicKeyPending = value; },
    resolveCorruptedPreferenceDialog,
    returnFromAccountDisabled,
    get returningFromAccountDisabled() { return returningFromAccountDisabled; },
    set returningFromAccountDisabled(value) { returningFromAccountDisabled = value; },
    get serverName() { return serverName; },
    get show2faDialog() { return show2faDialog; },
    set show2faDialog(value) { show2faDialog = value; },
    get showChangePassword() { return showChangePassword; },
    set showChangePassword(value) { showChangePassword = value; },
    get showCorruptedPreferenceDialog() { return showCorruptedPreferenceDialog; },
    set showCorruptedPreferenceDialog(value) { showCorruptedPreferenceDialog = value; },
    get showForgotPasswordDialog() { return showForgotPasswordDialog; },
    set showForgotPasswordDialog(value) { showForgotPasswordDialog = value; },
    get successMessage() { return successMessage; },
    set successMessage(value) { successMessage = value; },
    switchLoginMethod,
    get username() { return username; },
    set username(value) { username = value; },
    get usernameInput() { return usernameInput; },
    set usernameInput(value) { usernameInput = value; },

  };

}

export type LoginFlowController = ReturnType<typeof createLoginFlow>;
