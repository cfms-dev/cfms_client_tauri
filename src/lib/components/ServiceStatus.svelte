<script lang="ts">
  // Displays a single service's health status as a colored badge + label.
  //
  // Props:
  //   name: service display name
  //   running: whether the service is currently active

  interface Props {
    name: string;
    running: boolean;
  }

  let { name, running }: Props = $props();
</script>

<div class="flex items-center gap-2 text-sm">
  <span
    class="inline-block w-2 h-2 rounded-full shrink-0"
    class:bg-green-500={running}
    class:bg-red-400={!running}
    class:animate-pulse={running}
  ></span>
  <span class="text-gray-700 dark:text-gray-300">{name}</span>
  <span class="text-xs ml-auto {running ? 'text-green-600 dark:text-green-400' : 'text-red-500'}">
    {running ? "Running" : "Stopped"}
  </span>
</div>
