<script lang="ts">
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import { navigateUp } from '$lib/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  interface Props {
    title: string;
    description?: string;
    icon?: IconName;
    resetDisabled?: boolean;
    resetLabel?: string;
    onReset?: () => void | Promise<void>;
  }

  let {
    title,
    description,
    icon,
    resetDisabled = false,
    resetLabel,
    onReset,
  }: Props = $props();
</script>

<div class="space-y-4">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant transition-colors hover:text-md3-on-surface"
    style="font-family: var(--font-md3-sans);"
    onclick={() => navigateUp(page.url.pathname)}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 items-center gap-3">
      {#if icon}
        <span class="grid h-[52px] w-[52px] shrink-0 place-items-center text-md3-primary-emphasis" aria-hidden="true">
          <Icon name={icon} size="28px" />
        </span>
      {/if}
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {title}
        </h1>
        {#if description}
          <p class="text-xs text-md3-on-surface-variant">
            {description}
          </p>
        {/if}
      </div>
    </div>

    {#if onReset}
      <button
        class="settings-reset-button"
        type="button"
        onclick={onReset}
        disabled={resetDisabled}
      >
        <Icon name="restartAlt" size="18px" />
        <span>{resetLabel ?? $t('common.reset')}</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .settings-reset-button {
    display: inline-flex;
    min-block-size: 36px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 9999px;
    background: var(--color-md3-surface-container-high);
    color: var(--color-md3-on-surface);
    padding: 0 0.85rem;
    font-family: var(--font-md3-sans);
    font-size: 0.8125rem;
    font-weight: 650;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  .settings-reset-button:hover:not(:disabled) {
    background: var(--color-md3-surface-container-highest);
    transform: translateY(-1px);
  }

  .settings-reset-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (max-width: 420px) {
    .settings-reset-button span {
      display: none;
    }

    .settings-reset-button {
      inline-size: 36px;
      padding: 0;
    }
  }
</style>
