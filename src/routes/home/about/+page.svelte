<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { protocolVersion } from '$lib/api';
  import { loadAppVersion } from '$lib/app-info';
  import { releaseHighlightsState } from '$lib/release-highlights/state.svelte';
  import { authStore } from '$lib/stores.svelte';
  import AppUpdateChecker from '$lib/components/AppUpdateChecker.svelte';
  import ChangelogPanel from '$lib/components/ChangelogPanel.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let protoVer = $state(0);
  let appVersion = $state('');

  onMount(async () => {
    void releaseHighlightsState.initialize();
    appVersion = await loadAppVersion();
    try {
      protoVer = await protocolVersion();
    } catch {
      // Non-fatal on the about page.
    }
  });

  async function replayReleaseHighlights() {
    await releaseHighlightsState.initialize();
    releaseHighlightsState.openManually(authStore.permissions);
  }

</script>

<div class="about-page">
  <header class="page-header">
    <h1>{$t('about.title')}</h1>
    <p>{$t('about.productName')}</p>
  </header>

  <section class="product-meta" aria-label={$t('about.productName')}>
    <dl>
      <div>
        <dt>{$t('about.version')}</dt>
        <dd>{appVersion || '...'}</dd>
      </div>
      <div>
        <dt>{$t('about.protocol')}</dt>
        <dd>{protoVer || '...'}</dd>
      </div>
      <div>
        <dt>{$t('about.copyright')}</dt>
        <dd>© 2025–2026 Creeper Team</dd>
      </div>
      <div>
        <dt>{$t('about.license')}</dt>
        <dd>Apache License 2.0</dd>
      </div>
    </dl>
  </section>

  <AppUpdateChecker />

  {#if releaseHighlightsState.currentTour}
    <section class="release-replay" aria-labelledby="release-replay-title">
      <div>
        <h2 id="release-replay-title">{$t('releaseHighlights.replay')}</h2>
        <p>{$t('releaseHighlights.replayDescription')}</p>
      </div>
      <button type="button" onclick={replayReleaseHighlights}>
        <Icon name="newReleases" size="19px" />
        {$t('releaseHighlights.replay')}
      </button>
    </section>
  {/if}

  <ChangelogPanel />
</div>

<style>
  .about-page {
    width: min(720px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 3rem;
    display: grid;
    gap: 1.5rem;
  }

  .page-header {
    display: grid;
    gap: 0.35rem;
  }

  h1 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-size: clamp(1.6rem, 4vw, 2.25rem);
    font-weight: 800;
    letter-spacing: 0;
  }

  .page-header p {
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.95rem;
  }

  .product-meta {
    padding-block: 0.25rem 0.75rem;
  }

  .release-replay {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    border-block: 1px solid color-mix(in srgb, var(--color-md3-outline) 64%, transparent);
    padding: 1rem 0;
  }

  .release-replay div {
    display: grid;
    gap: 0.3rem;
  }

  .release-replay h2,
  .release-replay p {
    margin: 0;
  }

  .release-replay h2 {
    color: var(--color-md3-on-surface);
    font: 700 0.95rem/1.3 var(--font-md3-sans);
  }

  .release-replay p {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .release-replay button {
    display: inline-flex;
    min-height: 2.5rem;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 7px;
    padding: 0 0.9rem;
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
    font: 700 0.82rem/1 var(--font-md3-sans);
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .release-replay button:hover {
    transform: translateY(-1px);
  }

  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem 2rem;
  }

  dl > div {
    min-width: 0;
  }

  dt {
    color: var(--color-md3-on-surface-variant);
    font-family: var(--font-md3-sans);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  dd {
    margin: 0.25rem 0 0;
    color: var(--color-md3-on-surface);
    font-size: 1rem;
    word-break: break-word;
  }

  @media (max-width: 640px) {
    .about-page {
      width: min(100% - 2rem, 720px);
      padding-top: 1.5rem;
    }

    dl {
      grid-template-columns: 1fr;
      gap: 0.9rem;
    }

    .release-replay {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
