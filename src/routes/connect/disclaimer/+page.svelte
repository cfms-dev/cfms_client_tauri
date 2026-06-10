<script lang="ts">
  // Disclaimer page
  //
  // Shown on first launch before connecting to a server.  The user must
  // accept the disclaimer to proceed.
  //
  // Reference: DisclaimerModel in reference/src/include/ui/models/misc/disclaimer.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { disclaimerStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let busy = $state(false);
</script>

<div class="flex items-center justify-center min-h-full p-6">
  <div class="w-full" style="max-width: 560px;">
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-6 space-y-4">
      <!-- Warning header -->
      <div class="flex items-center gap-3">
        <span class="text-md3-warning">
          <Icon name="warning" size="40px" />
        </span>
        <h1
          class="text-xl font-bold text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {$t('disclaimer.title')}
        </h1>
      </div>

      <p class="text-sm text-md3-on-surface-variant">
        {$t('disclaimer.intro')}
      </p>

      <div class="border-t border-md3-outline"></div>

      <!-- Disclaimer text -->
      <div class="text-sm text-md3-on-surface-variant space-y-3 max-h-64 overflow-y-auto
                  bg-md3-surface-container-low/40 rounded-xl p-4">
        <p>
          {$t('disclaimer.paragraph1')}
        </p>
        <p>
          {$t('disclaimer.paragraph2')}
        </p>
        <p>
          {$t('disclaimer.paragraph3')}
        </p>
        <p>
          {$t('disclaimer.paragraph4')}
        </p>
      </div>

      <div class="border-t border-md3-outline"></div>

      <p class="text-sm font-semibold text-md3-warning">
        {$t('disclaimer.responsibility')}
      </p>

      <!-- Actions -->
      <div class="flex gap-3 pt-2">
        <button
          class="flex-1 py-2.5 px-4 rounded-full font-medium
                 bg-md3-primary text-md3-on-primary
                 hover:brightness-110
                 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          style="font-family: var(--font-md3-sans);"
          onclick={async () => {
            busy = true;
            await disclaimerStore.accept();
            goto('/connect');
          }}
          disabled={busy}
        >
          <Icon name="done" size="18px" />
          {$t('disclaimer.accept')}
        </button>
        <button
          class="flex-1 py-2.5 px-4 rounded-full font-medium
                 border border-md3-error text-md3-error
                 hover:bg-md3-error-container
                 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          style="font-family: var(--font-md3-sans);"
          onclick={() => window.close()}
          disabled={busy}
        >
          <Icon name="close" size="18px" />
          {$t('disclaimer.rejectAndQuit')}
        </button>
      </div>
    </div>
  </div>
</div>
