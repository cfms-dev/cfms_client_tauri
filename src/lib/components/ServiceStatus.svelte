<script lang="ts">
  // Displays a single service's health status as a coloured dot + label.
  //
  // MD3 styling: success for running, error for stopped.
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
    class:bg-md3-success={running}
    class:bg-md3-error={!running}
  ></span>
  <span class="text-md3-on-surface-variant">{name}</span>
  <span
    class="text-xs ml-auto"
    class:text-md3-success={running}
    class:text-md3-error={!running}
  >
    {running ? "Running" : "Stopped"}
  </span>
</div>
