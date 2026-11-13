<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import type { ServerSettingDefinition } from '$lib/api';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MultiSelectFilter from '$lib/shared/ui/MultiSelectFilter.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
  import JsonCodeEditor from '$lib/shared/ui/JsonCodeEditor.svelte';
  import { parseSetting, settingControl } from './server-settings';
  import { createServerSettingsWorkspace } from './server-settings-workspace.svelte';

  const workspace = createServerSettingsWorkspace();
  export const refreshState = workspace.refreshState;
  export const refresh = workspace.refresh;
  export const canLeave = workspace.canLeave;
  let allowNavigation = false;

  beforeNavigate((navigation) => {
    if (allowNavigation || (!workspace.dirtyCount && !workspace.saving)) return;
    navigation.cancel();
    if (navigation.willUnload) return;
    void canLeave().then((leave) => {
      if (leave && navigation.to) {
        allowNavigation = true;
        void goto(navigation.to.url.href).finally(() => { allowNavigation = false; });
      }
    });
  });
  function scalarValue(item: ServerSettingDefinition) {
    return parseSetting(item, workspace.entries[item.namespace].draft[item.option_key] ?? '')?.value;
  }
  function clearFilters() { workspace.selectedNamespaces = []; workspace.search = ''; }
</script>

<section class="server-settings" aria-label={$t('serverSettings.title')}>
  {#if !workspace.canRead}<p role="status">{$t('serverSettings.readRequired')}</p>
  {:else if !workspace.scope}<p role="status">{$t('serverSettings.disconnected')}</p>
  {:else}
    <div class="filters">
      <MdOutlinedField inputId="setting-search" label={$t('serverSettings.search')}>
        <input id="setting-search" data-focus-ring="delegated" class="cfms-native-field" type="search" bind:value={workspace.search} />
      </MdOutlinedField>
      <MultiSelectFilter availableOptions={workspace.namespaces} selectedOptions={workspace.selectedNamespaces}
        disabled={!workspace.discovered || !workspace.namespaces.length}
        onApply={(values) => { workspace.selectedNamespaces = values; }} labels={{
          label: $t('serverSettings.namespace'), button: $t('serverSettings.filterButton', { values: { count: workspace.selectedNamespaces.length } }),
          title: $t('serverSettings.filterTitle'), help: $t('serverSettings.filterHelp'),
          search: $t('serverSettings.filterSearch'), searchPlaceholder: $t('serverSettings.filterSearch'),
          clearSearch: $t('serverSettings.clearSearch'), options: $t('serverSettings.namespace'),
          noMatches: $t('serverSettings.filterNoMatches'), noSuggestions: $t('serverSettings.empty'),
          selected: (count) => $t('serverSettings.filterSelected', { values: { count } }), apply: $t('serverSettings.filterApply'),
        }} />
    </div>
    {#if workspace.selectedNamespaces.length}
      <div class="filter-tags" aria-label={$t('serverSettings.activeFilters')}>
        {#each workspace.selectedNamespaces as ns (ns)}
          <FluentButton appearance="subtle" class="namespace-tag" data-fluent-owner="server-settings"
            aria-label={$t('serverSettings.removeFilter', { values: { namespace: ns } })}
            onclick={() => { workspace.selectedNamespaces = workspace.selectedNamespaces.filter((value) => value !== ns); }}>
            <code>{ns}</code><Icon name="close" size={16} />
          </FluentButton>
        {/each}
      </div>
    {/if}
    <div class="load-status" class:has-progress={workspace.discovering || workspace.namespaces.length > 0} role="status" aria-live="polite" aria-atomic="true">
      {#if workspace.discovering}<p>{$t('serverSettings.discovering')}</p>
      {:else if workspace.namespaces.length}<p>{$t('serverSettings.loadProgress', { values: { loaded: workspace.loadedCount, total: workspace.namespaces.length } })}</p>{/if}
      <p class="slow-hint">{#if workspace.slow}{$t('serverSettings.slowLoading')}{/if}</p>
    </div>
    {#if !workspace.canWrite}<p class="notice">{$t('serverSettings.readOnly')}</p>{/if}
    {#if workspace.error}
      <div role="alert" class="error notice"><p>{workspace.error}</p>
        {#if !workspace.discovered}<FluentButton disabled={refreshState.disabled} onclick={() => void refresh()}>{$t('serverSettings.retry')}</FluentButton>{/if}
      </div>
    {/if}
    {#if workspace.failedNamespaces.length}
      <div class="read-errors notice">
        <p role="alert">{$t(workspace.failedNamespaces.length === workspace.namespaces.length ? 'serverSettings.allReadsFailed' : 'serverSettings.someReadsFailed')}</p>
        <ul>
          {#each workspace.failedNamespaces as ns (ns)}
            <li><span><code>{ns}</code> · {workspace.entries[ns].error}</span>
              <FluentButton appearance="subtle" disabled={workspace.saving} aria-label={$t('serverSettings.retryNamespace', { values: { namespace: ns } })} onclick={() => workspace.retry([ns])}>{$t('serverSettings.retry')}</FluentButton>
            </li>
          {/each}
        </ul>
        {#if workspace.failedNamespaces.length > 1}<FluentButton disabled={workspace.saving} onclick={() => workspace.retry()}>{$t('serverSettings.retryFailed')}</FluentButton>{/if}
      </div>
    {/if}
    {#if workspace.message}<p role="status">{workspace.message}</p>{/if}
    {#if workspace.invalid}
      <div class="invalid-notice notice" role="alert"><p>{$t('serverSettings.invalidDrafts')}</p>
        <FluentButton appearance="subtle" onclick={clearFilters}>{$t('serverSettings.clearFilters')}</FluentButton>
      </div>
    {/if}
    {#if workspace.discovering}
      <div class="discovery-skeleton" aria-hidden="true">
        {#each [0, 1, 2] as row (row)}<div class="skeleton-row"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-description"></span></div>{/each}
      </div>
    {:else if workspace.discovered && !workspace.definitions.length}<p>{$t('serverSettings.empty')}</p>
    {:else if workspace.discovered}
      <div class="setting-list">
        {#each workspace.visibleDefinitions as item (JSON.stringify([item.namespace, item.option_key]))}
          {@const key = item.option_key}
          {@const entry = workspace.entries[item.namespace]}
          {@const control = settingControl(item)}
          {@const inputId = `setting-${encodeURIComponent(item.namespace)}:${encodeURIComponent(key)}`}
          {@const disabled = !workspace.canWrite || workspace.saving || entry.needsReload}
          {@const parsed = entry.status === 'ready' ? parseSetting(item, entry.draft[key] ?? '') : null}
          <div class="setting-row">
            <div class="setting-copy"><h3>{item.title}</h3><p>{item.description}</p><code>{item.namespace}::{key}</code></div>
            <div class="setting-editor" class:json-editor={control === 'json'} aria-busy={entry.status === 'loading' || entry.status === 'queued'}>
              {#if entry.status === 'failed'}
                <div class="editor-placeholder"><p>{$t('serverSettings.notLoaded')}</p></div>
              {:else if entry.status !== 'ready'}
                <div class="editor-placeholder" aria-label={$t('common.loading')}>
                  <span class="skeleton" class:skeleton-switch={control === 'boolean'} aria-hidden="true"></span>
                  <span class="skeleton skeleton-reset" aria-hidden="true"></span>
                </div>
              {:else}
                {#if control === 'boolean'}
                  <MdSwitch checked={scalarValue(item) === true} ariaLabel={item.title} {disabled} onChange={(checked) => { entry.draft[key] = JSON.stringify(checked); }} />
                {:else if control === 'enum'}
                  <MdOutlinedField {inputId} label={item.title} {disabled}>
                    <select id={inputId} data-focus-ring="delegated" class="cfms-native-field" value={JSON.stringify(scalarValue(item))} {disabled} onchange={(event) => { entry.draft[key] = event.currentTarget.value; }}>
                      {#each (Array.isArray(item.value_schema.enum) ? item.value_schema.enum : []) as option}<option value={JSON.stringify(option)}>{typeof option === 'string' ? option : JSON.stringify(option)}</option>{/each}
                    </select>
                  </MdOutlinedField>
                {:else if control === 'json'}
                  <JsonCodeEditor value={entry.draft[key] ?? ''} ariaLabel={item.title} loadingLabel={$t('common.loading')} {disabled} onChange={(value) => { entry.draft[key] = value; }} />
                {:else}
                  <MdOutlinedField {inputId} label={item.title} error={!parsed?.valid} {disabled}>
                    <input id={inputId} data-focus-ring="delegated" class="cfms-native-field" type={control === 'string' ? 'text' : 'number'} step={control === 'integer' ? '1' : 'any'} value={control === 'string' ? String(scalarValue(item) ?? '') : entry.draft[key] ?? ''} {disabled} aria-invalid={!parsed?.valid} oninput={(event) => { entry.draft[key] = control === 'string' ? JSON.stringify(event.currentTarget.value) : event.currentTarget.value; }} />
                  </MdOutlinedField>
                {/if}
                {#if !parsed?.valid}<p class="error">{$t('serverSettings.valueInvalid')}</p>{/if}
                <FluentButton appearance="subtle" iconOnly {disabled} aria-label={$t('serverSettings.restoreDefault')} title={$t('serverSettings.restoreDefault')} onclick={() => { entry.draft[key] = JSON.stringify(item.default, null, 2); }}>
                  <Icon name="tagReset" size={20} />
                </FluentButton>
              {/if}
            </div>
          </div>
        {:else}<p class="no-matches">{$t('serverSettings.noMatches')}</p>{/each}
      </div>
      <footer>
        <div><p>{workspace.dirtyCount ? $t('serverSettings.pendingCount', { values: { count: workspace.dirtyCount } }) : $t('serverSettings.upToDate')}</p>
          <small>{$t('serverSettings.saveAllHint')}</small>
          {#if workspace.reading || workspace.failedNamespaces.length}<small>{$t('serverSettings.incompleteLoading', { values: { count: workspace.namespaces.length - workspace.loadedCount } })}</small>{/if}
        </div>
        <FluentButton appearance="primary" disabled={workspace.saveDisabled} onclick={() => void workspace.save()}>{$t(workspace.saving ? 'common.saving' : 'common.save')}</FluentButton>
      </footer>
    {/if}
  {/if}
</section>

<style>
  .server-settings { padding: 24px; color: var(--colorNeutralForeground1); }
  h3 { font-size: 14px; font-weight: 600; line-height: 20px; margin: 0; }
  p { font-size: 14px; line-height: 20px; margin: 4px 0 0; }
  .setting-copy p, .load-status, footer, .editor-placeholder { color: var(--colorNeutralForeground2); }
  .filters { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-bottom: 16px; }
  .filter-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .filter-tags :global(.namespace-tag[data-fluent-owner="server-settings"]) { background: var(--colorBrandBackground2); color: var(--colorBrandForeground1); }
  .filter-tags code { margin: 0; font-size: 12px; }
  .load-status { display: none; }
  .load-status.has-progress { display: block; margin-bottom: 8px; }
  .slow-hint { min-height: 20px; }
  .setting-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 1fr); gap: 24px; padding: 24px 0; border-bottom: 1px solid var(--colorNeutralStroke2); }
  .setting-copy { min-width: 0; overflow-wrap: anywhere; }
  code { display: block; font-size: 12px; line-height: 16px; margin-top: 8px; font-family: var(--font-cfms-mono); overflow-wrap: anywhere; }
  .setting-editor { min-width: 0; min-height: calc(var(--cfms-field-height-medium) + var(--cfms-control-height-medium) + 8px); display: grid; justify-items: stretch; gap: 8px; align-content: start; }
  .json-editor { min-height: calc(12rem + var(--cfms-control-height-medium) + 10px); }
  .setting-editor :global(.cfms-choice-target), .setting-editor > :global(fluent-button) { justify-self: end; }
  select { width: 100%; min-width: 0; }
  .error { color: var(--colorStatusDangerForeground1); }
  .notice { margin: 16px 0; }
  .read-errors { border: 1px solid var(--colorNeutralStroke2); border-radius: 8px; padding: 16px; }
  .read-errors ul { list-style: none; margin: 8px 0; padding: 0; }
  .read-errors li { display: flex; align-items: center; justify-content: space-between; gap: 12px; overflow-wrap: anywhere; }
  .read-errors li span { min-width: 0; font-size: 12px; line-height: 16px; }
  .read-errors code { display: inline; }
  .invalid-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  footer { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding-top: 24px; }
  footer p { margin: 0; }
  small { display: block; font-size: 12px; line-height: 16px; margin-top: 4px; }
  .editor-placeholder { display: grid; gap: 8px; }
  .skeleton { display: block; height: var(--cfms-field-height-medium); border-radius: var(--borderRadiusSmall); background: color-mix(in srgb, var(--colorNeutralForeground1) 8%, transparent); }
  .skeleton-switch { width: 40px; height: var(--cfms-control-height-medium); justify-self: end; }
  .skeleton-reset { width: var(--cfms-control-height-medium); height: var(--cfms-control-height-medium); justify-self: end; }
  .json-editor .editor-placeholder .skeleton:first-child { height: 12rem; }
  .skeleton-row { display: grid; gap: 12px; padding: 24px 0; }
  .skeleton-title { width: min(40%, 240px); height: 20px; }
  .skeleton-description { width: min(75%, 560px); height: 16px; }
  .no-matches { padding: 24px 0; }
  @media (max-width: 700px) { .server-settings { padding: 16px; } .setting-row { grid-template-columns: 1fr; gap: 16px; } }
  @media (max-width: 400px) { .filters { grid-template-columns: 1fr; } .read-errors li, .invalid-notice { flex-wrap: wrap; } }
  @media (forced-colors: active) { .skeleton { background: GrayText; opacity: 0.2; } .filter-tags :global(.namespace-tag[data-fluent-owner="server-settings"]) { border: 1px solid ButtonText; color: ButtonText; background: ButtonFace; } }
</style>
