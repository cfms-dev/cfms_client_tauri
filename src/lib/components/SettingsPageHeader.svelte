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

<div class="settings-page-header">
  <button
    class="settings-back-button"
    type="button"
    onclick={() => navigateUp(page.url.pathname)}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="settings-heading-row">
    <div class="settings-heading">
      {#if icon}
        <span class="settings-heading-icon" aria-hidden="true">
          <Icon name={icon} size="28px" />
        </span>
      {/if}
      <div class="settings-heading-copy">
        <h1>{title}</h1>
        {#if description}
          <p>{description}</p>
        {/if}
      </div>
    </div>

    {#if onReset}
      <button
        class="settings-reset-button"
        type="button"
        onclick={onReset}
        disabled={resetDisabled}
        title={resetLabel ?? $t('common.reset')}
        aria-label={resetLabel ?? $t('common.reset')}
      >
        <Icon name="resetSettings" size="20px" />
      </button>
    {/if}
  </div>
</div>

<style>
  .settings-page-header {
    display: grid;
    gap: 1rem;
  }

  .settings-back-button {
    display: inline-flex;
    min-height: 34px;
    width: fit-content;
    align-items: center;
    gap: 0.42rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 5px);
    padding: 0.35rem 0.55rem 0.35rem 0.45rem;
    color: var(--color-md3-on-surface-variant);
    background: transparent;
    font: 600 0.78rem/1 var(--font-md3-sans);
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .settings-back-button:hover {
    border-color: var(--color-md3-outline);
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .settings-back-button:active {
    transform: scale(0.97);
  }

  .settings-heading-row,
  .settings-heading {
    display: flex;
    min-width: 0;
    align-items: flex-start;
  }

  .settings-heading-row {
    justify-content: space-between;
    gap: 1rem;
  }

  .settings-heading {
    align-items: center;
    gap: 0.85rem;
  }

  .settings-heading-icon {
    display: grid;
    width: 48px;
    height: 48px;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-md3-primary) 28%, var(--color-md3-outline));
    border-radius: var(--explorer-radius-medium, 8px);
    color: var(--color-md3-primary-emphasis);
    background: color-mix(in srgb, var(--color-md3-primary-container) 72%, transparent);
  }

  .settings-heading-copy {
    min-width: 0;
  }

  .settings-heading-copy h1 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 700 1.35rem/1.2 var(--font-md3-sans);
    letter-spacing: -0.018em;
    text-wrap: balance;
  }

  .settings-heading-copy p {
    max-width: 68ch;
    margin: 0.28rem 0 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.78rem;
    line-height: 1.5;
  }

  .settings-reset-button {
    display: inline-flex;
    inline-size: 40px;
    block-size: 40px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 5px);
    background: transparent;
    color: var(--color-md3-on-surface-variant);
    padding: 0;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  .settings-reset-button:hover:not(:disabled) {
    border-color: var(--color-md3-outline);
    background: color-mix(in srgb, var(--color-md3-on-surface) 10%, transparent);
    color: var(--color-md3-on-surface);
    transform: translateY(-1px);
  }

  .settings-reset-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (pointer: coarse) {
    .settings-back-button,
    .settings-reset-button {
      min-height: 44px;
    }

    .settings-reset-button {
      width: 44px;
      height: 44px;
    }
  }
</style>
