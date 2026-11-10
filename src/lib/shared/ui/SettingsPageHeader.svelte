<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import { getContext } from 'svelte';
  import { NAVIGATION_CONTEXT, type NavigationContext } from './navigation-context';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import IconButton from '$lib/shared/ui/IconButton.svelte';
  import PageHeading from '$lib/shared/ui/PageHeading.svelte';
  import type { IconName } from '$lib/shared/ui/icons';

  interface Props {
    title: string;
    description?: string;
    icon?: IconName;
    resetDisabled?: boolean;
    resetLabel?: string;
    onReset?: () => void | Promise<void>;
    onRefresh?: () => void | Promise<void>;
    refreshDisabled?: boolean;
    onBack?: () => void | Promise<void>;
  }

  let {
    title,
    description,
    icon,
    resetDisabled = false,
    resetLabel,
    onReset,
    onRefresh,
    refreshDisabled = false,
    onBack,
  }: Props = $props();
  const navigation = getContext<NavigationContext>(NAVIGATION_CONTEXT);
</script>

<div class="settings-page-header">
  <FluentButton data-fluent-owner="lib-components-settings-page-header"
    type="button"
    onclick={() => onBack ? onBack() : navigation.navigateUp(page.url.pathname)}
    appearance="transparent"
    class="settings-back-button"
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </FluentButton>

  <div class="settings-heading-group">
    <div class="settings-heading-row">
      <div class="settings-heading">
        {#if icon}
          <span class="settings-heading-icon" aria-hidden="true">
            <Icon name={icon} size="28px" />
          </span>
        {/if}
        <PageHeading {title} {description} />
      </div>

      {#if onRefresh || onReset}
        <div class="settings-heading-actions">
          {#if onRefresh}
            <IconButton icon="refresh" label={$t('common.refresh')} disabled={refreshDisabled} onclick={onRefresh} />
          {/if}
          {#if onReset}
            <FluentButton data-fluent-owner="lib-components-settings-page-header"
              type="button"
              onclick={onReset}
              disabled={resetDisabled}
              title={resetLabel ?? $t('common.reset')}
              aria-label={resetLabel ?? $t('common.reset')}
              appearance="subtle"
              class="settings-reset-button"
              iconOnly
            >
              <Icon name="resetSettings" size="20px" />
            </FluentButton>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .settings-page-header {
    display: grid;
    gap: 12px;
  }

  .settings-heading-actions { display: flex; flex: none; align-items: center; gap: 4px; }
  .settings-heading-group { display: grid; min-width: 0; gap: 4px; }

  :global(.settings-back-button[data-fluent-owner="lib-components-settings-page-header"]) {
    display: inline-flex;
    min-height: 32px;
    min-inline-size: 0;
    width: fit-content;
    justify-self: start;
    align-items: center;
    justify-content: flex-start;
    text-align: start;
    gap: 8px;
    padding: 5px 8px;
  }

  :global(.settings-back-button[data-fluent-owner="lib-components-settings-page-header"]::part(content)) {
    justify-content: flex-start;
  }

  .settings-heading-row,
  .settings-heading {
    display: flex;
    min-width: 0;
    align-items: center;
  }

  .settings-heading-row {
    justify-content: space-between;
    gap: 16px;
  }

  .settings-heading {
    align-items: center;
    gap: 12px;
  }

  .settings-heading-icon {
    display: grid;
    width: 30px;
    height: 30px;
    flex: none;
    place-items: center;
    color: var(--color-md3-primary-emphasis);
  }

  :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]) {
    display: inline-flex;
    inline-size: 40px;
    block-size: 40px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--borderRadiusMedium);
    background: transparent;
    color: var(--color-md3-on-surface-variant);
    padding: 0;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]:hover:not(:is(:disabled, [disabled]))) {
    background: color-mix(in srgb, var(--color-md3-on-surface) 7%, transparent);
    color: var(--color-md3-on-surface);
    transform: translateY(-1px);
  }

  :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]:is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (pointer: coarse) {
    :global(.settings-back-button[data-fluent-owner="lib-components-settings-page-header"]),
    :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]) {
      min-height: 44px;
    }

    :global(.settings-reset-button[data-fluent-owner="lib-components-settings-page-header"]) {
      width: 44px;
      height: 44px;
    }
  }
</style>
