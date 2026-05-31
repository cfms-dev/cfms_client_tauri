<script lang="ts">
  // Lockdown screen
  //
  // Full-screen overlay shown when the server is in emergency lockdown mode.
  // Prevents all interaction except quitting the application.
  //
  // Reference: LockdownModel in reference/src/include/ui/models/misc/lockdown.py

  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';

  let currentTime = $state('');

  let timerInterval: ReturnType<typeof setInterval> | null = null;

  function updateClock() {
    const now = new Date();
    currentTime = now.toLocaleTimeString('en-US', { hour12: false });
  }

  onMount(() => {
    updateClock();
    timerInterval = setInterval(updateClock, 500);
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  });
</script>

<div class="fixed inset-0 z-50 bg-md3-surface flex items-center justify-center">
  <div class="text-center space-y-6 p-8 max-w-md">
    <!-- Lockdown icon -->
    <div class="flex justify-center">
      <span class="text-md3-error">
        <Icon name="emergencyHome" size="64px" />
      </span>
    </div>

    <h1
      class="text-2xl font-bold text-md3-on-surface"
      style="font-family: var(--font-md3-sans);"
    >
      Lockdown
    </h1>

    <p class="text-sm text-md3-on-surface-variant leading-relaxed">
      The server is currently under lockdown. All file operations are suspended
      and the connection is being held. Please contact your system administrator
      for more information.
    </p>

    <!-- Live clock -->
    <div
      class="text-3xl font-mono text-md3-on-surface tracking-wider"
      style="font-family: var(--font-md3-mono);"
    >
      {currentTime || '--:--:--'}
    </div>

    <div class="border-t border-md3-outline pt-4">
      <p class="text-xs text-md3-on-surface-variant mb-4">
        Wait until the state is lifted or
      </p>
      <button
        class="px-8 py-2.5 rounded-full font-medium
               border border-md3-error text-md3-error
               hover:bg-md3-error-container
               transition-all flex items-center justify-center gap-2 mx-auto"
        style="font-family: var(--font-md3-sans);"
        onclick={() => window.close()}
      >
        <Icon name="close" size="18px" />
        Quit
      </button>
    </div>
  </div>
</div>
