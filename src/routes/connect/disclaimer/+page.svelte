<script lang="ts">
  // Disclaimer page
  //
  // Shown on first launch before connecting to a server.  The user must
  // accept the disclaimer to proceed.
  //
  // Reference: DisclaimerModel in reference/src/include/ui/models/misc/disclaimer.py

  import { goto } from '$app/navigation';
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
          Disclaimer
        </h1>
      </div>

      <p class="text-sm text-md3-on-surface-variant">
        Please read and accept the disclaimer before using the application.
      </p>

      <div class="border-t border-md3-outline"></div>

      <!-- Disclaimer text -->
      <div class="text-sm text-md3-on-surface-variant space-y-3 max-h-64 overflow-y-auto
                  bg-md3-surface-container-low/40 rounded-xl p-4">
        <p>
          This software is provided "as is", without warranty of any kind, express or
          implied, including but not limited to the warranties of merchantability,
          fitness for a particular purpose and noninfringement.
        </p>
        <p>
          In no event shall the authors or copyright holders be liable for any claim,
          damages or other liability, whether in an action of contract, tort or otherwise,
          arising from, out of or in connection with the software or the use or other
          dealings in the software.
        </p>
        <p>
          This application connects to remote servers over encrypted WebSocket (WSS)
          connections. You are responsible for ensuring that you have proper authorization
          to access any server you connect to.
        </p>
        <p>
          All cryptographic operations are performed locally using industry-standard
          algorithms (AES-256-GCM, PBKDF2-HMAC-SHA256). The application does not transmit
          plaintext credentials or encryption keys over the network.
        </p>
      </div>

      <div class="border-t border-md3-outline"></div>

      <p class="text-sm font-semibold text-md3-warning">
        You are solely responsible for your use of this application and compliance
        with applicable laws and regulations.
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
          Accept
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
          Reject and Quit
        </button>
      </div>
    </div>
  </div>
</div>
