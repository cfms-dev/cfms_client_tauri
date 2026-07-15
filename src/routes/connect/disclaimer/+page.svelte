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
  import { isMobilePlatform } from '$lib/platform';

  let busy = $state(false);
  const isMobile = isMobilePlatform();

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

        {#if !isMobile}
          <button class="reject-button" onclick={() => window.close()} disabled={busy}>
            {$t('disclaimer.rejectAndQuit')}
          </button>
        {/if}
      </div>
    </footer>
  </main>
</div>

<style>
  .disclaimer-screen {
    --flet-pad: clamp(20px, min(4.65vw, 2.27vh), 32px);
    --flet-gap: clamp(10px, min(2.33vw, 1.14vh), 16px);
    --flet-icon: clamp(24px, min(12.56vw, 6.14vh), 82px);
    --flet-title: clamp(24px, min(5.58vw, 2.73vh), 38px);
    --flet-body: clamp(14px, min(3.25vw, 1.59vh), 22px);
    --flet-button-height: clamp(40px, min(9.3vw, 4.55vh), 60px);
    --flet-button-width: clamp(220px, 18vw, 300px);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    --disclaimer-background: #11161d;
    --disclaimer-text: rgba(248, 250, 252, 0.88);
    --disclaimer-text-strong: rgba(248, 250, 252, 0.9);
    --disclaimer-text-muted: rgba(248, 250, 252, 0.78);
    --disclaimer-divider: rgba(226, 232, 240, 0.25);
    --disclaimer-button: #191e25;
    --disclaimer-accent: #b9c5ff;
    --disclaimer-outline: rgba(248, 250, 252, 0.24);
    background: var(--disclaimer-background);
    color: var(--disclaimer-text);
    font-family: var(--font-md3-serif);
  }

  .disclaimer-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0 auto;
    padding: var(--flet-pad) var(--flet-pad) max(var(--flet-pad), var(--safe-area-bottom));
    background: var(--disclaimer-background);
  }

  .disclaimer-header {
    flex: 0 0 auto;
  }

  .warning-symbol {
    display: block;
    width: var(--flet-icon);
    height: var(--flet-icon);
    color: #fff04f;
  }

  h1 {
    margin: calc(var(--flet-gap) * 0.55) 0 0;
    color: var(--disclaimer-text-strong);
    font-size: var(--flet-title);
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: 0;
  }

  .disclaimer-header p {
    margin: var(--flet-gap) 0 0;
    color: var(--disclaimer-text);
    font-size: var(--flet-body);
    line-height: 1.45;
    letter-spacing: 0;
  }

  .divider {
    flex: 0 0 auto;
    height: 1px;
    margin: var(--flet-gap) 0;
    background: var(--disclaimer-divider);
  }

  .disclaimer-copy {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding-right: calc(var(--flet-gap) * 0.8);
    color: var(--disclaimer-text-muted);
    font-size: var(--flet-body);
    line-height: 1.55;
    letter-spacing: 0;
    scrollbar-gutter: stable;
    overscroll-behavior: contain;
  }

  .disclaimer-copy:focus {
    outline: none;
  }

  .disclaimer-copy p {
    margin: 0 0 calc(var(--flet-gap) * 1.4);
  }

  .disclaimer-copy p:last-of-type {
    margin-bottom: calc(var(--flet-gap) * 1.4);
  }

  .disclaimer-copy ul {
    display: grid;
    gap: var(--flet-gap);
    list-style: disc;
    margin: 0;
    padding: 0 0 0 calc(var(--flet-body) * 2.2);
  }

  .disclaimer-copy li {
    padding-left: calc(var(--flet-gap) * 0.65);
  }

  .disclaimer-copy::-webkit-scrollbar {
    width: max(4px, calc(var(--flet-gap) * 0.6));
  }

  .disclaimer-copy::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--disclaimer-text-strong);
  }

  .disclaimer-copy::-webkit-scrollbar-track {
    background: transparent;
  }

  .disclaimer-footer {
    flex: 0 0 auto;
  }

  .disclaimer-footer p {
    margin: 0;
    color: var(--disclaimer-text-strong);
    font-size: var(--flet-body);
    font-weight: 800;
    line-height: 1.5;
    letter-spacing: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
    justify-content: center;
    margin-top: var(--flet-gap);
  }

  .accept-button,
  .reject-button {
    position: relative;
    min-width: 0;
    min-height: var(--flet-button-height);
    border: 0;
    border-radius: 999px;
    padding: 0 calc(var(--flet-pad) * 1.2);
    font-family: var(--font-md3-serif);
    font-size: var(--flet-body);
    line-height: 1;
    letter-spacing: 0;
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate),
      filter var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .accept-button {
    flex: 0 0 min(100%, var(--flet-button-width));
    width: min(100%, var(--flet-button-width));
    background: var(--disclaimer-button);
    color: var(--disclaimer-accent);
    box-shadow:
      0 12px 24px rgba(0, 0, 0, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.02);
  }

  .reject-button {
    flex: 0 0 min(100%, var(--flet-button-width));
    width: min(100%, var(--flet-button-width));
    background: transparent;
    color: var(--disclaimer-text-muted);
    box-shadow: inset 0 0 0 1px var(--disclaimer-outline);
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
    .accept-button,
    .reject-button {
      flex-basis: 100%;
      width: 100%;
    }
  }

  .warning-symbol :global(.material-symbols-outlined) {
    width: var(--flet-icon) !important;
    height: var(--flet-icon) !important;
    font-size: var(--flet-icon) !important;
  }

  :global(html[data-theme='light']) .disclaimer-screen {
    --disclaimer-background: #f3f3f3;
    --disclaimer-text: #3f3f46;
    --disclaimer-text-strong: #18181b;
    --disclaimer-text-muted: #5d5d66;
    --disclaimer-divider: rgba(0, 0, 0, 0.14);
    --disclaimer-button: #d8eaff;
    --disclaimer-accent: #005a9e;
    --disclaimer-outline: rgba(0, 0, 0, 0.22);
  }
</style>
