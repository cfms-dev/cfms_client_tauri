<script lang="ts">
  // CFMS Client — Admin / Settings page
  //
  // Security policy editor, connection settings, and cache management.
  //
  // MD3: card sections with surface-container backgrounds,
  // monospace textarea fields, filled primary buttons.

  import { onMount } from "svelte";
  import { getSetting, setSetting, cryptoInfo, protocolVersion } from "$lib/api";
  import PolicyEditor from "$lib/components/PolicyEditor.svelte";

  const POLICY_KEY = "admin_policy_json";
  const SETTINGS_KEY = "connection_settings";

  let policyJson = $state("{}");
  let connectionSettings = $state("{}");
  let loading = $state(true);
  let message = $state<string | null>(null);

  let cryptoInfoData = $state<{
    kdf_iterations: number;
    salt_len: number;
    key_len: number;
    nonce_len: number;
    tag_len: number;
  } | null>(null);
  let protoVer = $state(0);

  onMount(async () => {
    try {
      const [policy, settings, info, ver] = await Promise.all([
        getSetting(POLICY_KEY),
        getSetting(SETTINGS_KEY),
        cryptoInfo(),
        protocolVersion(),
      ]);
      policyJson = policy ?? JSON.stringify({ version: 1, rules: [] }, null, 2);
      connectionSettings = settings ?? JSON.stringify({ tls_version: "1.3" }, null, 2);
      cryptoInfoData = info;
      protoVer = ver;
    } catch (e) {
      message = `Failed to load settings: ${e}`;
    } finally {
      loading = false;
    }
  });

  async function savePolicy(json: string) {
    await setSetting(POLICY_KEY, json);
    policyJson = json;
    message = "Policy saved successfully.";
    setTimeout(() => (message = null), 3000);
  }

  async function saveConnectionSettings(json: string) {
    try {
      JSON.parse(json); // validate
      await setSetting(SETTINGS_KEY, json);
      connectionSettings = json;
      message = "Settings saved successfully.";
      setTimeout(() => (message = null), 3000);
    } catch {
      message = "Invalid JSON — settings not saved.";
    }
  }
</script>

<div class="p-6 space-y-6">
  <div>
    <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Admin & Settings
    </h1>
    <p class="text-sm text-md3-on-surface-variant mt-1">
      Manage security policies and application settings.
    </p>
  </div>

  <!-- Success / info message -->
  {#if message}
    <div class="bg-md3-success-container/60 border border-md3-success/30
                text-md3-on-success-container text-sm rounded-xl p-3"
         style="font-family: var(--font-md3-sans);">
      {message}
    </div>
  {/if}

  {#if loading}
    <p class="text-sm text-md3-on-surface-variant">Loading settings…</p>
  {:else}
    <!-- Policy editor — MD3 card -->
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <PolicyEditor policyJson={policyJson} onSave={savePolicy} />
    </div>

    <!-- Connection settings — MD3 card -->
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <h2 class="text-sm font-semibold mb-3 text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        Connection Settings (JSON)
      </h2>
      <textarea
        class="w-full h-32 p-3 text-sm rounded-xl border
               border-md3-outline
               bg-md3-field text-md3-on-surface
               placeholder:text-md3-on-surface-variant
               focus:ring-2 focus:ring-md3-primary focus:border-transparent
               resize-y transition-colors"
        style="font-family: var(--font-md3-mono);"
        bind:value={connectionSettings}
      ></textarea>
      <div class="flex justify-end mt-3">
        <!-- MD3 filled button -->
        <button
          class="px-4 py-1.5 text-xs font-medium rounded-full
                 bg-md3-primary text-md3-on-primary
                 hover:brightness-110 transition-all"
          style="font-family: var(--font-md3-sans);"
          onclick={() => saveConnectionSettings(connectionSettings)}
        >
          Save Settings
        </button>
      </div>
    </div>

    <!-- About — MD3 card -->
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <h2 class="text-sm font-semibold mb-3 text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        About CFMS Client
      </h2>
      <div class="text-sm text-md3-on-surface-variant space-y-1.5 max-w-lg">
        <p>
          <strong class="text-md3-on-surface">Protocol Version:</strong> {protoVer}
        </p>
        {#if cryptoInfoData}
          <p>
            <strong class="text-md3-on-surface">Encryption:</strong>
            AES-256-GCM · PBKDF2-HMAC-SHA256
            ({cryptoInfoData.kdf_iterations.toLocaleString()} iterations)
          </p>
        {/if}
        <p>
          <strong class="text-md3-on-surface">Transport:</strong>
          WSS (WebSocket Secure) with frame multiplexing
        </p>
        <p>
          <strong class="text-md3-on-surface">Storage:</strong> SQLite (WAL mode)
        </p>
        <p>
          <strong class="text-md3-on-surface">Frontend:</strong>
          Svelte 5 + TailwindCSS v4 · Material Design 3
        </p>
      </div>
    </div>
  {/if}
</div>
