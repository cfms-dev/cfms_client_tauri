<script lang="ts">
  // Animated MD3 progress bar with phase indicator.
  //
  // Props:
  //   progress: 0.0–1.0 fraction
  //   currentBytes: bytes processed
  //   totalBytes: total bytes (0 when unknown)
  //   phase: current download phase label
  //   status: task status (controls colour and animation)

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
        return "bg-md3-success";
      case "failed":
        return "bg-md3-error";
      case "paused":
        return "bg-md3-warning";
      case "cancelled":
        return "bg-md3-outline-variant";
      default:
        return "bg-md3-primary";
    }
  }

  function textColor(): string {
    switch (status) {
      case "completed":
        return "text-md3-success";
      case "failed":
        return "text-md3-error";
      case "paused":
        return "text-md3-warning";
      case "cancelled":
        return "text-md3-on-surface-variant";
      default:
        return "text-md3-on-surface-variant";
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
  const labelClass = $derived(textColor());
  const animate = $derived(isAnimating());
</script>

<div class="w-full">
  <!-- Info row -->
  <div class="flex justify-between text-xs mb-1 {labelClass}">
    <span>
      {#if phase}
        <span class="capitalize">{phase}</span>
      {/if}
      {#if status === "completed"}
        <span class="text-md3-success font-medium">Complete</span>
      {:else if status === "failed"}
        <span class="text-md3-error font-medium">Failed</span>
      {:else if status === "cancelled"}
        <span class="text-md3-on-surface-variant font-medium">Cancelled</span>
      {:else if status === "paused"}
        <span class="text-md3-warning font-medium">Paused</span>
      {/if}
    </span>
    <span>{pct}% · {formatBytes(currentBytes)}{totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ""}</span>
  </div>

  <!-- Bar — MD3 track with rounded caps -->
  <div class="w-full h-2 bg-md3-surface-container-high rounded-full overflow-hidden">
    <div
      class="h-full {barClass} rounded-full transition-all duration-300 ease-out"
      class:progress-stripe={animate}
      style="width: {Math.max(pct, animate ? 2 : 0)}%"
    ></div>
  </div>
</div>
