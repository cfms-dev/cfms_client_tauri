<script lang="ts">
  import type { Snippet } from "svelte";
  import AppShell from "$lib/app/AppShell.svelte";
  let { children }: { children: Snippet } = $props();
</script>

<AppShell {children} />
