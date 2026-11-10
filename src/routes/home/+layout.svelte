<script lang="ts">
  import type { Snippet } from "svelte";
  import WorkspaceShell from "$lib/app/WorkspaceShell.svelte";
  let { children }: { children: Snippet } = $props();
</script>

<WorkspaceShell {children} />
