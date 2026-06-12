<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { protocolVersion } from '$lib/api';
  import { loadAppVersion } from '$lib/app-info';
  import { authStore } from '$lib/stores.svelte';
  import AppUpdateChecker from '$lib/components/AppUpdateChecker.svelte';
  import TopAppBar from '$lib/components/TopAppBar.svelte';

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

  function goBack() {
    goto(authStore.isLoggedIn ? '/home/more' : '/connect');
  }
</script>

<TopAppBar
  title={$t('about.title')}
  subtitle={$t('about.productName')}
  backLabel={$t('common.back')}
  onBack={goBack}
  maxWidth="max-w-3xl"
/>

<div class="about-page">

  <section class="product-meta" aria-label={$t('about.productName')}>
    <dl>
      <div>
        <dt>{$t('about.version')}</dt>
        <dd>{appVersion || '...'}</dd>
      </div>
      <div>
        <dt>{$t('about.protocol')}</dt>
        <dd>v{protoVer || '...'}</dd>
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
</div>

<style>
  .about-page {
    width: min(720px, calc(100vw - 3rem));
    margin: 0 auto;
    padding: 2rem 0 3rem;
    display: grid;
    gap: 1.5rem;
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
