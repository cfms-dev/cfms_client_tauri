<!--
THESIS: A schedule is an auditable server instruction, not a calendar decoration.
OWN-WORLD: Dense tonal ledger rows, precise cyan state signals, and one stable inspector.
STORY: Administrators scan durable work, inspect timing and ownership, then create or revise safely.
FIRST VIEWPORT: Command bar and schedule ledger fill the left; selected definition and next run anchor the right.
FORM: Grounded structure 7/7, a control-room ledger with persistent inspector; seed 862d8542.
-->
<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { portal } from '$lib/actions/portal';
  import { _ as t } from 'svelte-i18n';
  import {
    createSchedule,
    deleteSchedule,
    getSchedule,
    listScheduledTaskTypes,
    listSchedules,
    updateSchedule,
    type Schedule,
    type ScheduleCreateInput,
    type ScheduledTaskType,
    type ScheduleUpdateInput,
  } from '$lib/api';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import ScheduleEditor from '$lib/components/ScheduleEditor.svelte';

  const PAGE_SIZE = 64;

  let schedules = $state<Schedule[]>([]);
  let taskTypes = $state<ScheduledTaskType[]>([]);
  let loading = $state(false);
  let editorBusy = $state(false);
  let rowBusyId = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let taskTypesLoaded = $state(false);
  let selected = $state<Schedule | null>(null);
  let editorMode = $state<'create' | 'edit' | null>(null);
  let search = $state('');
  let includeDeleted = $state(false);
  let currentCursor = $state<string | null>(null);
  let nextCursor = $state<string | null>(null);
  let cursorStack = $state<Array<string | null>>([]);

  const canView = $derived(
    serverStateStore.connected
      && authStore.isLoggedIn
      && authStore.permissions.includes('view_schedules'),
  );
  const canManage = $derived(authStore.permissions.includes('manage_schedules'));
  const noAvailableTaskTypes = $derived(
    canManage && taskTypesLoaded && taskTypes.length === 0 && loadError === null,
  );
  const filteredSchedules = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return schedules;
    return schedules.filter((schedule) =>
      [schedule.task_name, schedule.id, schedule.created_by, schedule.updated_by]
        .some((value) => value?.toLocaleLowerCase().includes(query)),
    );
  });
  const pageNumber = $derived(cursorStack.length + 1);

  let helpAnchor: HTMLSpanElement | undefined = $state();
  let helpTooltip: HTMLSpanElement | undefined = $state();
  let helpOpen = $state(false);
  let helpPosition = $state({ left: 0, top: 0 });
  let helpHovered = false;
  let helpFocused = false;
  let helpPinned = false;
  let helpTouch = false;
  let helpHideTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelHelpHide() {
    clearTimeout(helpHideTimer);
    helpHideTimer = undefined;
  }

  function closeHelp() {
    cancelHelpHide();
    helpOpen = false;
    helpPinned = false;
  }

  function showHelp() {
    cancelHelpHide();
    helpOpen = true;
  }

  function leaveHelp() {
    helpHovered = false;
    cancelHelpHide();
    helpHideTimer = setTimeout(() => {
      if (!helpHovered && !helpFocused && !helpPinned) helpOpen = false;
    }, 120);
  }

  function enterHelp(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    helpHovered = true;
    showHelp();
  }

  function positionHelp() {
    if (!helpAnchor || !helpTooltip) return;
    const anchor = helpAnchor.getBoundingClientRect();
    const tooltip = helpTooltip.getBoundingClientRect();
    const margin = 16;
    const below = anchor.bottom + 8;
    const top = below + tooltip.height <= window.innerHeight - margin
      ? below : anchor.top - tooltip.height - 8;
    helpPosition = {
      left: Math.max(margin, Math.min(anchor.right - tooltip.width, window.innerWidth - tooltip.width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - tooltip.height - margin)),
    };
  }

  $effect(() => {
    if (!noAvailableTaskTypes || !canView) {
      closeHelp();
      helpHovered = false;
      helpFocused = false;
    }
  });

  $effect(() => {
    if (!helpOpen || !helpTooltip || !helpAnchor) return;
    positionHelp();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHelp();
      }
    };
    const onPointerdown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!helpAnchor?.contains(target) && !helpTooltip?.contains(target)) closeHelp();
    };
    window.addEventListener('resize', positionHelp);
    window.addEventListener('scroll', positionHelp, true);
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('pointerdown', onPointerdown);
    return () => {
      window.removeEventListener('resize', positionHelp);
      window.removeEventListener('scroll', positionHelp, true);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('pointerdown', onPointerdown);
    };
  });

  onDestroy(cancelHelpHide);

  function taskAllowed(schedule: Schedule): boolean {
    return schedule.task_available && taskTypes.some((task) => task.name === schedule.task_name);
  }

  function canToggle(schedule: Schedule): boolean {
    return canManage && taskAllowed(schedule) && schedule.status === 'active';
  }

  function displayStatus(schedule: Schedule): Schedule['status'] | 'paused' {
    return schedule.status === 'active' && !schedule.enabled ? 'paused' : schedule.status;
  }

  onMount(() => {
    if (canView) void refreshAll();
  });

  async function refreshAll() {
    loading = true;
    loadError = null;
    try {
      const [page, types] = await Promise.all([
        listSchedules(currentCursor, PAGE_SIZE, includeDeleted),
        listScheduledTaskTypes(),
      ]);
      schedules = page.items;
      nextCursor = page.next_cursor;
      if (selected) selected = page.items.find((item) => item.id === selected?.id) ?? null;
      taskTypes = types;
      taskTypesLoaded = true;
    } catch (error) {
      loadError = formatUserFacingError(error);
    } finally {
      loading = false;
    }
  }

  function resetAndRefresh() {
    if (editorMode !== null) return;
    currentCursor = null;
    nextCursor = null;
    cursorStack = [];
    selected = null;
    editorMode = null;
    void refreshAll();
  }

  function openCreate() {
    if (editorMode !== null) return;
    selected = null;
    editorMode = 'create';
  }

  async function openEdit(schedule: Schedule) {
    if (editorMode !== null || !taskAllowed(schedule)) return;
    rowBusyId = schedule.id;
    try {
      selected = await getSchedule(schedule.id);
      editorMode = 'edit';
    } catch (error) {
      notificationStore.error(formatUserFacingError(error));
    } finally {
      rowBusyId = null;
    }
  }

  function inspect(schedule: Schedule) {
    if (editorMode !== null) return;
    selected = schedule;
    editorMode = null;
  }

  function replaceSchedule(updated: Schedule) {
    schedules = schedules.map((item) => item.id === updated.id ? updated : item);
    if (selected?.id === updated.id) selected = updated;
  }

  function isConflict(error: unknown): boolean {
    const message = formatUserFacingError(error).toLocaleLowerCase();
    return message.includes('409') || message.includes('stale') || message.includes('concurrent');
  }

  async function saveSchedule(input: ScheduleCreateInput | ScheduleUpdateInput) {
    editorBusy = true;
    try {
      if ('revision' in input) {
        const updated = await updateSchedule(input);
        replaceSchedule(updated);
        notificationStore.success($t('schedules.updated'));
      } else {
        const created = await createSchedule(input);
        schedules = [created, ...schedules.filter((item) => item.id !== created.id)];
        selected = created;
        notificationStore.success($t('schedules.created'));
      }
      editorMode = null;
    } catch (error) {
      if (isConflict(error)) {
        notificationStore.error($t('schedules.conflict'));
        await refreshAll();
      } else {
        throw error;
      }
    } finally {
      editorBusy = false;
    }
  }

  async function toggleEnabled(schedule: Schedule, enabled: boolean) {
    rowBusyId = schedule.id;
    try {
      const updated = await updateSchedule({ id: schedule.id, revision: schedule.revision, enabled });
      replaceSchedule(updated);
    } catch (error) {
      notificationStore.error(isConflict(error) ? $t('schedules.conflict') : formatUserFacingError(error));
      if (isConflict(error)) await refreshAll();
    } finally {
      rowBusyId = null;
    }
  }

  async function removeSchedule(schedule: Schedule) {
    const confirmed = await dialogStore.confirm({
      title: $t('schedules.deleteTitle'),
      message: $t('schedules.deleteConfirm', { values: { task: schedule.task_name } }),
      confirmLabel: $t('schedules.deleteAction'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;
    rowBusyId = schedule.id;
    try {
      await deleteSchedule(schedule.id, schedule.revision);
      notificationStore.success($t('schedules.deleted'));
      selected = null;
      editorMode = null;
      await refreshAll();
    } catch (error) {
      notificationStore.error(isConflict(error) ? $t('schedules.conflict') : formatUserFacingError(error));
      if (isConflict(error)) await refreshAll();
    } finally {
      rowBusyId = null;
    }
  }

  function goNext() {
    if (!nextCursor || editorMode !== null) return;
    cursorStack = [...cursorStack, currentCursor];
    currentCursor = nextCursor;
    selected = null;
    editorMode = null;
    void refreshAll();
  }

  function goPrevious() {
    if (cursorStack.length === 0 || editorMode !== null) return;
    currentCursor = cursorStack.at(-1) ?? null;
    cursorStack = cursorStack.slice(0, -1);
    selected = null;
    editorMode = null;
    void refreshAll();
  }

  function formatDate(value: number | null): string {
    if (value === null) return $t('schedules.notScheduled');
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value * 1000));
  }

  function formatIsoDate(value: unknown): string {
    if (typeof value !== 'string') return $t('schedules.notScheduled');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return $t('schedules.notScheduled');
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function triggerSummary(schedule: Schedule): string {
    const data = schedule.trigger.data;
    if (schedule.trigger.type === 'cron') {
      return $t('schedules.triggerSummary.cron', { values: { expression: String(data.expression ?? '') } });
    }
    if (schedule.trigger.type === 'date') {
      return $t('schedules.triggerSummary.date', { values: { time: formatIsoDate(data.run_at) } });
    }
    return $t('schedules.triggerSummary.interval', { values: { seconds: String(data.seconds ?? '') } });
  }
</script>

<div class="schedules-page">
  <header class="page-header">
    <div class="schedule-heading cfms-heading-copy">
      <h1>{$t('schedules.title')}</h1>
      <p>{$t('schedules.description')}</p>
    </div>
    {#if canView}
      <div class="header-actions">
        {#if canManage}
          <FluentButton data-fluent-owner="routes-home-schedules-page"
            type="button"
            disabled={taskTypes.length === 0 || editorMode !== null}
            aria-describedby={noAvailableTaskTypes ? 'schedule-create-unavailable' : undefined}
            onclick={openCreate}
            appearance="subtle"
            class="primary-action"
          >
            <Icon name="add" size="18px" />{$t('schedules.createAction')}
          </FluentButton>
        {/if}
        {#if noAvailableTaskTypes}
          <span bind:this={helpAnchor} class="create-unavailable-anchor">
            <FluentButton data-fluent-owner="routes-home-schedules-page"
              type="button"
              aria-label={$t('schedules.createUnavailableHelp')}
              aria-describedby="schedule-create-unavailable"
              appearance="subtle"
              iconOnly
              class="create-unavailable-help"
              onpointerenter={enterHelp}
              onpointerleave={leaveHelp}
              onfocus={() => { helpFocused = true; showHelp(); }}
              onblur={() => { helpFocused = false; leaveHelp(); }}
              onpointerdown={(event) => { helpTouch = event.pointerType === 'touch'; }}
              onclick={() => {
                if (helpTouch) {
                  helpPinned = !helpPinned;
                  helpOpen = helpPinned;
                  cancelHelpHide();
                }
              }}
            >
              <Icon name="info" size="16px" />
            </FluentButton>
          </span>
          <span
            bind:this={helpTooltip}
            use:portal
            id="schedule-create-unavailable"
            class="create-unavailable-tooltip cfms-acrylic-surface"
            role="tooltip"
            hidden={!helpOpen}
            style:left="{helpPosition.left}px"
            style:top="{helpPosition.top}px"
            onpointerenter={enterHelp}
            onpointerleave={leaveHelp}
          >
            {$t('schedules.noAvailableTaskTypes')}
          </span>
        {/if}
        <IconButton icon="refresh" label={$t('common.refresh')} disabled={loading || editorMode !== null} onclick={() => void refreshAll()} />
      </div>
    {/if}
  </header>

  {#if !canView}
    <section class="unavailable-state">
      <span class="cfms-icon-text__icon"><Icon name="lock" size="23px" /></span>
      <div><h2>{$t('schedules.unavailableTitle')}</h2><p>{$t('schedules.unavailableDescription')}</p></div>
    </section>
  {:else}
    <div class="schedule-workspace" class:has-inspector={editorMode !== null || selected !== null}>
      <section class="ledger" aria-label={$t('schedules.listLabel')}>
        <div class="command-bar">
          <label class="search-field cfms-input-composite cfms-field-surface">
            <Icon name="search" size="18px" />
            <span class="sr-only">{$t('schedules.search')}</span>
            <input class="cfms-native-field" data-focus-ring="delegated" bind:value={search} disabled={editorMode !== null} placeholder={$t('schedules.searchPlaceholder')} />
          </label>
          <label class="deleted-filter">
            <input type="checkbox" bind:checked={includeDeleted} disabled={editorMode !== null} onchange={resetAndRefresh} />
            <span>{$t('schedules.includeDeleted')}</span>
          </label>
          <span class="ledger-count">{$t('schedules.pageCount', { values: { count: schedules.length } })}</span>
        </div>

        {#if loadError}
          <div class="load-state error-state" role="alert">
            <span class="cfms-icon-text__icon"><Icon name="errorFilled" size="22px" /></span>
            <div><strong>{$t('schedules.loadFailed')}</strong><p>{loadError}</p></div>
            <FluentButton data-fluent-owner="routes-home-schedules-page"
              type="button"
              onclick={() => void refreshAll()}
              appearance="subtle"
            >{$t('common.retry')}</FluentButton>
          </div>
        {:else if loading && schedules.length === 0}
          <div class="load-state"><ProgressRing size={24} label={$t('schedules.loading')} /><span>{$t('schedules.loading')}</span></div>
        {:else if filteredSchedules.length === 0}
          <div class="empty-state">
            <Icon name="eventUpcoming" size="28px" />
            <h2>{search ? $t('schedules.noMatches') : $t('schedules.emptyTitle')}</h2>
            <p>{search ? $t('schedules.noMatchesHelp') : $t('schedules.emptyDescription')}</p>
            {#if !search && canManage && taskTypes.length > 0}
              <FluentButton data-fluent-owner="routes-home-schedules-page"
                type="button"
                onclick={openCreate}
                appearance="subtle"
                class="primary-action"
              >{$t('schedules.createFirst')}</FluentButton>
            {/if}
          </div>
        {:else}
          <div class="ledger-heading" aria-hidden="true">
            <span>{$t('schedules.task')}</span><span>{$t('schedules.nextRun')}</span><span>{$t('schedules.state')}</span>
          </div>
          <div class="schedule-list">
            {#each filteredSchedules as schedule (schedule.id)}
              <div
                class="schedule-row"
                class:selected={selected?.id === schedule.id}
                class:unavailable={!schedule.task_available}
              >
                <button data-fluent-owner="routes-home-schedules-page" type="button" class="row-main" disabled={editorMode !== null} onclick={() => inspect(schedule)}>
                  <span class="task-cell">
                    <span class="task-name">{schedule.task_name}</span>
                    <span class="task-meta">{triggerSummary(schedule)} · {schedule.trigger.timezone}</span>
                  </span>
                  <span class="next-cell">{formatDate(schedule.next_run_at)}</span>
                  <span class="state-cell">
                    <span class="status-chip status-{displayStatus(schedule)}">{$t(`schedules.status.${displayStatus(schedule)}`)}</span>
                    {#if !schedule.task_available}<span class="availability-warning">{$t('schedules.unavailable')}</span>{/if}
                  </span>
                </button>
                {#if canManage && schedule.status !== 'deleted'}
                  <div class="row-actions">
                    {#if schedule.status === 'active'}
                      <MdSwitch
                        checked={schedule.enabled}
                        disabled={rowBusyId === schedule.id || editorMode !== null || !canToggle(schedule)}
                        ariaLabel={$t('schedules.toggleEnabled', { values: { task: schedule.task_name } })}
                        onChange={(enabled) => void toggleEnabled(schedule, enabled)}
                      />
                    {/if}
                    <FluentButton data-fluent-owner="routes-home-schedules-page"
                      type="button"
                      disabled={rowBusyId === schedule.id || editorMode !== null || !taskAllowed(schedule)}
                      aria-label={$t('common.edit')}
                      onclick={() => void openEdit(schedule)}
                      appearance="subtle"
                      class="icon-action"
                      iconOnly
                    >
                      <Icon name="edit" size="18px" />
                    </FluentButton>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <footer class="pagination">
          <FluentButton data-fluent-owner="routes-home-schedules-page"
            type="button"
            disabled={loading || editorMode !== null || cursorStack.length === 0}
            onclick={goPrevious}
            appearance="subtle"
          >
            <Icon name="navigateBefore" size="19px" />{$t('common.previous')}
          </FluentButton>
          <span>{$t('schedules.page', { values: { page: pageNumber } })}</span>
          <FluentButton data-fluent-owner="routes-home-schedules-page"
            type="button"
            disabled={loading || editorMode !== null || !nextCursor}
            onclick={goNext}
            appearance="subtle"
          >
            {$t('common.next')}<Icon name="navigateNext" size="19px" />
          </FluentButton>
        </footer>
      </section>

      {#if editorMode !== null}
        <aside class="cfms-content-surface inspector">
          <div class="inspector-scroll">
            <ScheduleEditor
              {taskTypes}
              schedule={editorMode === 'edit' ? selected : null}
              busy={editorBusy}
              onSave={saveSchedule}
              onCancel={() => (editorMode = null)}
            />
          </div>
        </aside>
      {:else if selected}
        <aside class="cfms-content-surface inspector" aria-labelledby="schedule-detail-title">
          <div class="inspector-scroll schedule-details">
            <header>
              <div><p>{$t('schedules.definition')}</p><h2 id="schedule-detail-title">{selected.task_name}</h2></div>
              <FluentButton data-fluent-owner="routes-home-schedules-page"
                type="button"
                aria-label={$t('common.close')}
                onclick={() => (selected = null)}
                appearance="subtle"
                class="icon-action"
                iconOnly
              ><Icon name="close" size="19px" /></FluentButton>
            </header>
            <dl>
              <div><dt>{$t('schedules.statusLabel')}</dt><dd>{$t(`schedules.status.${displayStatus(selected)}`)}</dd></div>
              <div><dt>{$t('schedules.enabled')}</dt><dd>{selected.enabled ? $t('common.yes') : $t('common.no')}</dd></div>
              <div><dt>{$t('schedules.nextRun')}</dt><dd>{formatDate(selected.next_run_at)}</dd></div>
              <div><dt>{$t('schedules.pendingRun')}</dt><dd>{formatDate(selected.pending_scheduled_for)}</dd></div>
              <div><dt>{$t('schedules.triggerType')}</dt><dd>{triggerSummary(selected)}</dd></div>
              <div><dt>{$t('schedules.timezone')}</dt><dd>{selected.trigger.timezone}</dd></div>
              <div><dt>{$t('schedules.revision')}</dt><dd>{selected.revision}</dd></div>
              <div><dt>{$t('schedules.updatedBy')}</dt><dd>{selected.updated_by ?? $t('common.unknown')}</dd></div>
              <div><dt>{$t('schedules.updatedAt')}</dt><dd>{formatDate(selected.updated_at)}</dd></div>
              <div class="wide"><dt>{$t('schedules.activeExecution')}</dt><dd class="mono">{selected.active_execution_id ?? $t('common.none')}</dd></div>
              <div class="wide"><dt>{$t('schedules.scheduleId')}</dt><dd class="mono">{selected.id}</dd></div>
            </dl>
            <div class="payload-preview"><strong>{$t('schedules.payload')}</strong><pre>{JSON.stringify(selected.payload, null, 2)}</pre></div>
            {#if canManage && selected.status !== 'deleted'}
              <footer>
                <FluentButton data-fluent-owner="routes-home-schedules-page"
                  type="button"
                  disabled={rowBusyId === selected.id}
                  onclick={() => void removeSchedule(selected!)}
                  appearance="subtle"
                  tone="danger"
                  class="danger-action"
                >
                  <Icon name="delete" size="18px" />{$t('schedules.deleteAction')}
                </FluentButton>
                <FluentButton data-fluent-owner="routes-home-schedules-page"
                  type="button"
                  disabled={rowBusyId === selected.id || !taskAllowed(selected)}
                  onclick={() => void openEdit(selected!)}
                  appearance="subtle"
                  class="primary-action"
                >
                  <Icon name="edit" size="18px" />{$t('common.edit')}
                </FluentButton>
              </footer>
            {/if}
          </div>
        </aside>
      {:else}
        <aside class="cfms-content-surface inspector inspector-empty" aria-label={$t('schedules.inspectorLabel')}>
          <div class="inspector-scroll inspector-empty-content">
            <Icon name="eventUpcoming" size="28px" />
            <strong>{$t('schedules.inspectTitle')}</strong>
            <p>{$t('schedules.inspectDescription')}</p>
          </div>
        </aside>
      {/if}
    </div>
  {/if}
</div>

<style>
  .schedules-page { display: flex; height: 100%; min-height: 0; overflow: hidden; flex-direction: column; font-family: var(--font-md3-sans); }
  .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 1.5rem 1.5rem 1rem; }
  .schedule-heading { flex: 1; }
  h1, h2, p { margin: 0; }
  h1 { color: var(--color-md3-on-surface); font-size: clamp(1.45rem, 4vw, 2.2rem); font-weight: 600; line-height: 1.15; letter-spacing: -0.025em; }
  .page-header > div > p { max-width: 68ch; color: var(--color-md3-on-surface-variant); font-size: 14px; line-height: 20px; }
  .header-actions, .row-actions, .pagination, .schedule-details footer { display: flex; align-items: center; gap: 8px; }
  .header-actions { justify-content: flex-end; white-space: nowrap; }
  .create-unavailable-anchor { display: inline-flex; flex: none; }
  :global(.create-unavailable-help[data-fluent-owner="routes-home-schedules-page"]) { inline-size: 32px; min-inline-size: 32px; max-inline-size: 32px; block-size: 32px; min-block-size: 32px; flex: none; padding: 0; cursor: help; }
  .create-unavailable-tooltip { position: fixed; z-index: 49; box-sizing: border-box; width: max-content; max-width: min(32rem, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; padding: 0.65rem 0.75rem; font: 400 12px/1.5 var(--fontFamilyBase); text-align: left; white-space: normal; overflow-wrap: anywhere; }
  :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])) { font-family: inherit; }
  :global(.primary-action[data-fluent-owner="routes-home-schedules-page"]), :global(.secondary-action[data-fluent-owner="routes-home-schedules-page"]), :global(.danger-action[data-fluent-owner="routes-home-schedules-page"]), .pagination :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])), .load-state :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])) { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; gap: 8px; border-radius: var(--borderRadiusMedium); padding: 0.35rem 0.75rem; font-size: 12px; font-weight: 600; cursor: pointer; }
  :global(.primary-action[data-fluent-owner="routes-home-schedules-page"]) { border: 1px solid var(--color-md3-primary); background: var(--color-md3-primary); color: var(--color-md3-on-primary); }
  :global(.secondary-action[data-fluent-owner="routes-home-schedules-page"]), .pagination :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])), .load-state :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])) { border: 1px solid var(--color-md3-outline); background: transparent; color: var(--color-md3-on-surface); }
  :global(.danger-action[data-fluent-owner="routes-home-schedules-page"]) { border: 1px solid var(--color-md3-error); background: transparent; color: var(--color-md3-error); }
  :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"]):is(:disabled, [disabled])) { cursor: not-allowed; opacity: 0.48; }
  .schedule-workspace { display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(0, 1fr); border-top: 1px solid var(--color-md3-outline); }
  .schedule-workspace.has-inspector .ledger { display: none; }
  .ledger { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
  .command-bar { display: flex; min-height: 52px; align-items: center; gap: 12px; border-bottom: 1px solid var(--color-md3-outline); padding: 0.45rem 1rem; }
  .search-field { display: flex; min-width: 180px; max-width: 390px; flex: 1; align-items: center; gap: 8px; border: 1px solid var(--color-md3-outline); border-radius: var(--borderRadiusMedium); background: var(--color-md3-field); color: var(--color-md3-on-surface-variant); }
  .search-field:focus-within { border-color: var(--color-md3-primary); box-shadow: inset 0 0 0 1px var(--color-md3-primary); }
  .search-field input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--color-md3-on-surface); font: 0.8rem var(--font-md3-sans); }
  .search-field:has(input:is(:disabled, [disabled])) { opacity: 0.55; }
  .deleted-filter { display: flex; align-items: center; gap: 8px; color: var(--color-md3-on-surface-variant); font-size: 12px; cursor: pointer; }
  .deleted-filter input { accent-color: var(--color-md3-primary); }
  .ledger-count { margin-left: auto; color: var(--color-md3-on-surface-variant); font-size: 12px; }
  .ledger-heading { display: grid; grid-template-columns: minmax(220px, 1.4fr) minmax(150px, 0.8fr) minmax(110px, 0.55fr); gap: 12px; border-bottom: 1px solid var(--color-md3-outline); padding: 0.55rem 8.8rem 0.55rem 1rem; color: var(--color-md3-on-surface-variant); font-size: 12px; font-weight: 600; }
  .schedule-list { flex: 1; overflow: auto; }
  .schedule-row { display: flex; min-height: 60px; align-items: stretch; border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 70%, transparent); transition: background 120ms ease; }
  .schedule-row:hover, .schedule-row.selected { background: var(--color-md3-surface-container-high); }
  .schedule-row.selected { box-shadow: inset 3px 0 0 var(--color-md3-primary); }
  .schedule-row.unavailable { opacity: 0.78; }
  .row-main { display: grid; min-width: 0; flex: 1; grid-template-columns: minmax(220px, 1.4fr) minmax(150px, 0.8fr) minmax(110px, 0.55fr); align-items: center; gap: 12px; border: 0; padding: 0.55rem 0.75rem 0.55rem 1rem; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .row-main:is(:disabled, [disabled]) { opacity: 1; cursor: default; }
  .task-cell { display: grid; min-width: 0; gap: 4px; }
  .task-name { overflow: hidden; color: var(--color-md3-on-surface); font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .task-meta, .next-cell { color: var(--color-md3-on-surface-variant); font-size: 12px; }
  .task-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .next-cell { font-family: var(--font-md3-mono); }
  .state-cell { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .status-chip, .availability-warning { border-radius: 999px; padding: 0.2rem 0.45rem; font-size: 12px; font-weight: 600; }
  .status-active { background: var(--color-md3-success-container); color: var(--color-md3-on-success-container); }
  .status-completed { background: var(--color-md3-primary-container); color: var(--color-md3-on-primary-container); }
  .status-failed { background: var(--color-md3-error-container); color: var(--color-md3-on-error-container); }
  .status-deleted { background: var(--color-md3-surface-container-highest); color: var(--color-md3-on-surface-variant); }
  .status-paused { background: var(--color-md3-surface-container-highest); color: var(--color-md3-on-surface-variant); }
  .availability-warning { color: var(--color-md3-warning); }
  .row-actions { flex: none; padding: 0 0.65rem; }
  .row-actions :global(.md-switch) { transform: scale(0.75); }
  :global(.icon-action[data-fluent-owner="routes-home-schedules-page"]) { display: grid; width: 40px; height: 40px; place-items: center; border: 0; border-radius: var(--borderRadiusMedium); padding: 0; background: transparent; color: var(--color-md3-on-surface-variant); cursor: pointer; }
  :global(.icon-action[data-fluent-owner="routes-home-schedules-page"]:hover:not(:is(:disabled, [disabled]))) { background: var(--color-md3-surface-container-highest); color: var(--color-md3-on-surface); }
  .pagination { justify-content: center; border-top: 1px solid var(--color-md3-outline); padding: 0.55rem 1rem; color: var(--color-md3-on-surface-variant); font-size: 12px; }
  .pagination :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])) { padding: 0.25rem 0.55rem; }
  .inspector { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: clip; border-left: 1px solid var(--color-md3-outline); }
  .inspector-scroll { min-width: 0; min-height: 0; flex: 1; overflow: auto; }
  .inspector-empty { display: none; }
  .inspector-empty-content { display: grid; place-items: center; align-content: safe center; gap: 8px; padding: 1.5rem; color: var(--color-md3-on-surface-variant); text-align: center; }
  .inspector-empty strong { color: var(--color-md3-on-surface); font-size: 14px; }
  .inspector-empty p { max-width: 32ch; font-size: 12px; line-height: 1.5; }
  .schedule-details > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-md3-outline); padding: 1rem 1.1rem; }
  .schedule-details > header p { color: var(--color-md3-on-surface-variant); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .schedule-details > header h2 { margin-top: 0.15rem; font-size: 16px; overflow-wrap: anywhere; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 0; padding: 0.75rem 1.1rem; }
  dl div { display: grid; gap: 4px; border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 70%, transparent); padding: 0.65rem 0; }
  dl div:nth-child(odd):not(.wide) { padding-right: 0.75rem; }
  dl .wide { grid-column: 1 / -1; }
  dt { color: var(--color-md3-on-surface-variant); font-size: 12px; }
  dd { margin: 0; color: var(--color-md3-on-surface); font-size: 12px; overflow-wrap: anywhere; }
  .mono { font-family: var(--font-md3-mono); }
  .payload-preview { display: grid; gap: 8px; padding: 0.4rem 1.1rem 1rem; }
  .payload-preview strong { font-size: 12px; }
  .payload-preview pre { max-height: 260px; overflow: auto; margin: 0; border-radius: 8px; padding: 0.7rem; background: var(--colorNeutralBackground1); color: var(--color-md3-on-surface); font: 0.72rem/1.5 var(--font-md3-mono); white-space: pre-wrap; }
  .schedule-details footer { justify-content: flex-end; border-top: 1px solid var(--color-md3-outline); padding: 0.9rem 1.1rem; }
  .load-state, .empty-state, .unavailable-state { color: var(--color-md3-on-surface-variant); }
  .load-state { display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; gap: 12px; padding: 1rem; font-size: 12px; }
  .error-state { align-items: flex-start; }
  .error-state div { display: grid; gap: 4px; }
  .error-state strong { color: var(--color-md3-error); }
  .error-state p { max-width: 58ch; font-size: 12px; line-height: 1.45; }
  .empty-state { display: grid; min-height: 0; flex: 1; place-items: center; align-content: center; gap: 8px; padding: 1.5rem; text-align: center; }
  .empty-state h2, .unavailable-state h2 { color: var(--color-md3-on-surface); font-size: 16px; }
  .empty-state p, .unavailable-state p { max-width: 55ch; font-size: 12px; line-height: 1.5; }
  .unavailable-state { display: flex; align-items: flex-start; gap: 12px; margin: 0 1.5rem; border-top: 1px solid var(--color-md3-outline); padding: 1.25rem 0; }
  .unavailable-state div { display: grid; gap: 4px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
  @container (min-width: 1100px) {
    .schedule-workspace { grid-template-columns: minmax(0, 1fr) minmax(330px, 420px); }
    .schedule-workspace.has-inspector .ledger { display: flex; }
    .inspector-empty { display: flex; }
  }
  @media (max-width: 1279px) {
    .inspector { border-left: 0; }
  }
  @media (max-width: 700px) {
    .schedules-page { height: auto; min-height: 100%; overflow: visible; }
    .page-header { align-items: flex-start; flex-direction: column; padding: 1.1rem 1rem 0.8rem; }
    .schedule-heading { width: 100%; }
    .header-actions { width: 100%; }
    .header-actions :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])) { flex: 1; }
    .header-actions .create-unavailable-anchor { flex: none; }
    .command-bar { flex-wrap: wrap; }
    .search-field { max-width: none; flex-basis: 100%; }
    .ledger-count { margin-left: auto; }
    .ledger-heading { display: none; }
    .row-main { grid-template-columns: minmax(0, 1fr) auto; }
    .next-cell { grid-column: 1; }
    .state-cell { grid-column: 2; grid-row: 1 / span 2; justify-content: flex-end; }
    .row-actions { padding-left: 0; }
  }
  @media (max-width: 480px) { .task-meta { max-width: 44vw; } }
  @media (pointer: coarse) {
    :global(.create-unavailable-help[data-fluent-owner="routes-home-schedules-page"]) { inline-size: 44px; min-inline-size: 44px; max-inline-size: 44px; block-size: 44px; min-block-size: 44px; }
    :global(.primary-action[data-fluent-owner="routes-home-schedules-page"]), :global(.secondary-action[data-fluent-owner="routes-home-schedules-page"]), :global(.danger-action[data-fluent-owner="routes-home-schedules-page"]), .pagination :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])), .load-state :global(:is(button[data-fluent-owner="routes-home-schedules-page"], .cfms-button[data-fluent-owner="routes-home-schedules-page"])), :global(.icon-action[data-fluent-owner="routes-home-schedules-page"]) { min-width: 44px; min-height: 44px; }
    .row-actions :global(.md-switch) { transform: none; }
  }
</style>
