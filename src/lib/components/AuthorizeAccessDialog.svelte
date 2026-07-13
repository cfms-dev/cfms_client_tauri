<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import {
    listGroups,
    listUsers,
    type AccessEntityType,
    type AccessType,
    type ManagedGroup,
    type ManagedUser,
    type ServerObjectType,
  } from '$lib/api';
  import {
    createDefaultAccessGrantTimeInputs,
    parseAccessGrantTimestamp,
    type AccessGrantFormValue,
  } from '$lib/access-grants';
  import { ACCESS_OPERATIONS } from '$lib/access-rules';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  interface EntityOption {
    id: string;
    label: string;
    description: string;
  }

  interface Props {
    targetName: string;
    targetType: ServerObjectType;
    canListUsers: boolean;
    canListGroups: boolean;
    saving?: boolean;
    onSubmit: (value: AccessGrantFormValue) => Promise<void> | void;
    onCancel: () => void;
  }

  let {
    targetName,
    targetType,
    canListUsers,
    canListGroups,
    saving = false,
    onSubmit,
    onCancel,
  }: Props = $props();

  const accessTypeOptions: readonly AccessType[] = ACCESS_OPERATIONS;
  const defaultTimeInputs = createDefaultAccessGrantTimeInputs();

  let entityType = $state<AccessEntityType>('user');
  let entityQuery = $state('');
  let selectedEntity = $state<EntityOption | null>(null);
  let entityResults = $state<EntityOption[]>([]);
  let searching = $state(false);
  let searchCompleted = $state(false);
  let formError = $state<string | null>(null);
  let accessTypes = $state<Set<AccessType>>(new Set(['read']));
  let startDate = $state(defaultTimeInputs.startDate);
  let startTime = $state(defaultTimeInputs.startTime);
  let endDate = $state(defaultTimeInputs.endDate);
  let endTime = $state(defaultTimeInputs.endTime);

  const canSearchCurrentEntity = $derived(
    entityType === 'user' ? canListUsers : canListGroups,
  );
  const targetTypeLabel = $derived(
    targetType === 'document' ? $t('files.document') : $t('files.directory'),
  );

  function setEntityType(nextType: AccessEntityType) {
    if (entityType === nextType || saving) return;
    entityType = nextType;
    entityQuery = '';
    selectedEntity = null;
    entityResults = [];
    searchCompleted = false;
    formError = null;
  }

  function handleEntityInput() {
    selectedEntity = null;
    searchCompleted = false;
    formError = null;
  }

  async function searchEntities() {
    const query = entityQuery.trim().toLowerCase();
    if (!canSearchCurrentEntity || saving || searching) return;

    if (!query) {
      formError = $t('files.authorizeSearchRequired');
      return;
    }

    searching = true;
    formError = null;
    selectedEntity = null;
    searchCompleted = false;

    try {
      const options = entityType === 'user'
        ? usersToOptions(await listUsers())
        : groupsToOptions(await listGroups());

      entityResults = options.filter((option) => {
        const haystack = `${option.id} ${option.label} ${option.description}`.toLowerCase();
        return haystack.includes(query);
      });
      searchCompleted = true;
    } catch (err) {
      formError = String(err);
      entityResults = [];
    } finally {
      searching = false;
    }
  }

  function usersToOptions(users: ManagedUser[]): EntityOption[] {
    return users.map((user) => ({
      id: user.username,
      label: user.username,
      description: user.nickname ?? '',
    }));
  }

  function groupsToOptions(groups: ManagedGroup[]): EntityOption[] {
    return groups.map((group) => ({
      id: group.name,
      label: group.name,
      description: group.display_name ?? '',
    }));
  }

  function selectEntity(option: EntityOption) {
    selectedEntity = option;
    entityQuery = option.id;
    formError = null;
  }

  function toggleAccessType(accessType: AccessType) {
    if (saving) return;
    const next = new Set(accessTypes);
    if (next.has(accessType)) {
      next.delete(accessType);
    } else {
      next.add(accessType);
    }
    accessTypes = next;
    formError = null;
  }

  async function submitGrant() {
    const entityIdentifier = canSearchCurrentEntity
      ? selectedEntity?.id
      : entityQuery.trim();

    if (!entityIdentifier) {
      formError = canSearchCurrentEntity
        ? $t('files.authorizeSelectEntityError')
        : $t('files.authorizeEntityRequired');
      return;
    }

    const selectedAccessTypes = Array.from(accessTypes);
    if (selectedAccessTypes.length === 0) {
      formError = $t('files.authorizeAccessError');
      return;
    }

    const startTimestamp = parseAccessGrantTimestamp(startDate, startTime);
    const endTimestamp = parseAccessGrantTimestamp(endDate, endTime);

    if (startTimestamp === null || endTimestamp === null) {
      formError = $t('files.authorizeTimeInvalid');
      return;
    }

    if (endTimestamp <= startTimestamp) {
      formError = $t('files.authorizeEndError');
      return;
    }

    formError = null;
    await onSubmit({
      entityIdentifier,
      entityType,
      accessTypes: selectedAccessTypes,
      startTime: startTimestamp,
      endTime: endTimestamp,
    });
  }

  function accessIcon(accessType: AccessType) {
    if (accessType === 'read') return 'visibility';
    if (accessType === 'write') return 'edit';
    if (accessType === 'move') return 'driveFileMove';
    return 'manageAccounts';
  }
</script>

<div class="flex max-h-[78vh] flex-col overflow-hidden">
  <div class="min-h-0 flex-1 overflow-auto p-5">
    <div class="mb-5 rounded-lg border border-md3-outline/70 bg-md3-surface-container-high/45 px-4 py-3">
      <div class="flex items-center gap-2 text-xs font-medium uppercase text-md3-on-surface-variant">
        <Icon name={targetType === 'document' ? 'filePresent' : 'folder'} size="16px" />
        {$t('files.authorizeTarget')}
      </div>
      <p class="mt-1 truncate text-sm font-semibold text-md3-on-surface">
        {targetName}
      </p>
      <p class="mt-0.5 text-xs text-md3-on-surface-variant">{targetTypeLabel}</p>
    </div>

    <section class="space-y-3">
      <div>
        <h4 class="text-sm font-semibold text-md3-on-surface">
          {$t('files.authorizeEntity')}
        </h4>
        <p class="mt-1 text-xs text-md3-on-surface-variant">
          {canSearchCurrentEntity
            ? $t('files.authorizeEntitySearchHelp')
            : $t('files.authorizeEntityManualHelp')}
        </p>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:w-max">
        <button
          type="button"
          class="choice-button {entityType === 'user' ? 'choice-button-active' : ''}"
          onclick={() => setEntityType('user')}
          disabled={saving}
        >
          <Icon name="accountCircle" size="18px" />
          {$t('files.entityUser')}
        </button>
        <button
          type="button"
          class="choice-button {entityType === 'group' ? 'choice-button-active' : ''}"
          onclick={() => setEntityType('group')}
          disabled={saving}
        >
          <Icon name="groups" size="18px" />
          {$t('files.entityGroup')}
        </button>
      </div>

      <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          class="field"
          bind:value={entityQuery}
          oninput={handleEntityInput}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (canSearchCurrentEntity) searchEntities();
            }
          }}
          placeholder={entityType === 'user' ? $t('files.usernamePlaceholder') : $t('files.groupNamePlaceholder')}
          disabled={saving}
        />
        {#if canSearchCurrentEntity}
          <button
            type="button"
            class="filled-button"
            onclick={searchEntities}
            disabled={saving || searching}
          >
            {#if searching}
              <ProgressRing size={17} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
            {:else}
              <Icon name="search" size="17px" />
            {/if}
            {$t('files.searchEntity')}
          </button>
        {/if}
      </div>

      {#if !canSearchCurrentEntity}
        <div class="inline-flex items-start gap-2 rounded-lg border border-md3-outline/70 bg-md3-surface-container/55 px-3 py-2 text-xs text-md3-on-surface-variant">
          <Icon name="info" size="16px" />
          <span>{$t('files.authorizeNoListPermission')}</span>
        </div>
      {/if}

      {#if canSearchCurrentEntity && (entityResults.length > 0 || searchCompleted)}
        <div class="overflow-hidden rounded-lg border border-md3-outline">
          <div class="border-b border-md3-outline bg-md3-surface-container-high/45 px-3 py-2 text-xs font-medium uppercase text-md3-on-surface-variant">
            {$t('files.searchResults')}
          </div>
          {#if entityResults.length === 0}
            <p class="px-3 py-5 text-center text-sm text-md3-on-surface-variant">
              {$t('files.searchNoMatches')}
            </p>
          {:else}
            <div class="max-h-44 overflow-auto">
              {#each entityResults as option (option.id)}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-md3-outline/50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-md3-primary-container/20"
                  onclick={() => selectEntity(option)}
                  disabled={saving}
                >
                  <Icon name={entityType === 'user' ? 'accountCircle' : 'groups'} size="18px" />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-md3-on-surface">{option.label}</span>
                    {#if option.description}
                      <span class="block truncate text-xs text-md3-on-surface-variant">{option.description}</span>
                    {/if}
                  </span>
                  {#if selectedEntity?.id === option.id}
                    <Icon name="checkCircle" size="18px" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <section class="mt-6 space-y-3">
      <div>
        <h4 class="text-sm font-semibold text-md3-on-surface">
          {$t('files.accessTypes')}
        </h4>
        <p class="mt-1 text-xs text-md3-on-surface-variant">
          {$t('files.accessTypesHelp')}
        </p>
      </div>
      <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
        {#each accessTypeOptions as accessType}
          <button
            type="button"
            class="access-button {accessTypes.has(accessType) ? 'access-button-active' : ''}"
            onclick={() => toggleAccessType(accessType)}
            disabled={saving}
            aria-pressed={accessTypes.has(accessType)}
          >
            <Icon name={accessIcon(accessType)} size="18px" />
            {$t(`files.operation.${accessType}`)}
          </button>
        {/each}
      </div>
    </section>

    <section class="mt-6 space-y-3">
      <div>
        <h4 class="text-sm font-semibold text-md3-on-surface">
          {$t('files.authorizationPeriod')}
        </h4>
        <p class="mt-1 text-xs text-md3-on-surface-variant">
          {$t('files.authorizationPeriodHelp')}
        </p>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <label class="field-label">
          {$t('files.authorizationStartDate')}
          <span class="date-field">
            <Icon name="calendarToday" size="17px" />
            <input type="date" data-focus-ring="delegated" bind:value={startDate} disabled={saving} />
          </span>
        </label>
        <label class="field-label">
          {$t('files.authorizationStartTime')}
          <span class="date-field">
            <Icon name="accessTime" size="17px" />
            <input type="time" data-focus-ring="delegated" bind:value={startTime} disabled={saving} />
          </span>
        </label>
        <label class="field-label">
          {$t('files.authorizationEndDate')}
          <span class="date-field">
            <Icon name="calendarToday" size="17px" />
            <input type="date" data-focus-ring="delegated" bind:value={endDate} disabled={saving} />
          </span>
        </label>
        <label class="field-label">
          {$t('files.authorizationEndTime')}
          <span class="date-field">
            <Icon name="accessTime" size="17px" />
            <input type="time" data-focus-ring="delegated" bind:value={endTime} disabled={saving} />
          </span>
        </label>
      </div>
    </section>

    {#if formError}
      <p class="mt-4 rounded-lg border border-md3-error/45 bg-md3-error-container/45 px-3 py-2 text-sm text-md3-on-error-container">
        {formError}
      </p>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline px-5 py-4">
    <DialogActionButton onclick={onCancel} disabled={saving}>
      {$t('common.cancel')}
    </DialogActionButton>
    <DialogActionButton
      variant="primary"
      onclick={submitGrant}
      disabled={saving}
    >
      {#if saving}
        <ProgressRing size={17} strokeWidth={2.4} label={$t('common.saving')} />
        {$t('common.saving')}
      {:else}
        <Icon name="lockPerson" size="17px" />
        {$t('files.grantAccessAction')}
      {/if}
    </DialogActionButton>
  </div>
</div>

<style>
  .choice-button,
  .access-button,
  .filled-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      filter 150ms ease;
  }

  .choice-button,
  .access-button {
    min-height: 2.45rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 0.5rem;
    color: var(--color-md3-on-surface-variant);
    padding: 0.55rem 0.85rem;
    font-size: 0.875rem;
  }

  .choice-button:hover,
  .access-button:hover {
    background: color-mix(in srgb, var(--color-md3-primary-container) 34%, transparent);
  }

  .choice-button-active,
  .access-button-active {
    border-color: transparent;
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  .filled-button {
    min-height: 2.35rem;
    border-radius: 9999px;
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .field {
    min-height: 2.35rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-md3-outline);
    background: var(--color-md3-field);
    color: var(--color-md3-on-surface);
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    outline: none;
    transition:
      border-color 150ms ease,
      box-shadow 150ms ease;
  }

  .field:focus,
  .date-field:focus-within {
    border-color: var(--color-md3-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-md3-primary) 25%, transparent);
  }

  .field-label {
    display: grid;
    gap: 0.4rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.8125rem;
  }

  .date-field {
    display: grid;
    min-height: 2.35rem;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 0.5rem;
    background: var(--color-md3-field);
    color: var(--color-md3-on-surface-variant);
    padding: 0 0.75rem;
    color-scheme: dark;
  }

  .date-field input {
    min-width: 0;
    background: transparent;
    color: var(--color-md3-on-surface);
    color-scheme: dark;
    font-size: 0.875rem;
    outline: none;
  }

  .date-field input::-webkit-calendar-picker-indicator {
    cursor: pointer;
    filter: invert(84%) sepia(16%) saturate(391%) hue-rotate(179deg) brightness(94%) contrast(91%);
    opacity: 0.95;
  }

  .date-field input::-webkit-calendar-picker-indicator:hover {
    filter: invert(96%) sepia(8%) saturate(240%) hue-rotate(177deg) brightness(102%) contrast(95%);
  }

  .choice-button:disabled,
  .access-button:disabled,
  .filled-button:disabled,
  .field:disabled,
  .date-field input:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
</style>
