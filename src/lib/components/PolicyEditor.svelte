<script lang="ts">
  // JSON policy editor with validation and save.
  //
  // Props:
  //   policyJson: the current policy as a JSON string
  //   onSave: callback receiving the new JSON string on save

  interface Props {
    policyJson: string;
    onSave: (json: string) => Promise<void>;
  }

  let { policyJson, onSave }: Props = $props();

  let edited = $state("");
  let error = $state<string | null>(null);
  let saving = $state(false);
  let saved = $state(false);

  // Sync from prop to local state (runs once on mount and when prop changes).
  $effect(() => {
    edited = policyJson;
    error = null;
  });

  function validate() {
    try {
      JSON.parse(edited);
      error = null;
      return true;
    } catch (e) {
      error = (e as Error).message;
      return false;
    }
  }

  async function handleSave() {
    if (!validate()) return;
    saving = true;
    saved = false;
    try {
      await onSave(edited);
      saved = true;
      setTimeout(() => (saved = false), 2000);
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between">
    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
      Security Policy (JSON)
    </span>
    <div class="flex items-center gap-2">
      {#if saved}
        <span class="text-xs text-green-600 dark:text-green-400">✓ Saved</span>
      {/if}
      <button
        class="px-3 py-1 text-xs font-medium rounded
               bg-blue-600 text-white hover:bg-blue-700
               disabled:opacity-50 transition-colors"
        onclick={handleSave}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </div>

  <textarea
    class="w-full h-64 p-3 font-mono text-sm rounded-lg border
           {error ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}
           bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100
           focus:ring-2 focus:ring-blue-500 focus:border-transparent
           resize-y"
    bind:value={edited}
    onblur={validate}
  ></textarea>

  {#if error}
    <p class="text-xs text-red-600 dark:text-red-400">
      Invalid JSON: {error}
    </p>
  {/if}

  <p class="text-xs text-gray-500 dark:text-gray-400">
    Edit the server security policy. Changes take effect after saving.
    Use valid JSON format.
  </p>
</div>
