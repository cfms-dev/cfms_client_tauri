import { untrack } from 'svelte';
import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import { listServerSettings, getServerSettings, updateServerSettings, getServerState, getAuthStatus, getUserInfo, serverErrorStatus, type ServerSettingDefinition, type ServerSettingsValues } from '$lib/api';
import { authStore } from '$lib/features/authentication/auth-state.svelte';
import { serverStateStore } from '$lib/features/connection/connection-state.svelte';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte';
import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
import { parseSetting, settingChanges } from './server-settings';

interface NamespaceState {
  status: 'queued' | 'loading' | 'ready' | 'failed';
  snapshot: ServerSettingsValues | null;
  draft: Record<string, string>;
  error: string;
  needsReload: boolean;
}

const translate = (key: string, values?: Record<string, string | number>) => get(t)(key, { values });
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

// Keep esbuild's pure annotation outside effects removed by Svelte's server compiler.
function createNamespaceEntries(): Record<string, NamespaceState> {
  return Object.create(null);
}

export function createServerSettingsWorkspace() {
  let definitions = $state<ServerSettingDefinition[]>([]);
  let entries = $state<Record<string, NamespaceState>>(createNamespaceEntries());
  let selectedNamespaces = $state<string[]>([]);
  let search = $state('');
  let discovering = $state(false);
  let discovered = $state(false);
  let saving = $state(false);
  let error = $state('');
  let message = $state('');
  let slow = $state(false);
  let generation = 0;

  const canRead = $derived(authStore.permissions.includes('view_settings'));
  const canWrite = $derived(authStore.permissions.includes('manage_settings'));
  const scope = $derived(authStore.isLoggedIn && serverStateStore.connected ? JSON.stringify([serverStateStore.remoteAddress, authStore.userId]) : null);
  const namespaces = $derived(Object.keys(entries).sort(compare));
  const reading = $derived(discovering || namespaces.some((ns) => entries[ns].status === 'queued' || entries[ns].status === 'loading'));
  const loadedCount = $derived(namespaces.filter((ns) => entries[ns].status === 'ready').length);
  const failedNamespaces = $derived(namespaces.filter((ns) => entries[ns].status === 'failed'));
  const visibleDefinitions = $derived(definitions.filter((item) =>
    (!selectedNamespaces.length || selectedNamespaces.includes(item.namespace))
      && `${item.namespace}::${item.option_key} ${item.title} ${item.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const dirtyDefinitions = $derived(definitions.filter((item) => {
    const entry = entries[item.namespace];
    const original = entry.snapshot?.settings[item.option_key];
    if (!original) return false;
    const parsed = parseSetting(item, entry.draft[item.option_key] ?? '');
    return !parsed?.valid || JSON.stringify(parsed.value) !== JSON.stringify(original.value);
  }));
  const invalid = $derived(dirtyDefinitions.some((item) => !parseSetting(item, entries[item.namespace].draft[item.option_key] ?? '')?.valid));
  const needsReload = $derived(namespaces.some((ns) => entries[ns].needsReload));
  const saveDisabled = $derived(!scope || !canWrite || saving || invalid || needsReload || !dirtyDefinitions.length);
  const refreshState = {
    get disabled() { return !scope || !canRead || reading || saving; },
    get busy() { return reading || saving; },
  };

  $effect(() => {
    const activeScope = scope;
    const readable = canRead;
    untrack(() => {
      generation += 1;
      definitions = []; entries = createNamespaceEntries(); selectedNamespaces = []; search = '';
      discovering = false; discovered = false; saving = false; error = ''; message = '';
      if (activeScope && readable) void discover(activeScope);
    });
    return () => { generation += 1; };
  });

  $effect(() => {
    if (!reading) { slow = false; return; }
    const timer = setTimeout(() => { slow = true; }, 5000);
    return () => clearTimeout(timer);
  });

  function current(activeScope: string, batch: number) {
    return scope === activeScope && canRead && generation === batch;
  }
  function readError(err: unknown) {
    return String(err).includes('CFMS_SETTINGS_READ_TIMEOUT') ? translate('serverSettings.readTimeout') : formatUserFacingError(err);
  }
  async function discover(activeScope: string) {
    const batch = ++generation;
    discovering = true; discovered = false; error = ''; message = ''; definitions = []; entries = createNamespaceEntries();
    try {
      const result = await listServerSettings();
      if (!current(activeScope, batch)) return;
      definitions = result.items.slice().sort((a, b) => compare(a.namespace, b.namespace) || compare(a.option_key, b.option_key));
      entries = Object.fromEntries([...new Set(definitions.map((item) => item.namespace))].map((ns) => [ns, {
        status: 'queued', snapshot: null, draft: {}, error: '', needsReload: false,
      }]));
      selectedNamespaces = selectedNamespaces.filter((ns) => Object.hasOwn(entries, ns));
      discovered = true;
      pump(activeScope, batch);
    } catch (err) { if (current(activeScope, batch)) error = readError(err); }
    finally { if (current(activeScope, batch)) discovering = false; }
  }
  function pump(activeScope: string, batch: number) {
    if (!current(activeScope, batch)) return;
    const active = namespaces.filter((ns) => entries[ns].status === 'loading').length;
    const preferred = new Set(visibleDefinitions.map((item) => item.namespace));
    const queued = namespaces.filter((ns) => entries[ns].status === 'queued')
      .sort((a, b) => Number(preferred.has(b)) - Number(preferred.has(a)) || compare(a, b));
    for (const ns of queued.slice(0, Math.max(0, 4 - active))) {
      entries[ns].status = 'loading';
      void readNamespace(ns, activeScope, batch);
    }
  }
  async function readNamespace(ns: string, activeScope: string, batch: number) {
    const entry = entries[ns];
    try {
      const result = await getServerSettings(ns);
      if (!current(activeScope, batch) || entries[ns] !== entry) return;
      // A partial/mismatched response must never turn missing values into defaults.
      if (result.namespace !== ns || definitions.some((item) => item.namespace === ns && !Object.hasOwn(result.settings, item.option_key))) {
        throw new Error(translate('serverSettings.incompleteRead'));
      }
      entry.snapshot = result;
      entry.draft = Object.fromEntries(Object.entries(result.settings).map(([key, item]) => [key, JSON.stringify(item.value, null, 2)]));
      entry.status = 'ready'; entry.error = '';
    } catch (err) {
      if (!current(activeScope, batch) || entries[ns] !== entry) return;
      entry.status = 'failed'; entry.error = readError(err);
    } finally { if (current(activeScope, batch)) pump(activeScope, batch); }
  }
  function retry(names = failedNamespaces) {
    if (!scope || !canRead || saving) return;
    for (const ns of names) {
      if (entries[ns]?.status !== 'failed') continue;
      entries[ns].status = 'queued'; entries[ns].error = '';
    }
    pump(scope, generation);
  }
  async function canLeave(): Promise<boolean> {
    if (saving) return false;
    if (!dirtyDefinitions.length) return true;
    return dialogStore.confirm({ message: translate('serverSettings.leaveChanges'), confirmLabel: translate('authManagement.discard'), danger: true });
  }
  async function refresh() {
    if (!scope || refreshState.disabled || !(await canLeave()) || refreshState.disabled) return;
    await discover(scope);
  }
  async function save() {
    if (!scope || saveDisabled) return;
    const activeScope = scope; const batch = generation;
    const submissions = namespaces.map((ns) => ({ ns, changes: settingChanges(definitions.filter((item) => item.namespace === ns), entries[ns].snapshot, entries[ns].draft) }))
      .filter(({ changes }) => Object.keys(changes).length);
    saving = true; error = ''; message = '';
    let savedCount = 0;
    let activeNamespace = '';
    try {
      for (const { ns, changes } of submissions) {
        if (!current(activeScope, batch)) return;
        activeNamespace = ns;
        if (!canWrite) throw new Error('Server returned 403: Permission denied');
        const result = await updateServerSettings(ns, changes);
        if (!current(activeScope, batch)) return;
        const entry = entries[ns];
        entry.snapshot = { namespace: ns, settings: { ...entry.snapshot!.settings, ...result.settings } };
        for (const [key, value] of Object.entries(result.settings)) entry.draft[key] = JSON.stringify(value.value, null, 2);
        savedCount += Object.keys(changes).length;
        if (ns === 'server' && result.settings.name) {
          // A display refresh failure must not report a committed write as failed.
          void getServerState().then((state) => { if (current(activeScope, batch)) serverStateStore.apply(state); }).catch(() => { /* Next workspace refresh reconciles the name. */ });
        }
      }
      if (current(activeScope, batch)) message = translate('serverSettings.saved');
    } catch (err) {
      if (!current(activeScope, batch)) return;
      const code = serverErrorStatus(err);
      const entry = entries[activeNamespace];
      entry.needsReload = code === 409 || code === 404 || String(err).includes('CFMS_REQUEST_UNCONFIRMED');
      const reason = translate(code === 409 ? 'serverSettings.conflict' : code === 400 ? 'serverSettings.invalid' : code === 404 ? 'serverSettings.unavailable' : code === 403 ? 'serverSettings.denied' : entry.needsReload ? 'protocol30.unconfirmed' : 'serverSettings.failed');
      error = `${activeNamespace}: ${reason}`;
      if (savedCount) message = translate('serverSettings.partiallySaved', { count: savedCount });
      if (code === 403) {
        try { if (authStore.userId) await getUserInfo({ userId: authStore.userId }); const status = await getAuthStatus(); if (current(activeScope, batch)) authStore.apply(status); } catch { /* Keep the denial visible. */ }
      }
    } finally { if (current(activeScope, batch)) saving = false; }
  }

  return {
    get definitions() { return definitions; }, get entries() { return entries; },
    get namespaces() { return namespaces; }, get visibleDefinitions() { return visibleDefinitions; },
    get selectedNamespaces() { return selectedNamespaces; }, set selectedNamespaces(value: string[]) { selectedNamespaces = value; },
    get search() { return search; }, set search(value: string) { search = value; },
    get discovering() { return discovering; }, get discovered() { return discovered; },
    get reading() { return reading; }, get slow() { return slow; }, get loadedCount() { return loadedCount; },
    get failedNamespaces() { return failedNamespaces; }, get saving() { return saving; },
    get canRead() { return canRead; }, get canWrite() { return canWrite; }, get scope() { return scope; },
    get error() { return error; }, get message() { return message; },
    get dirtyCount() { return dirtyDefinitions.length; }, get invalid() { return invalid; },
    get saveDisabled() { return saveDisabled; }, refreshState, retry, refresh, canLeave, save,
  };
}
