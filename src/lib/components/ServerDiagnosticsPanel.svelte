<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { getServerDiagnostics, type ServerDiagnostics } from '$lib/api';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let diagnostics = $state<ServerDiagnostics | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  const componentVersions = $derived(
    diagnostics ? Object.entries(diagnostics.component_versions) : [],
  );

  onMount(() => {
    void loadDiagnostics();
  });

  async function loadDiagnostics() {
    if (loading) return;
    loading = true;
    error = null;
    try {
      diagnostics = await getServerDiagnostics();
    } catch (reason) {
      error = formatUserFacingError(reason);
    } finally {
      loading = false;
    }
  }

  function booleanLabel(value: boolean): string {
    return value ? $t('common.enabled') : $t('common.disabled');
  }
</script>

<section class="diagnostics-section" aria-label={$t('diagnostics.title')} aria-busy={loading}>
  <div class="section-actions">
    <button type="button" onclick={() => void loadDiagnostics()} disabled={loading}>
      {#if loading}
        <ProgressRing size={17} strokeWidth={2.4} label={$t('diagnostics.loading')} />
      {:else}
        <Icon name="refresh" size="18px" />
      {/if}
      {diagnostics ? $t('diagnostics.refresh') : $t('diagnostics.load')}
    </button>
  </div>

  {#if error}
    <div class="load-error" role="alert">
      <Icon name="errorFilled" size="20px" />
      <div>
        <strong>{$t('diagnostics.loadFailed')}</strong>
        <p>{error}</p>
      </div>
    </div>
  {:else if loading && !diagnostics}
    <div class="loading-state" role="status">
      <ProgressRing size={22} strokeWidth={2.5} label={$t('diagnostics.loading')} />
      <span>{$t('diagnostics.loading')}</span>
    </div>
  {:else if diagnostics}
    <div class="diagnostic-groups">
      <section class="diagnostic-group">
        <h3><Icon name="info" size="18px" />{$t('diagnostics.server')}</h3>
        <dl>
          <div><dt>{$t('diagnostics.serverName')}</dt><dd>{diagnostics.server.server_name}</dd></div>
          <div><dt>{$t('diagnostics.coreVersion')}</dt><dd>{diagnostics.server.core_version}</dd></div>
          <div><dt>{$t('about.protocol')}</dt><dd>{diagnostics.server.protocol_version}</dd></div>
          <div><dt>{$t('diagnostics.schemaVersion')}</dt><dd>{diagnostics.schema_version}</dd></div>
          <div><dt>{$t('diagnostics.debugConfigured')}</dt><dd class="human-readable">{booleanLabel(diagnostics.server.debug_configured)}</dd></div>
          <div><dt>{$t('diagnostics.lockdown')}</dt><dd class="human-readable">{booleanLabel(diagnostics.lockdown.enabled)}</dd></div>
          {#if diagnostics.lockdown.reason}
            <div class="wide-row"><dt>{$t('diagnostics.lockdownReason')}</dt><dd class="human-readable">{diagnostics.lockdown.reason}</dd></div>
          {/if}
        </dl>
      </section>

      <section class="diagnostic-group">
        <h3><Icon name="bugReport" size="18px" />{$t('diagnostics.runtime')}</h3>
        <dl>
          <div><dt>{$t('diagnostics.python')}</dt><dd>{diagnostics.runtime.python_implementation} {diagnostics.runtime.python_version}</dd></div>
          <div><dt>OpenSSL</dt><dd>{diagnostics.runtime.openssl_version}</dd></div>
          <div><dt>{$t('diagnostics.operatingSystem')}</dt><dd>{diagnostics.runtime.operating_system} {diagnostics.runtime.operating_system_release}</dd></div>
          <div><dt>{$t('diagnostics.architecture')}</dt><dd>{diagnostics.runtime.architecture}</dd></div>
        </dl>
      </section>

      <section class="diagnostic-group">
        <h3><Icon name="storage" size="18px" />{$t('diagnostics.services')}</h3>
        <dl>
          <div><dt>{$t('diagnostics.database')}</dt><dd>{diagnostics.database.dialect} · {diagnostics.database.driver}</dd></div>
          <div><dt>{$t('diagnostics.storage')}</dt><dd>{diagnostics.providers.storage}</dd></div>
          <div><dt>{$t('diagnostics.caching')}</dt><dd>{diagnostics.providers.caching}</dd></div>
          <div><dt>{$t('diagnostics.eventBus')}</dt><dd>{diagnostics.providers.event_bus}</dd></div>
          <div><dt>{$t('diagnostics.rateLimit')}</dt><dd>{diagnostics.providers.rate_limit}</dd></div>
        </dl>
      </section>

      <section class="diagnostic-group">
        <h3><Icon name="extensions" size="18px" />{$t('diagnostics.components')}</h3>
        <dl>
          {#each componentVersions as [name, version] (name)}
            <div><dt>{name}</dt><dd>{version}</dd></div>
          {/each}
        </dl>
      </section>

      <section class="diagnostic-group diagnostic-group--wide">
        <h3><Icon name="extensions" size="18px" />{$t('diagnostics.extensions')}</h3>
        {#if diagnostics.extensions.length === 0}
          <p class="empty-copy">{$t('diagnostics.noExtensions')}</p>
        {:else}
          <ul>
            {#each diagnostics.extensions as extension (extension.identifier)}
              <li>
                <span><strong>{extension.name}</strong><small>{extension.identifier}</small></span>
                <code>{extension.version}</code>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="extension-flags">
          <strong>{$t('diagnostics.extensionFlags')}</strong>
          <code class:human-readable={diagnostics.extension_flags.length === 0}>{diagnostics.extension_flags.length > 0 ? diagnostics.extension_flags.join(', ') : $t('diagnostics.noExtensionFlags')}</code>
        </div>
      </section>
    </div>
  {/if}
</section>

<style>
  .diagnostics-section {
    display: grid;
    gap: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
    padding-top: 1.25rem;
  }

  .section-actions {
    display: flex;
    justify-content: flex-end;
  }

  h3,
  p {
    margin: 0;
  }

  h3 {
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
  }

  button {
    display: inline-flex;
    min-height: 2.35rem;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border-radius: 6px;
    padding: 0 0.85rem;
    color: var(--color-md3-primary-emphasis);
    background: transparent;
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    font-weight: 700;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 10%, transparent);
  }

  button:focus-visible {
    outline: 2px solid var(--color-md3-primary-emphasis);
    outline-offset: 2px;
  }

  button:disabled {
    opacity: 0.55;
  }

  .loading-state,
  .load-error {
    display: flex;
    min-height: 4.5rem;
    align-items: center;
    gap: 0.7rem;
    padding: 0.8rem 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
  }

  .load-error {
    align-items: flex-start;
    color: var(--color-md3-error);
  }

  .load-error p {
    margin-top: 0.18rem;
    overflow-wrap: anywhere;
    color: color-mix(in srgb, var(--color-md3-error) 76%, var(--color-md3-on-surface));
    line-height: 1.45;
  }

  .diagnostic-groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 1.5rem;
  }

  .diagnostic-group {
    min-width: 0;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 52%, transparent);
    padding: 1rem 0 1.1rem;
  }

  .diagnostic-group--wide {
    grid-column: 1 / -1;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.9rem;
    font-weight: 650;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem 1rem;
    margin: 0.85rem 0 0;
  }

  dl > div {
    min-width: 0;
  }

  .wide-row {
    grid-column: 1 / -1;
  }

  dt {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.7rem;
    font-weight: 650;
  }

  dd {
    margin: 0.2rem 0 0;
    overflow-wrap: anywhere;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-mono);
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .human-readable {
    font-family: var(--font-md3-sans);
  }

  ul {
    display: grid;
    margin: 0.7rem 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 42%, transparent);
    padding: 0.65rem 0;
  }

  li:first-child {
    border-top: 0;
  }

  li span {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  li strong,
  li small {
    overflow-wrap: anywhere;
  }

  li strong {
    color: var(--color-md3-on-surface);
    font-size: 0.82rem;
  }

  li small,
  .empty-copy {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.74rem;
  }

  code {
    flex: none;
    color: var(--color-md3-on-surface-variant);
    font: 0.74rem/1.4 var(--font-md3-mono);
  }

  .empty-copy {
    margin-top: 0.7rem;
  }

  .extension-flags {
    display: grid;
    gap: 0.25rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 42%, transparent);
    margin-top: 0.45rem;
    padding-top: 0.75rem;
  }

  .extension-flags strong {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.7rem;
  }

  .extension-flags code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--color-md3-on-surface);
  }

  @media (max-width: 640px) {
    button {
      width: fit-content;
      min-height: 2.75rem;
    }

    .diagnostic-groups {
      grid-template-columns: 1fr;
    }

    .diagnostic-group--wide {
      grid-column: auto;
    }
  }

  @media (max-width: 420px) {
    dl {
      grid-template-columns: 1fr;
    }

    .wide-row {
      grid-column: auto;
    }

    li {
      align-items: flex-start;
      flex-direction: column;
      gap: 0.3rem;
    }
  }
</style>
