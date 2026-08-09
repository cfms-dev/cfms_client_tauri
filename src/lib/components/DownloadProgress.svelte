<script lang="ts">
  // Animated MD3 progress bar with phase indicator.
  //
  // Props:
  //   progress: 0.0–1.0 fraction
  //   currentBytes: bytes processed (may be 0 during transfer)
  //   totalBytes: total bytes (0 when unknown)
  //   status: task status (controls colour and animation)

  import type { DownloadTaskStatus } from "../api";
  import { _ as t } from 'svelte-i18n';
  import { formatByteRate } from '$lib/transfer-speed';

  interface Props {
    progress: number;
    currentBytes: number;
    totalBytes: number;
    status: DownloadTaskStatus;
    completedText?: string;
    ariaLabel?: string;
    bytesPerSecond?: number;
  }

  let { progress, currentBytes, totalBytes, status, completedText, ariaLabel, bytesPerSecond = 0 }: Props = $props();

  function barColor(): string {
    switch (status) {
      case "completed":
        return "bg-md3-success";
      case "failed":
        return "bg-md3-error";
      case "paused":
        return "bg-md3-warning";
      case "cancelled":
      case "deleted":
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
      case "deleted":
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
      {#if status === "failed"}
        <span class="text-md3-error font-medium">{$t('tasks.failed')}</span>
      {:else if status === "cancelled"}
        <span class="text-md3-on-surface-variant font-medium">{$t('tasks.cancelled')}</span>
      {:else if status === "deleted"}
        <span class="text-md3-on-surface-variant font-medium">{$t('tasks.fileDeleted')}</span>
      {:else if status === "paused"}
        <span class="text-md3-warning font-medium">{$t('tasks.paused')}</span>
      {/if}
    </span>
    <span>
      {#if status === "completed"}
        {completedText ?? $t('tasks.downloadCompleted')}
      {:else if status === "failed" || status === "cancelled" || status === "deleted"}
        <!-- empty — reference shows nothing for these statuses -->
      {:else if totalBytes > 0}
        {formatBytes(currentBytes)} / {formatBytes(totalBytes)} ({pct}%){#if bytesPerSecond > 0} · {formatByteRate(bytesPerSecond)}{/if}
      {:else if progress > 0}
        {pct}%{#if bytesPerSecond > 0} · {formatByteRate(bytesPerSecond)}{/if}
      {:else if bytesPerSecond > 0}
        {formatByteRate(bytesPerSecond)}
      {:else}
        {$t('tasks.waitingToStart')}
      {/if}
    </span>
  </div>

  <!-- Bar — MD3 track with rounded caps -->
  <div
    class="transfer-progress relative w-full h-1.5 bg-md3-surface-container-high rounded-full overflow-hidden"
    role="progressbar"
    aria-label={ariaLabel ?? $t('tasks.progress')}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={totalBytes > 0 ? pct : undefined}
    aria-valuetext={totalBytes > 0 ? `${pct}%` : $t('tasks.progressUnknown')}
  >
    {#if totalBytes === 0 && animate}
      <div
        class="absolute inset-0 bg-gradient-to-r from-transparent via-md3-on-surface/10 to-transparent animate-shimmer"
      ></div>
    {/if}
    <div
      class="transfer-progress-value relative h-full {barClass} rounded-full overflow-hidden"
      style="width: {Math.max(pct, animate ? 2 : 0)}%"
    >
      {#if animate}
        <span class="absolute inset-0 animate-progress-stripe"></span>
      {/if}
    </div>
  </div>
</div>

<style>
  .transfer-progress-value {
    transition: width var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate);
  }

  @media (prefers-reduced-motion: reduce) {
    .transfer-progress-value {
      transition: none;
    }

    .transfer-progress :global(.animate-shimmer),
    .transfer-progress :global(.animate-progress-stripe) {
      animation: none !important;
    }
  }
</style>
