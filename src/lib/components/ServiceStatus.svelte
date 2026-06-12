<script lang="ts">
  // Displays a single service's health status as a coloured dot + label.
  //
  // MD3 styling: success for running, error for stopped.
  //
  // Props:
  //   name: service display name
  //   running: whether the service is currently active

  import { _ as t } from 'svelte-i18n';

  interface Props {
    name: string;
    running: boolean;
  }

  let { name, running }: Props = $props();
</script>

<div class="flex items-center gap-2 text-sm animate-fade-scale-in">
  <span class:running class:stopped={!running} class="status-orb" aria-hidden="true">
    <span></span>
  </span>
  <span class="text-md3-on-surface-variant">{name}</span>
  <span
    class="text-xs ml-auto"
    class:text-md3-success={running}
    class:text-md3-error={!running}
  >
    {running ? $t('home.serviceRunning') : $t('home.serviceStopped')}
  </span>
</div>

<style>
  .status-orb {
    position: relative;
    display: inline-grid;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    place-items: center;
  }

  .status-orb::before {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    content: "";
    opacity: 0;
    transform: scale(0.72);
  }

  .status-orb span {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    box-shadow: 0 0 12px currentColor;
  }

  .status-orb.running {
    color: var(--color-md3-success);
  }

  .status-orb.running::before {
    background: color-mix(in srgb, var(--color-md3-success) 36%, transparent);
    animation: service-pulse 1.8s var(--motion-easing-emphasized) infinite;
  }

  .status-orb.running span {
    background: var(--color-md3-success);
  }

  .status-orb.stopped {
    color: var(--color-md3-error);
  }

  .status-orb.stopped span {
    background: var(--color-md3-error);
    box-shadow: none;
  }

  @keyframes service-pulse {
    0% {
      opacity: 0.7;
      transform: scale(0.72);
    }
    70% {
      opacity: 0;
      transform: scale(1.38);
    }
    100% {
      opacity: 0;
      transform: scale(1.38);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status-orb.running::before {
      animation: none;
    }
  }
</style>
