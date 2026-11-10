<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
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
  } from '$lib/features/access/access-grants';
  import { ACCESS_OPERATIONS } from '$lib/features/access/access-rules';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

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
      id: user.user_id,
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
    entityQuery = option.label;
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
  const outlinedId = $props.id();
</script>

<div class="flex h-full min-h-0 max-h-[78vh] flex-col overflow-hidden">
  <div class="min-h-0 flex-1 overflow-auto p-5">
    <div class="mb-5 rounded-lg border border-md3-outline/70 bg-md3-surface-container-high px-4 py-3">
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
        <FluentButton data-fluent-owner="lib-components-authorize-access-dialog"
          type="button"
          onclick={() => setEntityType('user')}
          disabled={saving}
          appearance="subtle"
          class={"choice-button " + (entityType === 'user' ? 'choice-button-active' : '')}
        >
          <Icon name="accountCircle" size="18px" />
          {$t('files.entityUser')}
        </FluentButton>
        <FluentButton data-fluent-owner="lib-components-authorize-access-dialog"
          type="button"
          onclick={() => setEntityType('group')}
          disabled={saving}
          appearance="subtle"
          class={"choice-button " + (entityType === 'group' ? 'choice-button-active' : '')}
        >
          <Icon name="groups" size="18px" />
          {$t('files.entityGroup')}
        </FluentButton>
      </div>

      <div class="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          class="cfms-native-field field"
          bind:value={entityQuery}
          oninput={handleEntityInput}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (canSearchCurrentEntity) searchEntities();
            }
          }}
          placeholder={entityType === 'user' ? $t(canSearchCurrentEntity ? 'files.usernamePlaceholder' : 'manage.userId') : $t('files.groupNamePlaceholder')}
          disabled={saving}
        />
        {#if canSearchCurrentEntity}
          <FluentButton data-fluent-owner="lib-components-authorize-access-dialog"
            type="button"
            onclick={searchEntities}
            disabled={saving || searching}
            appearance="subtle"
            class="cfms-control-action filled-button"
          >
            {#if searching}
              <ProgressRing size={17} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
            {:else}
              <Icon name="search" size="17px" />
            {/if}
            {$t('files.searchEntity')}
          </FluentButton>
        {/if}
      </div>

      {#if !canSearchCurrentEntity}
        <div class="inline-flex items-start gap-2 rounded-lg border border-md3-outline/70 bg-md3-surface-container px-3 py-2 text-xs text-md3-on-surface-variant">
          <Icon name="info" size="16px" />
          <span>{$t('files.authorizeNoListPermission')}</span>
        </div>
      {/if}

      {#if canSearchCurrentEntity && (entityResults.length > 0 || searchCompleted)}
        <div class="overflow-hidden rounded-lg border border-md3-outline">
          <div class="border-b border-md3-outline bg-md3-surface-container-high px-3 py-2 text-xs font-medium uppercase text-md3-on-surface-variant">
            {$t('files.searchResults')}
          </div>
          {#if entityResults.length === 0}
            <p class="px-3 py-5 text-center text-sm text-md3-on-surface-variant">
              {$t('files.searchNoMatches')}
            </p>
          {:else}
            <div class="cfms-list-rows max-h-44 overflow-auto">
              {#each entityResults as option (option.id)}
                <FluentButton data-fluent-owner="lib-components-authorize-access-dialog"
                  type="button"
                  onclick={() => selectEntity(option)}
                  disabled={saving}
                  appearance="subtle"
                  shape="square"
                  class="cfms-list-row"
                >
                  <span class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2">
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
                  </span>
                </FluentButton>
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
          <FluentButton data-fluent-owner="lib-components-authorize-access-dialog"
            type="button"
            onclick={() => toggleAccessType(accessType)}
            disabled={saving}
            aria-pressed={accessTypes.has(accessType)}
            appearance="subtle"
            class={"access-button " + (accessTypes.has(accessType) ? 'access-button-active' : '')}
          >
            <Icon name={accessIcon(accessType)} size="18px" />
            {$t(`files.operation.${accessType}`)}
          </FluentButton>
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
        <div class="field-label">
          <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('files.authorizationStartDate')} disabled={saving}>
            <span data-outlined-content class="date-field">
              <Icon name="calendarToday" size="17px" />
              <input id={`${outlinedId}-1`} class="cfms-native-field" type="date" data-focus-ring="delegated" bind:value={startDate} disabled={saving} />
            </span>
          </MdOutlinedField>
        </div>
        <div class="field-label">
          <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('files.authorizationStartTime')} disabled={saving}>
            <span data-outlined-content class="date-field">
              <Icon name="accessTime" size="17px" />
              <input id={`${outlinedId}-2`} class="cfms-native-field" type="time" data-focus-ring="delegated" bind:value={startTime} disabled={saving} />
            </span>
          </MdOutlinedField>
        </div>
        <div class="field-label">
          <MdOutlinedField inputId={`${outlinedId}-3`} label={$t('files.authorizationEndDate')} disabled={saving}>
            <span data-outlined-content class="date-field">
              <Icon name="calendarToday" size="17px" />
              <input id={`${outlinedId}-3`} class="cfms-native-field" type="date" data-focus-ring="delegated" bind:value={endDate} disabled={saving} />
            </span>
          </MdOutlinedField>
        </div>
        <div class="field-label">
          <MdOutlinedField inputId={`${outlinedId}-4`} label={$t('files.authorizationEndTime')} disabled={saving}>
            <span data-outlined-content class="date-field">
              <Icon name="accessTime" size="17px" />
              <input id={`${outlinedId}-4`} class="cfms-native-field" type="time" data-focus-ring="delegated" bind:value={endTime} disabled={saving} />
            </span>
          </MdOutlinedField>
        </div>
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
  :global(.choice-button[data-fluent-owner="lib-components-authorize-access-dialog"]),
  :global(.access-button[data-fluent-owner="lib-components-authorize-access-dialog"]),
  :global(.filled-button[data-fluent-owner="lib-components-authorize-access-dialog"]) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      filter 150ms ease;
  }

  :global(.choice-button[data-fluent-owner="lib-components-authorize-access-dialog"]),
  :global(.access-button[data-fluent-owner="lib-components-authorize-access-dialog"]) {
    min-height: 2.45rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--borderRadiusMedium);
    color: var(--color-md3-on-surface-variant);
    padding: 0.55rem 0.85rem;
    font-size: 14px;
  }

  :global(.choice-button[data-fluent-owner="lib-components-authorize-access-dialog"]):hover,
  :global(.access-button[data-fluent-owner="lib-components-authorize-access-dialog"]:hover) {
    background: color-mix(in srgb, var(--color-md3-primary-container) 34%, transparent);
  }

  :global(.choice-button-active[data-fluent-owner="lib-components-authorize-access-dialog"]),
  :global(.access-button-active[data-fluent-owner="lib-components-authorize-access-dialog"]) {
    border-color: transparent;
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  :global(.filled-button[data-fluent-owner="lib-components-authorize-access-dialog"]) {
    border-radius: var(--borderRadiusMedium);
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    padding-inline: 1rem;
    font-size: 14px;
    font-weight: 500;
  }

  .field {
    border-radius: var(--borderRadiusMedium);
    border: 1px solid var(--color-md3-outline);
    background: var(--color-md3-field);
    color: var(--color-md3-on-surface);
    padding-inline: 0.75rem;
    font-size: 14px;
    outline: none;
    transition:
      border-color 150ms ease,
      box-shadow 150ms ease;
  }

  .field-label {
    display: grid;
    gap: 8px;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
  }

  .date-field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    color: var(--color-md3-on-surface-variant);
    padding: 0 0.75rem;
    color-scheme: inherit;
  }

  .date-field input {
    min-width: 0;
    padding-inline: 0;
    background: transparent;
    color: var(--color-md3-on-surface);
    color-scheme: inherit;
    font-size: 14px;
    outline: none;
  }

  :global(.choice-button[data-fluent-owner="lib-components-authorize-access-dialog"]):is(:disabled, [disabled]),
  :global(.access-button[data-fluent-owner="lib-components-authorize-access-dialog"]:is(:disabled, [disabled])),
  :global(.filled-button[data-fluent-owner="lib-components-authorize-access-dialog"]:is(:disabled, [disabled])),
  .field:is(:disabled, [disabled]),
  .date-field input:is(:disabled, [disabled]) {
    cursor: not-allowed;
    opacity: 0.55;
  }
</style>
