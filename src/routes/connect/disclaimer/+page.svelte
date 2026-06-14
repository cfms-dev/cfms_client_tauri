<script lang="ts">
  // Disclaimer page
  //
  // Shown on first launch before connecting to a server.  The user must
  // accept the disclaimer to proceed.
  //
  // Reference: DisclaimerModel in reference/src/include/ui/models/misc/disclaimer.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { disclaimerStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let busy = $state(false);

  const bulletKeys = [
    'disclaimer.bullet1',
    'disclaimer.bullet2',
    'disclaimer.bullet3',
    'disclaimer.bullet4',
    'disclaimer.bullet5',
    'disclaimer.bullet6',
  ] as const;
</script>

<div class="disclaimer-screen">
  <main class="disclaimer-shell" aria-labelledby="disclaimer-title">
    <section class="disclaimer-header" aria-describedby="disclaimer-intro">
      <span class="warning-symbol" aria-hidden="true">
        <Icon name="warningAmber" size="100%" />
      </span>
      <h1 id="disclaimer-title">{$t('disclaimer.title')}</h1>
      <p id="disclaimer-intro">{$t('disclaimer.intro')}</p>
    </section>

    <div class="divider"></div>

    <div class="disclaimer-copy" role="region" aria-label={$t('disclaimer.title')}>
      <p>{$t('disclaimer.paragraph1')}</p>
      <p>{$t('disclaimer.paragraph2')}</p>
      <p>{$t('disclaimer.paragraph3')}</p>

      <ul>
        {#each bulletKeys as key}
          <li>{$t(key)}</li>
        {/each}
      </ul>
    </div>

    <div class="divider"></div>

    <footer class="disclaimer-footer">
      <p>{$t('disclaimer.responsibility')}</p>

      <div class="actions">
        <button
          class="accept-button"
          onclick={async () => {
            busy = true;
            await disclaimerStore.accept();
            goto('/connect');
          }}
          disabled={busy}
        >
          {$t('disclaimer.accept')}
        </button>

        <button class="reject-button" onclick={() => window.close()} disabled={busy}>
          {$t('disclaimer.rejectAndQuit')}
        </button>
      </div>
    </footer>
  </main>
</div>

<style>
  .disclaimer-screen {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: #11161d;
    color: rgba(248, 250, 252, 0.88);
    font-family: var(--font-md3-serif);
  }

  .disclaimer-shell {
    display: flex;
    flex-direction: column;
    width: min(100%, 900px);
    height: 100%;
    min-height: 0;
    margin: 0 auto;
    padding: clamp(1.75rem, 5.7vw, 3.35rem) clamp(1.5rem, 5.3vw, 3rem)
      max(clamp(1.55rem, 5.3vw, 3rem), var(--safe-area-bottom));
    background: #11161d;
  }

  .disclaimer-header {
    flex: 0 0 auto;
  }

  .warning-symbol {
    display: block;
    width: clamp(3.35rem, 9.7vw, 5.55rem);
    height: clamp(3.35rem, 9.7vw, 5.55rem);
    color: #fff04f;
  }

  h1 {
    margin: clamp(2rem, 5.4vw, 3.1rem) 0 0;
    color: rgba(248, 250, 252, 0.9);
    font-size: clamp(2.35rem, 5.4vw, 3.25rem);
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: 0;
  }

  .disclaimer-header p {
    margin: clamp(1.25rem, 3.7vw, 2rem) 0 0;
    color: rgba(248, 250, 252, 0.86);
    font-size: clamp(1.35rem, 3.9vw, 2.25rem);
    line-height: 1.32;
    letter-spacing: 0;
  }

  .divider {
    flex: 0 0 auto;
    height: 2px;
    margin: clamp(1.5rem, 4.4vw, 2.8rem) 0;
    background: rgba(226, 232, 240, 0.25);
  }

  .disclaimer-copy {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-right: clamp(0.35rem, 1vw, 0.7rem);
    color: rgba(248, 250, 252, 0.78);
    font-size: clamp(1.34rem, 3.74vw, 2.25rem);
    line-height: 1.5;
    letter-spacing: 0;
    scrollbar-gutter: stable;
    overscroll-behavior: contain;
  }

  .disclaimer-copy:focus {
    outline: none;
  }

  .disclaimer-copy p {
    margin: 0 0 clamp(1.25rem, 3.9vw, 2.15rem);
  }

  .disclaimer-copy p:last-of-type {
    margin-bottom: clamp(1.15rem, 3.5vw, 2rem);
  }

  .disclaimer-copy ul {
    display: grid;
    gap: clamp(0.9rem, 3.2vw, 1.8rem);
    margin: 0;
    padding: 0 0 0 clamp(1.35rem, 4.4vw, 2.65rem);
  }

  .disclaimer-copy li {
    padding-left: clamp(0.65rem, 2vw, 1.2rem);
  }

  .disclaimer-copy::-webkit-scrollbar {
    width: clamp(0.28rem, 1vw, 0.58rem);
  }

  .disclaimer-copy::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(248, 250, 252, 0.9);
  }

  .disclaimer-copy::-webkit-scrollbar-track {
    background: transparent;
  }

  .disclaimer-footer {
    flex: 0 0 auto;
  }

  .disclaimer-footer p {
    margin: 0;
    color: rgba(248, 250, 252, 0.9);
    font-size: clamp(1.42rem, 3.9vw, 2.25rem);
    font-weight: 800;
    line-height: 1.5;
    letter-spacing: 0;
  }

  .actions {
    display: flex;
    gap: 0.85rem;
    margin-top: clamp(1.55rem, 4.8vw, 2.75rem);
  }

  .accept-button,
  .reject-button {
    position: relative;
    min-width: 0;
    min-height: clamp(3.8rem, 10.6vw, 6rem);
    border: 0;
    border-radius: 999px;
    padding: 0 clamp(1.5rem, 4.4vw, 2.5rem);
    font-family: var(--font-md3-serif);
    font-size: clamp(1.55rem, 4vw, 2.4rem);
    line-height: 1;
    letter-spacing: 0;
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate),
      filter var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .accept-button {
    flex: 1 1 auto;
    background: #191e25;
    color: #b9c5ff;
    box-shadow:
      0 12px 24px rgba(0, 0, 0, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.02);
  }

  .reject-button {
    flex: 0 0 auto;
    background: transparent;
    color: rgba(248, 250, 252, 0.7);
    box-shadow: inset 0 0 0 1px rgba(248, 250, 252, 0.24);
  }

  .accept-button:hover,
  .reject-button:hover {
    filter: brightness(1.08);
  }

  .accept-button:active,
  .reject-button:active {
    transform: scale(0.985);
  }

  .accept-button:disabled,
  .reject-button:disabled {
    cursor: default;
    opacity: 0.55;
    transform: none;
  }

  @media (max-width: 639px) {
    .disclaimer-shell {
      padding-top: clamp(1.5rem, 6.2vw, 2.5rem);
    }

    .reject-button {
      display: none;
    }
  }

  @media (max-width: 420px) {
    h1 {
      font-size: 2.05rem;
    }

    .disclaimer-header p,
    .disclaimer-copy,
    .disclaimer-footer p {
      font-size: 1.28rem;
    }

    .accept-button,
    .reject-button {
      min-height: 3.5rem;
      font-size: 1.35rem;
    }
  }
</style>
