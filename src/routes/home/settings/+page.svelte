<script lang="ts">
  // Settings overview page
  //
  // List of settings categories that navigate to sub-pages.
  //
  // Reference: SettingsModel in reference/src/include/ui/models/settings/overview.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import { getVisibleSettingsEntries } from '$lib/settings-entries';
  import Icon from '$lib/components/Icon.svelte';

  const visibleEntries = $derived(getVisibleSettingsEntries({ isLoggedIn: authStore.isLoggedIn }));

</script>

<div class="workspace-page settings-overview">
  <header class="settings-overview__header">
    <span class="settings-overview__mark" aria-hidden="true">
      <Icon name="settings" size="27px" />
    </span>
    <h1>{$t('settings.title')}</h1>
  </header>

  <div class="settings-grid">
    {#each visibleEntries as entry}
      <button
        class="settings-entry"
        type="button"
        onclick={() => goto(entry.href)}
      >
        <span class="settings-entry__icon" aria-hidden="true">
          <Icon name={entry.icon} size="22px" />
        </span>
        <div class="settings-entry__copy">
          <p class="settings-entry__title">{$t(entry.labelKey)}</p>
          <p class="settings-entry__description">{$t(entry.descriptionKey)}</p>
        </div>
        <span class="settings-entry__arrow" aria-hidden="true">
          <Icon name="breadcrumbSep" size="19px" />
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .settings-overview {
    width: min(100%, 58rem);
    margin-inline: auto;
    padding: 1.25rem;
  }

  .settings-overview__header {
    display: flex;
    align-items: center;
    gap: 0.68rem;
    margin-bottom: 1rem;
  }

  .settings-overview__header h1 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 700 1.4rem/1.2 var(--font-md3-sans);
    letter-spacing: -0.02em;
  }

  .settings-overview__mark {
    display: grid;
    width: 30px;
    height: 30px;
    flex: none;
    place-items: center;
    color: var(--color-md3-primary-emphasis);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 1.5rem;
    border-top: 1px solid var(--color-md3-outline);
  }

  .settings-entry {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 64px;
    grid-template-columns: 28px minmax(0, 1fr) 20px;
    align-items: center;
    gap: 0.8rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 62%, transparent);
    padding: 0.72rem 0.35rem;
    color: var(--color-md3-on-surface);
    background: transparent;
    text-align: left;
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .settings-entry::after {
    position: absolute;
    inset-block: 50%;
    inset-inline-start: 0;
    width: 3px;
    height: 0;
    border-radius: 0 3px 3px 0;
    background: var(--color-md3-primary);
    content: '';
    transform: translateY(-50%);
    transition: height var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  .settings-entry:hover {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 6%, transparent);
  }

  .settings-entry:hover::after,
  .settings-entry:focus-visible::after {
    height: 28px;
  }

  .settings-entry:active {
    background: var(--color-md3-surface-container-highest);
  }

  .settings-entry__icon {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    color: var(--color-md3-primary-emphasis);
  }

  .settings-entry__copy {
    min-width: 0;
  }

  .settings-entry__title,
  .settings-entry__description {
    margin: 0;
  }

  .settings-entry__title {
    font: 650 0.84rem/1.3 var(--font-md3-sans);
  }

  .settings-entry__description {
    display: -webkit-box;
    overflow: hidden;
    margin-top: 0.22rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
    line-height: 1.4;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .settings-entry__arrow {
    display: grid;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
    transition:
      color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .settings-entry:hover .settings-entry__arrow {
    color: var(--color-md3-primary-emphasis);
    transform: translateX(2px);
  }

  @media (max-width: 700px) {
    .settings-grid {
      grid-template-columns: minmax(0, 1fr);
      column-gap: 0;
    }

  }

  @media (min-width: 640px) {
    .settings-overview {
      padding: 1.5rem;
    }
  }

  @media (pointer: coarse) {
    .settings-entry {
      min-height: 72px;
    }
  }
</style>
