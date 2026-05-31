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

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores.svelte';
  import { login, disconnect, logout, getAuthStatus } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import AvatarPreview from '$lib/components/AvatarPreview.svelte';
  import TwoFactorVerifyDialog from '$lib/components/TwoFactorVerifyDialog.svelte';

  let username = $state('');
  let password = $state('');
  let passwordVisible = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let fieldErrors = $state<{ username?: string; password?: string }>({});
  let loadingPhase = $state('');

  // 2FA state
  let show2faDialog = $state(false);
  // The temporary password is kept in memory during 2FA so we can re-send
  // the login request with the verification code.
  let pendingPassword = $state('');

  // Loading phases after successful login (matching reference's DataLoadingView).
  const loadingPhases = [
    'Loading user data…',
    'Setting up encryption…',
    'Downloading avatar…',
    'Loading tasks…',
  ];

  const serverName = $derived(authStore.serverAddress ?? 'CFMS Server');

  // If already logged in, go straight to home.
  onMount(() => {
    if (authStore.isLoggedIn) {
      goto('/home/overview');
    }
  });

  /** Validate fields before submitting. Returns true if valid. */
  function validate(): boolean {
    fieldErrors = {};
    let valid = true;
    if (!username.trim()) {
      fieldErrors.username = 'Username is required.';
      valid = false;
    }
    if (!password) {
      fieldErrors.password = 'Password is required.';
      valid = false;
    }
    return valid;
  }

  /** Run the post-login loading phase animation. */
  async function runLoadingPhases() {
    for (let i = 0; i < loadingPhases.length; i++) {
      loadingPhase = loadingPhases[i];
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /** Format an error message for display. */
  function formatError(e: unknown): string {
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    return 'An unknown error occurred.';
  }

  async function handleLogin() {
    if (!validate()) return;

    busy = true;
    error = null;
    loadingPhase = loadingPhases[0];

    try {
      const authResult = await login(username, password);

      // Check if server requires 2FA.
      if (authResult.requires_2fa) {
        authStore.apply(authResult);
        // Keep password in memory for the 2FA re-submit.
        pendingPassword = password;
        show2faDialog = true;
        loadingPhase = '';
        return;
      }

      // Regular success — run loading phases and navigate.
      await runLoadingPhases();

      authStore.apply(authResult);

      // Refresh full auth status after login.
      const updated = await getAuthStatus();
      authStore.apply(updated);

      // Clear password from JS memory.
      password = '';
      pendingPassword = '';

      // Navigate to home.
      goto('/home/overview');
    } catch (e) {
      error = formatError(e);
      loadingPhase = '';
    } finally {
      busy = false;
    }
  }

  /** Callback from TwoFactorVerifyDialog — re-sends login with 2FA code. */
  async function handle2faVerify(
    code: string,
    isRecoveryCode: boolean,
  ): Promise<boolean> {
    try {
      const authResult = await login(username, pendingPassword, code);

      if (authResult.requires_2fa) {
        // Still requires 2FA — shouldn't happen, but handle gracefully.
        return false;
      }

      // Success — complete login.
      await runLoadingPhases();

      authStore.apply(authResult);

      const updated = await getAuthStatus();
      authStore.apply(updated);

      // Clear sensitive data.
      password = '';
      pendingPassword = '';

      // Close dialog and navigate.
      show2faDialog = false;
      goto('/home/overview');

      return true;
    } catch (e) {
      // Let the dialog handle the error display.
      return false;
    }
  }

  /** Callback from TwoFactorVerifyDialog — user cancelled 2FA. */
  function handle2faCancel() {
    show2faDialog = false;
    pendingPassword = '';
    // Clear the partial auth state so the user can try again.
    // Just clear the 2FA flag and keep them on the login page.
    authStore.requires2fa = false;
  }

  async function handleDisconnect() {
    busy = true;
    error = null;
    try {
      await disconnect();
      await logout();
      authStore.clear();
      goto('/connect');
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex items-center justify-center min-h-full p-6">
  <div class="w-full" style="max-width: 420px;">
    {#if busy && loadingPhase}
      <!-- Data loading state -->
      <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                  border border-md3-outline p-10 text-center space-y-4">
        <div class="flex justify-center">
          <span class="animate-spin text-md3-primary">
            <Icon name="refresh" size="36px" />
          </span>
        </div>
        <p
          class="text-sm font-medium text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {loadingPhase}
        </p>
        <p class="text-xs text-md3-on-surface-variant">
          Please wait while your session is being set up.
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
          Connected — sign in to continue
        </p>
      </div>

      <!-- Avatar preview -->
      <div class="flex justify-center mb-6">
        {#if username.trim()}
          <AvatarPreview username={username} size={80} />
        {:else}
          <div class="w-20 h-20 rounded-full bg-md3-surface-container-high
                      flex items-center justify-center">
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
            Username
          </label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
              <Icon name="accountCircle" size="18px" />
            </span>
            <input
              id="username"
              type="text"
              class="w-full pl-10 pr-3.5 py-2.5 rounded-xl border
                     {fieldErrors.username ? 'border-md3-error' : 'border-md3-outline'}
                     bg-md3-field text-md3-on-surface text-sm
                     placeholder:text-md3-on-surface-variant
                     focus:ring-2 focus:ring-md3-primary focus:border-transparent
                     transition-colors"
              placeholder="Enter your username"
              bind:value={username}
              disabled={busy}
              autocomplete="username"
            />
          </div>
          {#if fieldErrors.username}
            <p class="text-xs text-md3-error mt-1 ml-1">{fieldErrors.username}</p>
          {/if}
        </div>

        <!-- Password -->
        <div>
          <label
            for="password"
            class="block text-sm font-medium mb-1.5 text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
          >
            Password
          </label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
              <Icon name="password" size="18px" />
            </span>
            <input
              id="password"
              type={passwordVisible ? 'text' : 'password'}
              class="w-full pl-10 pr-10 py-2.5 rounded-xl border
                     {fieldErrors.password ? 'border-md3-error' : 'border-md3-outline'}
                     bg-md3-field text-md3-on-surface text-sm
                     placeholder:text-md3-on-surface-variant
                     focus:ring-2 focus:ring-md3-primary focus:border-transparent
                     transition-colors"
              placeholder="Enter your password"
              bind:value={password}
              disabled={busy}
              autocomplete="current-password"
            />
            <button
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant
                     hover:text-md3-on-surface transition-colors"
              onclick={() => (passwordVisible = !passwordVisible)}
              tabindex="-1"
              aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            >
              <Icon name={passwordVisible ? 'visibility' : 'visibility'} size="18px" />
            </button>
          </div>
          {#if fieldErrors.password}
            <p class="text-xs text-md3-error mt-1 ml-1">{fieldErrors.password}</p>
          {/if}
        </div>

        <!-- Error — MD3 error container -->
        {#if error}
          <div class="bg-md3-error-container/60 border border-md3-error/30
                      text-md3-on-error-container text-sm rounded-xl p-3 flex items-start gap-2">
            <span class="shrink-0 mt-0.5"><Icon name="errorFilled" size="16px" /></span>
            <span>{error}</span>
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
            Disconnect
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
              <span class="animate-spin"><Icon name="refresh" size="18px" /></span>
              Signing in…
            {:else}
              <Icon name="login" size="20px" />
              Login
            {/if}
          </button>
        </div>
      </form>
    {/if}
  </div>
</div>

<!-- 2FA Verification Dialog -->
{#if show2faDialog}
  <TwoFactorVerifyDialog
    onVerify={handle2faVerify}
    onCancel={handle2faCancel}
    method={authStore.twofaMethod}
  />
{/if}
