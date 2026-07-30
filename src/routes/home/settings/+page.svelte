<script lang="ts">
  // Settings overview page
  //
  // Groups settings by task while surfacing a small set of security states.
  // Detailed controls remain on their dedicated pages.

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getTwoFactorStatus } from '$lib/api';
  import { appLockStore } from '$lib/app-lock.svelte';
  import { screenProtectionStore } from '$lib/screen-protection.svelte';
  import { authStore, serverStateStore } from '$lib/stores.svelte';
  import { getVisibleSettingsGroups } from '$lib/settings-entries';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  type ProtectionState = 'loading' | 'enabled' | 'attention' | 'unavailable';
  type StatusTone = ProtectionState | 'neutral';

  interface EntryStatus {
    label: string;
    tone: StatusTone;
    icon: IconName;
  }

  interface ProtectionSummary {
    label: string;
    tone: ProtectionState;
    icon: IconName;
  }

  let twoFactorState = $state<ProtectionState>('loading');
  let twoFactorRequestId = 0;

  const visibleGroups = $derived(getVisibleSettingsGroups({ isLoggedIn: authStore.isLoggedIn }));

  const appLockState = $derived.by<ProtectionState>(() => {
    if (!authStore.isLoggedIn) return 'unavailable';
    if (appLockStore.initializationFailed) return 'unavailable';
    if (!appLockStore.initialized) return 'loading';
    return appLockStore.canLock ? 'enabled' : 'attention';
  });

  const screenProtectionState = $derived.by<ProtectionState>(() => {
    if (!authStore.isLoggedIn) return 'unavailable';
    if (screenProtectionStore.initializationFailed) return 'unavailable';
    if (!screenProtectionStore.initialized) return 'loading';
    if (!screenProtectionStore.supported || !screenProtectionStore.userEnabled) return 'attention';
    return 'enabled';
  });

  const protectionSummary = $derived.by<ProtectionSummary>(() => {
    const states = [appLockState, screenProtectionState, twoFactorState];
    const attentionCount = states.filter((state) => state === 'attention').length;

    if (attentionCount > 0) {
      return {
        label: $t('settings.overview.security.attention', { values: { count: attentionCount } }),
        tone: 'attention',
        icon: 'warningAmber',
      };
    }
    if (states.some((state) => state === 'loading')) {
      return {
        label: $t('settings.overview.security.checking'),
        tone: 'loading',
        icon: 'schedule',
      };
    }
    if (states.some((state) => state === 'unavailable')) {
      return {
        label: $t('settings.overview.security.unavailable'),
        tone: 'unavailable',
        icon: 'help',
      };
    }
    return {
      label: $t('settings.overview.security.allEnabled'),
      tone: 'enabled',
      icon: 'verified',
    };
  });

  const entryStatuses = $derived.by<Record<string, EntryStatus>>(() => ({
    '/home/settings/connection': {
      label: serverStateStore.connected
        ? $t('settings.overview.status.connected')
        : $t('settings.overview.status.disconnected'),
      tone: serverStateStore.connected ? 'enabled' : 'neutral',
      icon: serverStateStore.connected ? 'verified' : 'info',
    },
    '/home/settings/account': statusForTwoFactor(twoFactorState),
    '/home/settings/privacy': statusForScreenProtection(screenProtectionState),
    '/home/settings/app-lock': statusForAppLock(appLockState),
  }));

  $effect(() => {
    const isLoggedIn = authStore.isLoggedIn;
    const username = authStore.username;
    const requestId = ++twoFactorRequestId;

    if (!isLoggedIn || !username) {
      twoFactorState = 'unavailable';
      return;
    }

    twoFactorState = 'loading';
    void getTwoFactorStatus()
      .then((status) => {
        if (requestId !== twoFactorRequestId) return;
        twoFactorState = status.enabled ? 'enabled' : 'attention';
      })
      .catch(() => {
        if (requestId !== twoFactorRequestId) return;
        twoFactorState = 'unavailable';
      });

    return () => {
      if (requestId === twoFactorRequestId) twoFactorRequestId += 1;
    };
  });

  function statusForTwoFactor(state: ProtectionState): EntryStatus {
    if (state === 'enabled') {
      return { label: $t('settings.overview.status.twoFactorEnabled'), tone: state, icon: 'verified' };
    }
    if (state === 'attention') {
      return { label: $t('settings.overview.status.twoFactorDisabled'), tone: state, icon: 'warningAmber' };
    }
    return statusForPendingState(state);
  }

  function statusForScreenProtection(state: ProtectionState): EntryStatus {
    if (state === 'enabled') {
      return { label: $t('settings.overview.status.screenProtectionEnabled'), tone: state, icon: 'verified' };
    }
    if (state === 'attention') {
      const label = screenProtectionStore.supported
        ? $t('settings.overview.status.screenProtectionDisabled')
        : $t('settings.overview.status.screenProtectionUnsupported');
      return { label, tone: state, icon: 'warningAmber' };
    }
    return statusForPendingState(state);
  }

  function statusForAppLock(state: ProtectionState): EntryStatus {
    if (state === 'enabled') {
      return { label: $t('settings.overview.status.appLockEnabled'), tone: state, icon: 'verified' };
    }
    if (state === 'attention') {
      return { label: $t('settings.overview.status.appLockDisabled'), tone: state, icon: 'warningAmber' };
    }
    return statusForPendingState(state);
  }

  function statusForPendingState(state: ProtectionState): EntryStatus {
    return state === 'loading'
      ? { label: $t('settings.overview.status.checking'), tone: state, icon: 'schedule' }
      : { label: $t('settings.overview.status.unavailable'), tone: state, icon: 'help' };
  }
</script>

<div class="workspace-page settings-overview">
  <header class="settings-overview__header">
    <span class="settings-overview__mark" aria-hidden="true">
      <Icon name="settings" size="27px" />
    </span>
    <h1>{$t('settings.title')}</h1>
  </header>

  {#if authStore.isLoggedIn}
    <section
      class="protection-summary protection-summary--{protectionSummary.tone}"
      aria-labelledby="protection-summary-title"
      aria-live="polite"
      aria-busy={protectionSummary.tone === 'loading'}
    >
      <span class="protection-summary__icon" aria-hidden="true">
        <Icon name={protectionSummary.icon} size="21px" />
      </span>
      <div class="protection-summary__copy">
        <h2 id="protection-summary-title">{$t('settings.overview.security.title')}</h2>
        <p>{protectionSummary.label}</p>
      </div>
    </section>
  {/if}

  <div class="settings-groups">
    {#each visibleGroups as group (group.id)}
      <section class="settings-group" aria-labelledby={`settings-group-${group.id}`}>
        <h2 id={`settings-group-${group.id}`} class="settings-group__title">{$t(group.labelKey)}</h2>
        <ul class="settings-group__entries">
          {#each group.entries as entry (entry.href)}
            {@const status = entryStatuses[entry.href]}
            <li>
              <button
                class="settings-entry"
                class:settings-entry--danger={entry.tone === 'danger'}
                type="button"
                onclick={() => goto(entry.href)}
              >
                <span class="settings-entry__icon" aria-hidden="true">
                  <Icon name={entry.icon} size="22px" />
                </span>
                <span class="settings-entry__copy">
                  <span class="settings-entry__title">{$t(entry.labelKey)}</span>
                  <span class="settings-entry__description">{$t(entry.descriptionKey)}</span>
                </span>
                {#if status}
                  <span class="settings-entry__status">
                    <span class="settings-entry__status-value settings-entry__status-value--{status.tone}">
                      <Icon name={status.icon} size="14px" />
                      <span>{status.label}</span>
                    </span>
                    {#if entry.scopeKey}
                      <span class="settings-entry__scope">{$t(entry.scopeKey)}</span>
                    {/if}
                  </span>
                {/if}
                <span class="settings-entry__arrow" aria-hidden="true">
                  <Icon name="breadcrumbSep" size="19px" />
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</div>

<style>
  .settings-overview {
    width: min(100%, 64rem);
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

  .protection-summary {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    border-block: 1px solid color-mix(in srgb, var(--color-md3-outline) 80%, transparent);
    padding: 0.78rem 0.35rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 36%, transparent);
  }

  .protection-summary--enabled {
    background: color-mix(in srgb, var(--color-md3-success) 6%, transparent);
  }

  .protection-summary--attention {
    background: color-mix(in srgb, var(--color-md3-warning) 7%, transparent);
  }

  .protection-summary__icon {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
  }

  .protection-summary--enabled .protection-summary__icon {
    color: var(--color-md3-success);
  }

  .protection-summary--attention .protection-summary__icon {
    color: var(--color-md3-warning);
  }

  .protection-summary__copy h2,
  .protection-summary__copy p {
    margin: 0;
  }

  .protection-summary__copy h2 {
    color: var(--color-md3-on-surface);
    font: 650 0.8rem/1.3 var(--font-md3-sans);
  }

  .protection-summary__copy p {
    margin-top: 0.16rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.45;
  }

  .settings-groups {
    display: grid;
    gap: 1.55rem;
  }

  .settings-group {
    min-width: 0;
  }

  .settings-group__title {
    margin: 0;
    padding: 0 0.35rem 0.55rem;
    color: var(--color-md3-on-surface-variant);
    font: 650 0.76rem/1.3 var(--font-md3-sans);
    letter-spacing: 0.025em;
  }

  .settings-group__entries {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 1.5rem;
    margin: 0;
    border-top: 1px solid var(--color-md3-outline);
    padding: 0;
    list-style: none;
  }

  .settings-group__entries li {
    min-width: 0;
  }

  .settings-entry {
    position: relative;
    display: grid;
    width: 100%;
    min-width: 0;
    min-height: 68px;
    grid-template-areas: 'icon copy status arrow';
    grid-template-columns: 28px minmax(0, 1fr) minmax(6.5rem, auto) 20px;
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
    inset-block-start: 50%;
    inset-inline-start: 0;
    width: 3px;
    height: 28px;
    border-radius: 0 var(--explorer-radius-small) var(--explorer-radius-small) 0;
    background: var(--color-md3-primary);
    content: '';
    transform: translateY(-50%) scaleY(0);
    transform-origin: center;
    transition: transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  .settings-entry:hover {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 6%, transparent);
  }

  .settings-entry:hover::after,
  .settings-entry:focus-visible::after {
    transform: translateY(-50%) scaleY(1);
  }

  .settings-entry:active {
    background: var(--color-md3-surface-container-highest);
  }

  .settings-entry__icon {
    display: grid;
    width: 28px;
    height: 28px;
    grid-area: icon;
    place-items: center;
    color: var(--color-md3-primary-emphasis);
  }

  .settings-entry--danger .settings-entry__icon {
    color: var(--color-md3-error);
  }

  .settings-entry__copy {
    display: grid;
    min-width: 0;
    grid-area: copy;
  }

  .settings-entry__title {
    font: 650 0.84rem/1.3 var(--font-md3-sans);
  }

  .settings-entry__description {
    display: -webkit-box;
    overflow: hidden;
    margin-top: 0.22rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .settings-entry__status {
    display: grid;
    min-width: 0;
    max-width: 10rem;
    grid-area: status;
    justify-items: end;
    gap: 0.16rem;
    text-align: right;
  }

  .settings-entry__status-value {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 0.28rem;
    color: var(--color-md3-on-surface-variant);
    font: 600 0.68rem/1.3 var(--font-md3-sans);
  }

  .settings-entry__status-value span {
    min-width: 0;
  }

  .settings-entry__status-value--enabled {
    color: var(--color-md3-success);
  }

  .settings-entry__status-value--attention {
    color: var(--color-md3-warning);
  }

  .settings-entry__status-value--loading {
    color: var(--color-md3-primary-emphasis);
  }

  .settings-entry__scope {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.25;
  }

  .settings-entry__arrow {
    display: grid;
    grid-area: arrow;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
    transition:
      color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .settings-entry:hover .settings-entry__arrow,
  .settings-entry:focus-visible .settings-entry__arrow {
    color: var(--color-md3-primary-emphasis);
    transform: translateX(2px);
  }

  @media (max-width: 900px) {
    .settings-entry {
      grid-template-areas:
        'icon copy arrow'
        'icon status arrow';
      grid-template-columns: 28px minmax(0, 1fr) 20px;
      row-gap: 0.36rem;
    }

    .settings-entry__status {
      max-width: none;
      justify-items: start;
      text-align: left;
    }

    .settings-entry__status-value {
      justify-content: flex-start;
    }
  }

  @media (max-width: 700px) {
    .settings-group__entries {
      grid-template-columns: minmax(0, 1fr);
      column-gap: 0;
    }

    .settings-entry__description {
      display: block;
      overflow: visible;
      -webkit-line-clamp: unset;
      line-clamp: unset;
    }
  }

  @media (min-width: 640px) {
    .settings-overview {
      padding: 1.5rem;
    }
  }

  @media (max-width: 420px) {
    .settings-overview {
      padding: 1rem;
    }

    .settings-entry {
      gap: 0.65rem;
      padding-inline: 0.25rem;
    }
  }

  @media (pointer: coarse) {
    .settings-entry {
      min-height: 72px;
    }
  }
</style>
