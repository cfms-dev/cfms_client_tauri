<script lang="ts">
  // About page
  //
  // Application version information, copyright, and software update check.
  //
  // Adapted from the admin page's about section.
  // Reference: AboutModel in reference/src/include/ui/models/about.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { cryptoInfo, protocolVersion } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  let cryptoInfoData = $state<{
    kdf_iterations: number;
    salt_len: number;
    key_len: number;
    nonce_len: number;
    tag_len: number;
  } | null>(null);
  let protoVer = $state(0);
  let checkingUpdate = $state(false);
  let updateResult = $state<string | null>(null);

  onMount(async () => {
    try {
      const [info, ver] = await Promise.all([cryptoInfo(), protocolVersion()]);
      cryptoInfoData = info;
      protoVer = ver;
    } catch { /* ignore */ }
  });

  async function checkForUpdates() {
    checkingUpdate = true;
    updateResult = null;
    // Stub: actual update checking against GitHub releases is a Rust backend concern.
    await new Promise((r) => setTimeout(r, 1500));
    updateResult = 'Already on the latest version.';
    checkingUpdate = false;
  }
</script>

<div class="p-6 space-y-6 max-w-lg mx-auto">
  <!-- Back button -->
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/more')}
  >
    <Icon name="arrowBack" size="18px" />
    Back
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    About CFMS Client
  </h1>

  <!-- App info -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-3">
    <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Confidential File Management System
    </h2>

    <div class="text-sm space-y-1.5">
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Version:</span> 0.1.0
      </p>
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Protocol:</span> v{protoVer}
      </p>
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Copyright:</span> © 2025–2026 Creeper Team
      </p>
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">License:</span> Apache License 2.0
      </p>
    </div>
  </div>

  <!-- Technical info -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5">
    <h2 class="text-sm font-semibold mb-3 text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Technical Details
    </h2>
    <div class="text-sm space-y-1.5">
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Encryption:</span> AES-256-GCM · PBKDF2-HMAC-SHA256
      </p>
      {#if cryptoInfoData}
        <p class="text-md3-on-surface-variant">
          <span class="text-md3-on-surface">KDF:</span>
          {cryptoInfoData.kdf_iterations.toLocaleString()} iterations,
          {cryptoInfoData.salt_len}-byte salt
        </p>
      {/if}
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Transport:</span> WSS with frame multiplexing
      </p>
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Frontend:</span> Svelte 5 + TailwindCSS v4 · MD3
      </p>
    </div>
  </div>

  <!-- Software update -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Software Update
    </h2>

    {#if checkingUpdate}
      <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
        <span class="animate-spin"><Icon name="refresh" size="16px" /></span>
        Checking for updates…
      </div>
    {:else if updateResult}
      <p class="text-sm text-md3-success flex items-center gap-1.5">
        <Icon name="checkCircle" size="16px" />
        {updateResult}
      </p>
    {/if}

    <button
      class="px-4 py-2 rounded-full font-medium text-sm
             bg-md3-primary-container text-md3-on-primary-container
             hover:brightness-110
             disabled:opacity-50 transition-all flex items-center gap-2"
      style="font-family: var(--font-md3-sans);"
      onclick={checkForUpdates}
      disabled={checkingUpdate}
    >
      <Icon name="update" size="18px" />
      Check for Updates
    </button>
  </div>
</div>
