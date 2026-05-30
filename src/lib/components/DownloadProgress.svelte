<script lang="ts">
  // Animated progress bar with phase indicator.
  //
  // Props:
  //   progress: 0.0–1.0 fraction
  //   currentBytes: bytes processed
  //   totalBytes: total bytes (0 when unknown)
  //   phase: current download phase label
  //   status: task status (controls color and animation)

  import type { DownloadTaskStatus } from "../api";

  interface Props {
    progress: number;
    currentBytes: number;
    totalBytes: number;
    phase?: string;
    status: DownloadTaskStatus;
  }

  let { progress, currentBytes, totalBytes, phase, status }: Props = $props();

  function barColor(): string {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "paused":
        return "bg-yellow-500";
      case "cancelled":
        return "bg-gray-400";
      default:
        return "bg-blue-500";
    }
  }

  function isAnimating(): boolean {
    return ["downloading", "decrypting", "verifying"].includes(status);
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KiB", "MiB", "GiB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
  }

  const pct = $derived(Math.round(progress * 100));
  const barClass = $derived(barColor());
  const animate = $derived(isAnimating());
</script>

<div class="w-full">
  <!-- Info row -->
  <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
    <span>
      {#if phase}
        <span class="capitalize">{phase}</span>
      {/if}
      {#if status === "completed"}
        <span class="text-green-600 dark:text-green-400 font-medium">Complete</span>
      {:else if status === "failed"}
        <span class="text-red-600 dark:text-red-400 font-medium">Failed</span>
      {:else if status === "cancelled"}
        <span class="text-gray-500 font-medium">Cancelled</span>
      {:else if status === "paused"}
        <span class="text-yellow-600 dark:text-yellow-400 font-medium">Paused</span>
      {/if}
    </span>
    <span>{pct}% · {formatBytes(currentBytes)}{totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ""}</span>
  </div>

  <!-- Bar -->
  <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
    <div
      class="h-full {barClass} rounded-full transition-all duration-300 ease-out"
      class:progress-stripe={animate}
      style="width: {Math.max(pct, animate ? 2 : 0)}%"
    ></div>
  </div>
</div>
