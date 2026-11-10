<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { onMount } from 'svelte';
  import { openUrl } from '$lib/shared/platform/native-opener';
  import { _ as t } from 'svelte-i18n';
  import {
    deleteGithubToken,
    getGithubAuthStatus,
    saveGithubToken,
    type GithubAuthMode,
  } from '$lib/api';
  import { resetGithubAuthNotice } from '$lib/features/updates/github-auth-notices';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import Icon from '$lib/shared/ui/Icon.svelte';
  import SettingsPageHeader from '$lib/shared/ui/SettingsPageHeader.svelte';

  const tokenGuideUrl = 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token';
  const rateLimitsUrl = 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api';

  let mode = $state<GithubAuthMode>('none');
  let token = $state('');
  let loading = $state(true);
  let busy = $state(false);

  const canSave = $derived(!loading && !busy && mode !== 'unavailable' && token.trim().length > 0);
  const canRemove = $derived(!loading && !busy && (mode === 'configured' || mode === 'needs_attention'));
  const stateIcon = $derived(mode === 'configured' ? 'verified' : mode === 'needs_attention' ? 'warning' : mode === 'unavailable' ? 'help' : 'info');

  onMount(() => {
    void refreshStatus();
  });

  async function refreshStatus() {
    loading = true;
    try {
      mode = (await getGithubAuthStatus()).mode;
    } catch {
      mode = 'unavailable';
    } finally {
      loading = false;
    }
  }

  async function saveToken() {
    if (!canSave) return;
    busy = true;
    try {
      await saveGithubToken(token.trim());
      token = '';
      mode = 'configured';
      resetGithubAuthNotice();
      notificationStore.success($t('settings.githubApi.saved'));
    } catch {
      await refreshStatus();
      notificationStore.error($t('settings.githubApi.saveFailed'));
    } finally {
      busy = false;
    }
  }

  async function removeToken() {
    if (!canRemove) return;
    busy = true;
    try {
      await deleteGithubToken();
      token = '';
      mode = 'none';
      resetGithubAuthNotice();
      notificationStore.success($t('settings.githubApi.removed'));
    } catch {
      await refreshStatus();
      notificationStore.error($t('settings.githubApi.removeFailed'));
    } finally {
      busy = false;
    }
  }

  async function openDocumentation(url: string) {
    try {
      await openUrl(url);
    } catch {
      notificationStore.error($t('settings.githubApi.docsOpenFailed'));
    }
  }
</script>

<div class="workspace-page settings-page-shell github-api-page">
  <SettingsPageHeader
    title={$t('settings.githubApi.title')}
    description={$t('settings.githubApi.description')}
    icon="api"
    onRefresh={refreshStatus}
    refreshDisabled={loading || busy}
  />

  <div class="settings-section-list">
    <section class="settings-section github-api-section" aria-labelledby="github-api-status-title">
      <div class="settings-section-heading">
        <h2 id="github-api-status-title">{$t('settings.githubApi.statusTitle')}</h2>
        <p>{$t('settings.githubApi.purpose')}</p>
      </div>

      <div class="credential-status credential-status--{mode}" role="status" aria-live="polite" aria-busy={loading}>
        <span class="credential-status__icon" aria-hidden="true"><Icon name={stateIcon} size="20px" /></span>
        <div class="credential-status__copy">
          <strong>{$t(`settings.githubApi.status.${loading ? 'checking' : mode}`)}</strong>
          <span>{$t(`settings.githubApi.statusHint.${loading ? 'checking' : mode}`)}</span>
        </div>
      </div>

    </section>

    <section class="settings-section github-api-section" aria-labelledby="github-api-token-title">
      <div class="settings-section-heading">
        <h2 id="github-api-token-title">{$t('settings.githubApi.tokenTitle')}</h2>
        <p>{$t('settings.githubApi.tokenHint')}</p>
      </div>

      <form class="credential-form" onsubmit={(event) => { event.preventDefault(); void saveToken(); }}>
        <MdOutlinedField inputId="github-api-token" label={$t('settings.githubApi.tokenLabel')} disabled={loading || busy || mode === 'unavailable'}>
          <input data-focus-ring="delegated" class="cfms-native-field"
            id="github-api-token"
            type="password"
            autocomplete="new-password"
            autocapitalize="none"
            spellcheck="false"
            placeholder={$t('settings.githubApi.tokenPlaceholder')}
            bind:value={token}
            disabled={loading || busy || mode === 'unavailable'}
          />
        </MdOutlinedField>
        <div class="credential-actions">
          <FluentButton data-fluent-owner="routes-home-settings-github-api-page"
            type="submit"
            disabled={!canSave}
            appearance="subtle"
            class="primary-action"
          >
            <Icon name="check" size="18px" />
            {$t(mode === 'none' ? 'settings.githubApi.save' : 'settings.githubApi.replace')}
          </FluentButton>
          {#if mode === 'configured' || mode === 'needs_attention'}
            <FluentButton data-fluent-owner="routes-home-settings-github-api-page"
              type="button"
              onclick={removeToken}
              disabled={!canRemove}
              appearance="subtle"
              class="remove-action"
            >
              <Icon name="delete" size="18px" />
              {$t('settings.githubApi.remove')}
            </FluentButton>
          {/if}
        </div>
      </form>
    </section>

    <div class="settings-section github-api-section">
      <div class="github-api-guidance">
        <p>{$t('settings.githubApi.rateLimitHint')}</p>
        <p>{$t('settings.githubApi.permissionsHint')}</p>
      </div>
      <div class="documentation-links">
        <a href={tokenGuideUrl} target="_blank" rel="noopener noreferrer" onclick={(event) => { event.preventDefault(); void openDocumentation(tokenGuideUrl); }}>
          {$t('settings.githubApi.createTokenLink')}
        </a>
        <a href={rateLimitsUrl} target="_blank" rel="noopener noreferrer" onclick={(event) => { event.preventDefault(); void openDocumentation(rateLimitsUrl); }}>
          {$t('settings.githubApi.rateLimitsLink')}
        </a>
      </div>
    </div>
  </div>
</div>

<style>
  .github-api-section {
    display: grid;
    gap: 16px;
  }

  .credential-status {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 3rem;
  }

  .credential-status__icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
  }

  .credential-status--configured .credential-status__icon { color: var(--color-md3-success); }
  .credential-status--needs_attention .credential-status__icon { color: var(--color-md3-warning); }

  .credential-status__copy {
    display: grid;
    gap: 4px;
  }

  .credential-status__copy strong {
    color: var(--color-md3-on-surface);
    font: 600 14px/20px var(--font-md3-sans);
  }

  .credential-status__copy span {
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    line-height: 1.5;
  }

  .credential-form {
    display: grid;
    justify-items: start;
    gap: 12px;
  }


  .credential-form > :global(.cfms-field) { width: min(100%, 30rem); }
  .credential-form input {
    width: 100%;
  }

  .credential-form input:is(:disabled, [disabled]) { opacity: 0.55; }
  .credential-actions,
  .documentation-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  :global(.primary-action[data-fluent-owner="routes-home-settings-github-api-page"]),
  :global(.secondary-action[data-fluent-owner="routes-home-settings-github-api-page"]),
  :global(.remove-action[data-fluent-owner="routes-home-settings-github-api-page"]) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 2.5rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0.45rem 0.85rem;
    font: 600 12px/16px var(--font-md3-sans);
    transition: background-color var(--motion-duration-short4) var(--motion-easing-standard), transform var(--motion-duration-short4) var(--motion-easing-standard);
  }

  :global(.primary-action[data-fluent-owner="routes-home-settings-github-api-page"]) {
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  :global(.secondary-action[data-fluent-owner="routes-home-settings-github-api-page"]) {
    justify-self: start;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  :global(.remove-action[data-fluent-owner="routes-home-settings-github-api-page"]) {
    color: var(--color-md3-error);
    background: transparent;
  }

  :global(.primary-action[data-fluent-owner="routes-home-settings-github-api-page"]:hover:not(:is(:disabled, [disabled]))),
  :global(.secondary-action[data-fluent-owner="routes-home-settings-github-api-page"]:hover:not(:is(:disabled, [disabled]))) { transform: translateY(-1px); filter: none; }
  :global(.remove-action[data-fluent-owner="routes-home-settings-github-api-page"]:hover:not(:is(:disabled, [disabled]))) { background: color-mix(in srgb, var(--color-md3-error) 9%, transparent); }
  .credential-actions :global(.cfms-button[data-fluent-owner="routes-home-settings-github-api-page"]:is(:disabled, [disabled])) { cursor: not-allowed; opacity: 0.55; }

  .github-api-guidance {
    display: grid;
    gap: 4px;
  }

  .github-api-guidance p {
    max-width: 70ch;
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    line-height: 1.5;
  }

  .documentation-links { gap: 20px; }

  .documentation-links a {
    display: inline-flex;
    align-items: center;
    min-height: 2.5rem;
    color: var(--color-md3-primary-emphasis);
    font: 500 12px/16px var(--font-md3-sans);
    text-decoration: underline;
    text-underline-offset: 0.2rem;
  }

  .documentation-links a:hover { text-decoration-thickness: 2px; }
  .documentation-links a:focus-visible { outline-offset: 2px; }

  @media (max-width: 420px) {
    .credential-actions { width: 100%; }
    .credential-actions :global(.cfms-button[data-fluent-owner="routes-home-settings-github-api-page"]) { width: 100%; }
  }
</style>
