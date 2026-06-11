<script lang="ts">
  // Animated MD3 progress bar with phase indicator.
  //
  // Props:
  //   progress: 0.0–1.0 fraction
  //   currentBytes: bytes processed (may be 0 during transfer)
  //   totalBytes: total bytes (0 when unknown)
  //   message: human-readable description of the current step
  //   phase: current download phase label
  //   status: task status (controls colour and animation)

  import type { DownloadTaskStatus } from "../api";
  import { _ as t } from 'svelte-i18n';

  interface Props {
    progress: number;
    currentBytes: number;
    totalBytes: number;
    message?: string | null;
    phase?: string;
    status: DownloadTaskStatus;
    completedText?: string;
  }

  let { progress, currentBytes, totalBytes, message, phase, status, completedText }: Props = $props();

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
  <!-- Info row (mirrors reference _get_progress_info) -->
  <div class="flex justify-between text-xs mb-1 {labelClass}">
    <span>
      {#if phase}
        <span class="capitalize">{phase}</span>
      {/if}
      {#if status === "completed"}
        <span class="text-md3-success font-medium">{$t('tasks.complete')}</span>
      {:else if status === "failed"}
        <span class="text-md3-error font-medium">{$t('tasks.failed')}</span>
      {:else if status === "cancelled"}
        <span class="text-md3-on-surface-variant font-medium">{$t('tasks.cancelled')}</span>
      {:else if status === "paused"}
        <span class="text-md3-warning font-medium">{$t('tasks.paused')}</span>
      {/if}
    </span>
    <span>
      {#if status === "completed"}
        {completedText ?? $t('tasks.downloadCompleted')}
      {:else if status === "failed" || status === "cancelled"}
        <!-- empty — reference shows nothing for these statuses -->
      {:else if totalBytes > 0}
        {formatBytes(currentBytes)} / {formatBytes(totalBytes)} ({pct}%)
      {:else if progress > 0}
        {pct}%
      {:else}
        {$t('tasks.waitingToStart')}
      {/if}
    </span>
  </div>

  <!-- Bar — MD3 track with rounded caps -->
  <div class="relative w-full h-2 bg-md3-surface-container-high rounded-full overflow-hidden">
    {#if totalBytes === 0 && animate}
      <div
        class="absolute inset-0 bg-gradient-to-r from-transparent via-md3-on-surface/10 to-transparent animate-shimmer"
      ></div>
    {/if}
    <div
      class="relative h-full {barClass} rounded-full transition-[width] duration-300 ease-out overflow-hidden"
      style="width: {Math.max(pct, animate ? 2 : 0)}%"
    >
      {#if animate}
        <span class="absolute inset-0 animate-progress-stripe"></span>
      {/if}
    </div>
  </div>
</div>
