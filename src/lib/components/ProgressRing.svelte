<script lang="ts">
  interface Props {
    size?: number | string;
    strokeWidth?: number;
    class?: string;
    label?: string;
  }

  let {
    size = 24,
    strokeWidth = 3,
    class: className = '',
    label = 'Loading',
  }: Props = $props();

  const normalizedSize = $derived(
    typeof size === 'number' ? `${size}px` : size,
  );
  const radius = $derived(22 - strokeWidth / 2);
  const circumference = $derived(2 * Math.PI * radius);
</script>

<span
  class="md-progress-ring inline-flex items-center justify-center text-md3-primary-emphasis {className}"
  style="width: {normalizedSize}; height: {normalizedSize};"
  role="status"
  aria-label={label}
>
  <svg class="h-full w-full" viewBox="0 0 44 44" aria-hidden="true">
    <circle
      class="md-progress-ring__track"
      cx="22"
      cy="22"
      r={radius}
      fill="none"
      stroke-width={strokeWidth}
    />
    <circle
      class="md-progress-ring__indicator"
      cx="22"
      cy="22"
      r={radius}
      fill="none"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-dasharray={circumference}
    />
  </svg>
</span>

<style>
  .md-progress-ring {
    color: var(--color-md3-primary-emphasis);
  }

  .md-progress-ring svg {
    animation: md-progress-rotate 1.4s linear infinite;
  }

  .md-progress-ring__track {
    stroke: color-mix(in srgb, currentColor 18%, transparent);
  }

  .md-progress-ring__indicator {
    stroke: currentColor;
    transform-origin: center;
    animation: md-progress-dash 1.4s ease-in-out infinite;
  }

  @keyframes md-progress-rotate {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes md-progress-dash {
    0% {
      stroke-dashoffset: 126;
      transform: rotate(0deg);
    }
    50% {
      stroke-dashoffset: 32;
      transform: rotate(45deg);
    }
    100% {
      stroke-dashoffset: 126;
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .md-progress-ring svg,
    .md-progress-ring__indicator {
      animation-duration: 2.4s;
    }
  }
</style>
