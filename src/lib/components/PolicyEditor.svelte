<script lang="ts">
  // JSON policy editor with validation and save — MD3 styled.
  //
  // Props:
  //   policyJson: the current policy as a JSON string
  //   onSave: callback receiving the new JSON string on save

  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';

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
    <span
      class="text-sm font-medium text-md3-on-surface"
      style="font-family: var(--font-md3-sans);"
    >
      {$t('policy.title')}
    </span>
    <div class="flex items-center gap-2">
      {#if saved}
        <span class="text-xs text-md3-success font-medium flex items-center gap-1">
          <Icon name="done" size="14px" /> {$t('policy.saved')}
        </span>
      {/if}
      <!-- MD3 filled button: 20px radius -->
      <button
        class="px-4 py-1.5 text-xs font-medium rounded-full
               bg-md3-primary text-md3-on-primary
               hover:brightness-110
               disabled:opacity-50 transition-all"
        style="font-family: var(--font-md3-sans);"
        onclick={handleSave}
        disabled={saving}
      >
        {saving ? $t('common.saving') : $t('common.save')}
      </button>
    </div>
  </div>

  <!-- MD3 textarea field -->
  <textarea
    class="w-full h-64 p-3 text-sm rounded-xl border
           {error ? 'border-md3-error' : 'border-md3-outline'}
           bg-md3-field text-md3-on-surface
           placeholder:text-md3-on-surface-variant
           focus:ring-2 focus:ring-md3-primary focus:border-transparent
           resize-y transition-colors"
    style="font-family: var(--font-md3-mono);"
    bind:value={edited}
    onblur={validate}
  ></textarea>

  {#if error}
    <p class="text-xs text-md3-error">
      {$t('policy.invalidJson', { values: { error } })}
    </p>
  {/if}

  <p class="text-xs text-md3-on-surface-variant">
    {$t('policy.description')}
  </p>
</div>
