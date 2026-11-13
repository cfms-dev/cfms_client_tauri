<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { listServerSettings, getServerSettings, updateServerSettings, getServerState, getAuthStatus, getUserInfo, serverErrorStatus, type ServerSettingDefinition, type ServerSettingsValues } from '$lib/api';
  import { authStore } from '$lib/features/authentication/auth-state.svelte';
  import { serverStateStore } from '$lib/features/connection/connection-state.svelte';
  import { dialogStore } from '$lib/shared/ui/dialogs.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
  import JsonCodeEditor from '$lib/shared/ui/JsonCodeEditor.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import { parseSetting, settingChanges, settingControl } from './server-settings';

  let definitions = $state<ServerSettingDefinition[]>([]);
  let namespace = $state('');
  let snapshot = $state<ServerSettingsValues | null>(null);
  let draft = $state<Record<string, string>>({});
  let search = $state('');
  let loading = $state(false);
  let busy = $state(false);
  let error = $state('');
  let message = $state('');
  let needsReload = $state(false);
  let sequence = 0;
  let allowNavigation = false;
  const canRead = $derived(authStore.permissions.includes('view_settings'));
  const canWrite = $derived(authStore.permissions.includes('manage_settings'));
  const scope = $derived(authStore.isLoggedIn && serverStateStore.connected ? JSON.stringify([serverStateStore.remoteAddress, authStore.userId]) : null);
  const namespaces = $derived([...new Set(definitions.map((item) => item.namespace))].sort());
  const currentDefinitions = $derived(definitions.filter((item) => item.namespace === namespace));
  const visibleDefinitions = $derived(currentDefinitions.filter((item) => `${item.option_key} ${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase())));
  const changes = $derived(settingChanges(currentDefinitions, snapshot, draft));
  const dirty = $derived(snapshot !== null && currentDefinitions.some((item) => draft[item.option_key] !== JSON.stringify(snapshot?.settings[item.option_key]?.value, null, 2)));
  const invalid = $derived(currentDefinitions.some((item) => !parseSetting(item, draft[item.option_key] ?? '')?.valid));

  $effect(() => {
    const activeScope = scope;
    const readable = canRead;
    untrack(() => {
      sequence += 1;
      definitions = []; snapshot = null; draft = {}; namespace = ''; error = ''; message = ''; needsReload = false; loading = false; busy = false;
      if (activeScope && readable) void discover(activeScope);
    });
    return () => { sequence += 1; };
  });

  beforeNavigate((navigation) => {
    if (allowNavigation || (!dirty && !busy)) return;
    navigation.cancel();
    if (navigation.willUnload) return;
    void canLeave().then((leave) => {
      if (leave && navigation.to) {
        allowNavigation = true;
        void goto(navigation.to.url.href).finally(() => { allowNavigation = false; });
      }
    });
  });

  function applySnapshot(result: ServerSettingsValues) {
    snapshot = result;
    draft = Object.fromEntries(Object.entries(result.settings).map(([key, item]) => [key, JSON.stringify(item.value, null, 2)]));
    needsReload = false;
  }
  async function discover(activeScope: string) {
    const request = ++sequence;
    loading = true;
    try {
      const result = await listServerSettings();
      if (scope !== activeScope || request !== sequence) return;
      definitions = result.items;
      const available = [...new Set(result.items.map((item) => item.namespace))].sort();
      namespace = available.includes(namespace) ? namespace : available[0] ?? '';
      if (namespace) await readNamespace(namespace, activeScope, request);
    } catch (err) { if (scope === activeScope && request === sequence) error = formatUserFacingError(err); }
    finally { if (scope === activeScope && request === sequence) loading = false; }
  }
  async function readNamespace(next: string, activeScope: string, request = ++sequence) {
    loading = true; error = ''; message = '';
    try {
      const result = await getServerSettings(next);
      if (scope !== activeScope || request !== sequence || namespace !== next) return;
      applySnapshot(result);
    } catch (err) {
      if (scope === activeScope && request === sequence) error = formatUserFacingError(err);
    } finally { if (scope === activeScope && request === sequence) loading = false; }
  }
  export async function canLeave(): Promise<boolean> {
    if (busy) return false;
    if (!dirty) return true;
    return dialogStore.confirm({ message: $t('serverSettings.leaveChanges'), confirmLabel: $t('authManagement.discard'), danger: true });
  }
  export async function refresh() {
    if (!scope || !canRead || busy || !(await canLeave())) return;
    await discover(scope);
  }
  async function selectNamespace(next: string) {
    if (next === namespace || busy || !scope || !(await canLeave())) return;
    namespace = next; snapshot = null; draft = {};
    await readNamespace(next, scope);
  }
  async function save() {
    if (!scope || busy || loading || !canWrite || invalid || needsReload || !Object.keys(changes).length) return;
    const activeScope = scope; const activeNamespace = namespace; const request = ++sequence;
    busy = true; error = ''; message = '';
    try {
      const result = await updateServerSettings(namespace, changes);
      if (scope !== activeScope || namespace !== activeNamespace || request !== sequence) return;
      applySnapshot({ namespace, settings: { ...snapshot!.settings, ...result.settings } });
      message = $t('serverSettings.saved');
      if (namespace === 'server' && result.settings.name) {
        const state = await getServerState();
        if (scope === activeScope && request === sequence) serverStateStore.apply(state);
      }
    } catch (err) {
      if (scope !== activeScope || request !== sequence) return;
      const code = serverErrorStatus(err);
      needsReload = code === 409 || code === 404 || String(err).includes('CFMS_REQUEST_UNCONFIRMED');
      error = $t(code === 409 ? 'serverSettings.conflict' : code === 400 ? 'serverSettings.invalid' : code === 404 ? 'serverSettings.unavailable' : needsReload ? 'protocol30.unconfirmed' : 'serverSettings.failed');
      if (code === 403) {
        error = $t('serverSettings.denied');
        try { if (authStore.userId) await getUserInfo({ userId: authStore.userId }); const status = await getAuthStatus(); if (scope === activeScope && request === sequence) authStore.apply(status); } catch { /* Keep the original denial visible. */ }
      }
    } finally { if (scope === activeScope && request === sequence) busy = false; }
  }
  function scalarValue(item: ServerSettingDefinition) { return parseSetting(item, draft[item.option_key] ?? '')?.value; }
</script>

<section class="server-settings" aria-label={$t('serverSettings.title')}>
  <header>
    <div><h2>{$t('serverSettings.title')}</h2><p>{$t('serverSettings.description')}</p></div>
    <FluentButton appearance="outline" onclick={() => void refresh()} disabled={!scope || busy || loading || !canRead}>{$t('common.refresh')}</FluentButton>
  </header>
  {#if !canRead}<p role="status">{$t('serverSettings.readRequired')}</p>
  {:else if !scope}<p role="status">{$t('serverSettings.disconnected')}</p>
  {:else}
    <div class="filters">
      <MdOutlinedField inputId="setting-namespace" label={$t('serverSettings.namespace')} disabled={loading || busy}>
        <select id="setting-namespace" data-focus-ring="delegated" class="cfms-native-field" value={namespace} disabled={loading || busy} onchange={(event) => { const next = event.currentTarget.value; event.currentTarget.value = namespace; void selectNamespace(next); }}>
          {#each namespaces as item}<option value={item}>{item}</option>{/each}
        </select>
      </MdOutlinedField>
      <MdOutlinedField inputId="setting-search" label={$t('serverSettings.search')}>
        <input id="setting-search" data-focus-ring="delegated" class="cfms-native-field" type="search" bind:value={search} />
      </MdOutlinedField>
    </div>
    {#if !canWrite}<p class="notice">{$t('serverSettings.readOnly')}</p>{/if}
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#if loading}<ProgressRing size={24} label={$t('common.loading')} />
    {:else if !definitions.length}<p>{$t('serverSettings.empty')}</p>
    {:else if snapshot}
      <div class="setting-list">
        {#each visibleDefinitions as item (item.option_key)}
          {@const key = item.option_key}
          {@const control = settingControl(item)}
          {@const disabled = !canWrite || busy || needsReload}
          {@const parsed = parseSetting(item, draft[key] ?? '')}
          <div class="setting-row">
            <div class="setting-copy"><h3>{item.title}</h3><p>{item.description}</p><code>{key}</code><small>{$t('serverSettings.revision', { values: { revision: snapshot.settings[key]?.revision ?? 0 } })} · {item.owner}</small></div>
            <div class="setting-editor">
              {#if control === 'boolean'}
                <MdSwitch checked={scalarValue(item) === true} ariaLabel={item.title} {disabled} onChange={(checked) => { draft[key] = JSON.stringify(checked); }} />
              {:else if control === 'enum'}
                <MdOutlinedField inputId={`setting-${key}`} label={item.title} {disabled}>
                  <select id={`setting-${key}`} data-focus-ring="delegated" class="cfms-native-field" value={JSON.stringify(scalarValue(item))} {disabled} onchange={(event) => { draft[key] = event.currentTarget.value; }}>
                    {#each (Array.isArray(item.value_schema.enum) ? item.value_schema.enum : []) as option}<option value={JSON.stringify(option)}>{typeof option === 'string' ? option : JSON.stringify(option)}</option>{/each}
                  </select>
                </MdOutlinedField>
              {:else if control === 'json'}
                <JsonCodeEditor value={draft[key] ?? ''} ariaLabel={item.title} loadingLabel={$t('common.loading')} {disabled} onChange={(value) => { draft[key] = value; }} />
              {:else}
                <MdOutlinedField inputId={`setting-${key}`} label={item.title} error={!parsed?.valid} {disabled}>
                  <input id={`setting-${key}`} data-focus-ring="delegated" class="cfms-native-field" type={control === 'string' ? 'text' : 'number'} step={control === 'integer' ? '1' : 'any'} value={control === 'string' ? String(scalarValue(item) ?? '') : draft[key] ?? ''} {disabled} aria-invalid={!parsed?.valid} oninput={(event) => { draft[key] = control === 'string' ? JSON.stringify(event.currentTarget.value) : event.currentTarget.value; }} />
                </MdOutlinedField>
              {/if}
              {#if !parsed?.valid}<p class="error">{$t('serverSettings.valueInvalid')}</p>{/if}
              <FluentButton appearance="subtle" {disabled} onclick={() => { draft[key] = JSON.stringify(item.default, null, 2); }}>{$t('serverSettings.restoreDefault')}</FluentButton>
            </div>
          </div>
        {/each}
        {#if !visibleDefinitions.length}<p>{$t('serverSettings.noMatches')}</p>{/if}
      </div>
      <footer><span>{dirty ? $t('serverSettings.unsaved') : $t('serverSettings.upToDate')}</span><FluentButton appearance="primary" disabled={!canWrite || busy || invalid || needsReload || !Object.keys(changes).length} onclick={() => void save()}>{$t(busy ? 'common.saving' : 'common.save')}</FluentButton></footer>
    {/if}
  {/if}
</section>

<style>
  .server-settings { padding: 24px; color: var(--colorNeutralForeground1); }
  header, footer { display: flex; gap: 16px; align-items: center; justify-content: space-between; }
  h2 { font-size: 20px; line-height: 26px; font-weight: 600; margin: 0; }
  h3 { font-size: 14px; font-weight: 600; margin: 0; }
  p { font-size: 14px; line-height: 20px; margin: 4px 0 0; }
  header p, .setting-copy p, small, footer span { color: var(--colorNeutralForeground2); }
  .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
  .setting-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 1fr); gap: 24px; padding: 24px 0; border-bottom: 1px solid var(--colorNeutralStroke2); }
  .setting-copy { min-width: 0; overflow-wrap: anywhere; }
  code, small { display: block; font-size: 12px; margin-top: 8px; }
  code { font-family: var(--font-cfms-mono); }
  .setting-editor { min-width: 0; display: grid; justify-items: stretch; gap: 8px; align-content: start; }
  .setting-editor :global(.cfms-choice-target) { justify-self: start; }
  .setting-editor > :global(fluent-button) { justify-self: end; }
  select { width: 100%; min-width: 0; }
  .error { color: var(--colorStatusDangerForeground1); }
  .notice { margin-bottom: 16px; }
  footer { padding-top: 24px; }
  @media (max-width: 700px) { .server-settings { padding: 16px; } .setting-row, .filters { grid-template-columns: 1fr; } }
</style>
