<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { protocolVersion } from '$lib/api';
  import { loadAppVersion } from '$lib/app-info';
  import AppUpdateChecker from '$lib/components/AppUpdateChecker.svelte';
  import ChangelogPanel from '$lib/components/ChangelogPanel.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let protoVer = $state(0);
  let appVersion = $state('');

  onMount(async () => {
    appVersion = await loadAppVersion();
    try {
      protoVer = await protocolVersion();
    } catch {
      // Non-fatal on the about page.
    }
  });

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
  }
</style>
