<script lang="ts">
  // CFMS Client — Admin / Settings page
  //
  // Security policy editor, connection settings, and cache management.

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
    <h1 class="text-xl font-bold">Admin & Settings</h1>
    <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
      Manage security policies and application settings.
    </p>
  </div>

  {#if message}
    <div class="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800
                text-green-700 dark:text-green-300 text-sm rounded-lg p-3">
      {message}
    </div>
  {/if}

  {#if loading}
    <p class="text-sm text-gray-400">Loading settings…</p>
  {:else}
    <!-- Policy editor -->
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <PolicyEditor policyJson={policyJson} onSave={savePolicy} />
    </div>

    <!-- Connection settings -->
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h2 class="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
        Connection Settings (JSON)
      </h2>
      <textarea
        class="w-full h-32 p-3 font-mono text-sm rounded-lg border
               border-gray-300 dark:border-gray-600
               bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100
               focus:ring-2 focus:ring-blue-500 focus:border-transparent
               resize-y"
        bind:value={connectionSettings}
      ></textarea>
      <div class="flex justify-end mt-2">
        <button
          class="px-3 py-1 text-xs font-medium rounded
                 bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          onclick={() => saveConnectionSettings(connectionSettings)}
        >
          Save Settings
        </button>
      </div>
    </div>

    <!-- About -->
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h2 class="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
        About CFMS Client
      </h2>
      <div class="text-sm text-gray-600 dark:text-gray-400 space-y-1 max-w-lg">
        <p><strong>Protocol Version:</strong> {protoVer}</p>
        {#if cryptoInfoData}
          <p>
            <strong>Encryption:</strong> AES-256-GCM ·
            PBKDF2-HMAC-SHA256 ({cryptoInfoData.kdf_iterations.toLocaleString()} iterations)
          </p>
        {/if}
        <p><strong>Transport:</strong> WSS (WebSocket Secure) with frame multiplexing</p>
        <p><strong>Storage:</strong> SQLite (WAL mode)</p>
        <p><strong>Frontend:</strong> Svelte 5 + TailwindCSS v4</p>
      </div>
    </div>
  {/if}
</div>
