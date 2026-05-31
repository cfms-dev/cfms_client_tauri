<script lang="ts">
  // Root entry page — the auth guard in +layout.svelte handles
  // redirecting based on auth state. This page exists so the static
  // adapter generates index.html for Tauri to load.
</script>

<svelte:head>
  <title>CFMS Client</title>
</svelte:head>

<div class="flex h-full items-center justify-center">
  <!-- Brief loading placeholder shown while the auth guard redirects. -->
</div>
