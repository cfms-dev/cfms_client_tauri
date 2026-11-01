<script lang="ts">
  import MdOutlinedField from '$lib/components/MdOutlinedField.svelte';
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import type {
    JsonValue,
    Schedule,
    ScheduleCreateInput,
    ScheduledTaskType,
    ScheduleTriggerType,
    ScheduleUpdateInput,
  } from '$lib/api';
  import {
    browserTimeZone,
    buildScheduleTrigger,
    isoToZonedDateTimeInput,
    ScheduleValidationError,
    toZonedDateTimeInput,
  } from '$lib/schedule-form';
  import { buildPayloadDefaults, preparePayloadSchema } from '$lib/schedule-schema';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import Icon from './Icon.svelte';
  import MdSwitch from './MdSwitch.svelte';
  import SchemaPayloadEditor from './SchemaPayloadEditor.svelte';

  interface Props {
    taskTypes: ScheduledTaskType[];
    schedule?: Schedule | null;
    busy?: boolean;
    onSave: (input: ScheduleCreateInput | ScheduleUpdateInput) => void | Promise<void>;
    onCancel: () => void;
  }

  let {
    taskTypes,
    schedule = null,
    busy = false,
    onSave,
    onCancel,
  }: Props = $props();

  let taskName = $state('');
  let payload = $state<Record<string, JsonValue>>({});
  let payloadValid = $state(false);
  let payloadBaseline = '{}';
  let triggerType = $state<ScheduleTriggerType>('date');
  let timezone = $state('UTC');
  let cronExpression = $state('0 8 * * 1');
  let runAt = $state('');
  let intervalSeconds = $state('3600');
  let intervalStartAt = $state('');
  let enabled = $state(true);
  let validationError = $state<string | null>(null);
  let loadedKey = $state('');

  const selectedTaskType = $derived(taskTypes.find((item) => item.name === taskName) ?? null);
  const editingUnavailableTask = $derived(Boolean(schedule && !selectedTaskType));
  const formTitle = $derived(schedule ? $t('schedules.editTitle') : $t('schedules.createTitle'));

  function payloadDefaults(taskType: ScheduledTaskType | null): Record<string, JsonValue> {
    return taskType
      ? buildPayloadDefaults(preparePayloadSchema(taskType.payload_schema))
      : {};
  }

  function setPayload(nextPayload: Record<string, JsonValue>) {
    payload = nextPayload;
  }

  $effect(() => {
    const key = schedule ? `${schedule.id}:${schedule.revision}` : 'create';
    if (key === loadedKey) return;
    loadedKey = key;
    validationError = null;
    if (!schedule) {
      const defaultTimezone = browserTimeZone();
      const defaultStart = toZonedDateTimeInput(new Date(Date.now() + 5 * 60_000), defaultTimezone);
      taskName = taskTypes[0]?.name ?? '';
      payload = payloadDefaults(taskTypes[0] ?? null);
      payloadBaseline = JSON.stringify(payload);
      payloadValid = false;
      triggerType = 'date';
      timezone = defaultTimezone;
      cronExpression = '0 8 * * 1';
      runAt = defaultStart;
      intervalSeconds = '3600';
      intervalStartAt = defaultStart;
      enabled = true;
      return;
    }

    taskName = schedule.task_name;
    payload = JSON.parse(JSON.stringify(schedule.payload)) as Record<string, JsonValue>;
    payloadBaseline = JSON.stringify(payload);
    payloadValid = false;
    triggerType = schedule.trigger.type;
    timezone = schedule.trigger.timezone;
    cronExpression = typeof schedule.trigger.data.expression === 'string'
      ? schedule.trigger.data.expression
      : '0 8 * * 1';
    runAt = isoToZonedDateTimeInput(schedule.trigger.data.run_at, schedule.trigger.timezone);
    intervalSeconds = String(schedule.trigger.data.seconds ?? 3600);
    intervalStartAt = isoToZonedDateTimeInput(schedule.trigger.data.start_at, schedule.trigger.timezone);
    enabled = schedule.enabled;
  });

  async function changeTask(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const nextTaskName = select.value;
    if (nextTaskName === taskName) return;

    if (JSON.stringify(payload) !== payloadBaseline) {
      select.value = taskName;
      const confirmed = await dialogStore.confirm({
        title: $t('schedules.discardPayloadTitle'),
        message: $t('schedules.discardPayloadMessage'),
        confirmLabel: $t('schedules.discardPayloadAction'),
        cancelLabel: $t('common.cancel'),
      });
      if (!confirmed) return;
    }

    taskName = nextTaskName;
    const nextTaskType = taskTypes.find((item) => item.name === nextTaskName) ?? null;
    payload = payloadDefaults(nextTaskType);
    payloadBaseline = JSON.stringify(payload);
    payloadValid = false;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    validationError = null;
    try {
      if (!taskName) throw new Error($t('schedules.taskRequired'));
      if (!payloadValid) throw new ScheduleValidationError('payloadSchema');
      const trigger = buildScheduleTrigger({
        type: triggerType,
        timezone,
        cronExpression,
        runAt,
        intervalSeconds,
        intervalStartAt,
      });
      if (schedule) {
        await onSave({
          id: schedule.id,
          revision: schedule.revision,
          taskName,
          payload,
          trigger,
          enabled,
        });
      } else {
        await onSave({ taskName, payload, trigger, enabled });
      }
    } catch (error) {
      validationError = error instanceof ScheduleValidationError
        ? $t(`schedules.validation.${error.code}`)
        : formatUserFacingError(error);
    }
  }
</script>

<section class="schedule-editor" aria-labelledby="schedule-editor-title">
  <header>
    <div>
      <p class="editor-kicker">{$t('schedules.definition')}</p>
      <h2 id="schedule-editor-title">{formTitle}</h2>
    </div>
    <FluentButton data-fluent-owner="lib-components-schedule-editor"
      type="button"
      aria-label={$t('common.close')}
      onclick={onCancel}
      appearance="subtle"
      class="icon-button"
      iconOnly
    >
      <Icon name="close" size="19px" />
    </FluentButton>
  </header>

  {#if editingUnavailableTask}
    <div class="editor-warning" role="alert">
      <span class="cfms-icon-text__icon"><Icon name="warningAmber" size="19px" /></span>
      <span>{$t('schedules.taskUnavailableEdit')}</span>
    </div>
  {/if}

  <form onsubmit={submit}>
    <label class="field-label" for="schedule-task">{$t('schedules.taskType')}</label>
    <select class="cfms-native-field" id="schedule-task" value={taskName} disabled={busy || editingUnavailableTask} onchange={changeTask}>
      {#if editingUnavailableTask}
        <option value={taskName}>{taskName}</option>
      {/if}
      {#each taskTypes as task (task.name)}
        <option value={task.name}>{task.name}</option>
      {/each}
    </select>

    <div class="trigger-grid">
      <div>
        <label class="field-label" for="schedule-trigger">{$t('schedules.triggerType')}</label>
        <select class="cfms-native-field" id="schedule-trigger" bind:value={triggerType} disabled={busy}>
          <option value="date">{$t('schedules.trigger.date')}</option>
          <option value="cron">{$t('schedules.trigger.cron')}</option>
          <option value="interval">{$t('schedules.trigger.interval')}</option>
        </select>
      </div>
      <div>
        <MdOutlinedField inputId="schedule-timezone" label={$t('schedules.timezone')} disabled={busy}>
          <input data-focus-ring="delegated" class="cfms-native-field" id="schedule-timezone" bind:value={timezone} disabled={busy} autocomplete="off" />
        </MdOutlinedField>
      </div>
    </div>

    {#if triggerType === 'cron'}
      <MdOutlinedField inputId="schedule-cron" label={$t('schedules.cronExpression')} disabled={busy}>
        <input data-focus-ring="delegated" class="cfms-native-field" id="schedule-cron" bind:value={cronExpression} disabled={busy} placeholder="0 8 * * 1" />
      </MdOutlinedField>
      <p class="field-help">{$t('schedules.cronHelp')}</p>
    {:else if triggerType === 'date'}
      <MdOutlinedField inputId="schedule-run-at" label={$t('schedules.runAt')} disabled={busy}>
        <input data-focus-ring="delegated" class="cfms-native-field" id="schedule-run-at" type="datetime-local" bind:value={runAt} disabled={busy} />
      </MdOutlinedField>
    {:else}
      <div class="trigger-grid">
        <div>
          <MdOutlinedField inputId="schedule-interval" label={$t('schedules.intervalSeconds')} disabled={busy}>
            <input data-focus-ring="delegated" class="cfms-native-field" id="schedule-interval" type="number" min="1" step="1" bind:value={intervalSeconds} disabled={busy} />
          </MdOutlinedField>
        </div>
        <div>
          <MdOutlinedField inputId="schedule-start-at" label={$t('schedules.startAt')} disabled={busy}>
            <input data-focus-ring="delegated" class="cfms-native-field" id="schedule-start-at" type="datetime-local" bind:value={intervalStartAt} disabled={busy} />
          </MdOutlinedField>
        </div>
      </div>
    {/if}

    <div class="payload-heading">
      <div>
        <span class="field-label">{$t('schedules.payload')}</span>
        <p id="schedule-payload-help">{$t('schedules.payloadHelp')}</p>
      </div>
      {#if selectedTaskType}
        <details>
          <summary>{$t('schedules.viewSchema')}</summary>
          <pre>{JSON.stringify(selectedTaskType.payload_schema, null, 2)}</pre>
        </details>
      {/if}
    </div>
    {#if selectedTaskType}
      {#key `${loadedKey}:${taskName}`}
        <SchemaPayloadEditor
          schema={selectedTaskType.payload_schema}
          bind:value={payload}
          bind:valid={payloadValid}
          disabled={busy}
          onChange={setPayload}
        />
      {/key}
    {:else}
      <pre class="unavailable-payload">{JSON.stringify(payload, null, 2)}</pre>
    {/if}

    <div class="enabled-row">
      <div>
        <strong>{$t('schedules.enabled')}</strong>
        <span>{$t('schedules.enabledHelp')}</span>
      </div>
      <MdSwitch bind:checked={enabled} disabled={busy} ariaLabel={$t('schedules.enabled')} />
    </div>

    {#if validationError}
      <p class="validation-error" role="alert">{validationError}</p>
    {/if}

    <footer>
      <FluentButton data-fluent-owner="lib-components-schedule-editor"
        type="button"
        disabled={busy}
        onclick={onCancel}
        appearance="subtle"
        class="secondary-button"
      >
        {$t('common.cancel')}
      </FluentButton>
      <FluentButton data-fluent-owner="lib-components-schedule-editor"
        type="submit"
        disabled={busy || editingUnavailableTask || !taskName || !payloadValid}
        appearance="subtle"
        class="primary-button"
      >
        {#if busy}<span class="button-spinner" aria-hidden="true"></span>{/if}
        {schedule ? $t('common.save') : $t('schedules.createAction')}
      </FluentButton>
    </footer>
  </form>
</section>

<style>
  .schedule-editor { min-height: 100%; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-md3-outline); padding: 1rem 1.1rem 0.9rem; }
  h2, p { margin: 0; }
  h2 { margin-top: 0.15rem; color: var(--color-md3-on-surface); font-family: var(--font-md3-sans); font-size: 16px; line-height: 1.25; }
  .editor-kicker { color: var(--color-md3-on-surface-variant); font-family: var(--font-md3-sans); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  :global(.icon-button[data-fluent-owner="lib-components-schedule-editor"]) { display: grid; width: 40px; height: 40px; flex: none; place-items: center; border: 0; border-radius: var(--borderRadiusMedium); padding: 0; background: transparent; color: var(--color-md3-on-surface-variant); cursor: pointer; }
  :global(.icon-button[data-fluent-owner="lib-components-schedule-editor"]:hover) { background: var(--color-md3-surface-container-highest); color: var(--color-md3-on-surface); }
  form { display: grid; gap: 12px; padding: 1rem 1.1rem 1.25rem; }
  .field-label { color: var(--color-md3-on-surface); font-family: var(--font-md3-sans); font-size: 12px; font-weight: 600; }
  input, select { width: 100%; box-sizing: border-box; color: var(--color-md3-on-surface); font: 0.84rem/1.4 var(--font-md3-sans); }
  select { border: 1px solid var(--color-md3-outline); border-radius: var(--borderRadiusMedium); background: var(--color-md3-field); }
  input:is(:disabled, [disabled]), select:is(:disabled, [disabled]) { cursor: not-allowed; opacity: 0.55; }
  .trigger-grid { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); align-items: end; gap: 12px; }
  .trigger-grid > div { display: grid; gap: 8px; }
  .field-help, .payload-heading p { color: var(--color-md3-on-surface-variant); font: 0.75rem/1.45 var(--font-md3-sans); }
  .payload-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-top: 0.25rem; }
  .payload-heading > div { display: grid; gap: 4px; }
  details { position: relative; color: var(--color-md3-on-surface-variant); font: 0.75rem var(--font-md3-sans); }
  summary { cursor: pointer; color: var(--color-md3-primary-emphasis); }
  details pre { position: absolute; right: 0; z-index: 5; width: min(430px, 75vw); max-height: 260px; overflow: auto; border: 1px solid var(--color-md3-outline); border-radius: 8px; padding: 0.7rem; background: var(--color-md3-surface-container-high); box-shadow: 0 12px 32px rgb(0 0 0 / 0.24); color: var(--color-md3-on-surface); font: 0.72rem/1.5 var(--font-md3-mono); white-space: pre-wrap; }
  .unavailable-payload { min-height: 9rem; overflow: auto; margin: 0; border-radius: 8px; padding: 0.7rem; background: var(--color-md3-surface-container-high); color: var(--color-md3-on-surface); font: 0.72rem/1.5 var(--font-md3-mono); white-space: pre-wrap; }
  .enabled-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid var(--color-md3-outline); padding-top: 0.8rem; }
  .enabled-row > div { display: grid; gap: 4px; }
  .enabled-row strong, .enabled-row span { font-family: var(--font-md3-sans); }
  .enabled-row strong { font-size: 12px; }
  .enabled-row span { color: var(--color-md3-on-surface-variant); font-size: 12px; }
  .editor-warning, .validation-error { color: var(--color-md3-on-error-container); background: var(--color-md3-error-container); }
  .editor-warning { display: flex; align-items: flex-start; gap: 8px; margin: 0.8rem 1.1rem 0; border-radius: 8px; padding: 0.65rem 0.75rem; font: 0.78rem/1.45 var(--font-md3-sans); }
  .validation-error { border-radius: 8px; padding: 0.6rem 0.7rem; font: 0.78rem/1.45 var(--font-md3-sans); }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 0.25rem; }
  footer :global(.cfms-button[data-fluent-owner="lib-components-schedule-editor"]) { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; gap: 8px; border-radius: var(--borderRadiusMedium); padding: 0.35rem 0.85rem; font: 650 0.76rem var(--font-md3-sans); cursor: pointer; }
  footer :global(.cfms-button[data-fluent-owner="lib-components-schedule-editor"]:is(:disabled, [disabled])) { cursor: not-allowed; opacity: 0.5; }
  :global(.secondary-button[data-fluent-owner="lib-components-schedule-editor"]) { border: 1px solid var(--color-md3-outline); background: transparent; color: var(--color-md3-on-surface); }
  :global(.primary-button[data-fluent-owner="lib-components-schedule-editor"]) { border: 1px solid var(--color-md3-primary); background: var(--color-md3-primary); color: var(--color-md3-on-primary); }
  .button-spinner { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: var(--borderRadiusMedium); animation: editor-spin 700ms linear infinite; }
  @keyframes editor-spin { to { transform: rotate(360deg); } }
  @media (max-width: 520px) { .trigger-grid { grid-template-columns: 1fr; } }
  @media (pointer: coarse) { :global(.icon-button[data-fluent-owner="lib-components-schedule-editor"]), footer :global(.cfms-button[data-fluent-owner="lib-components-schedule-editor"]) { min-width: 44px; min-height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .button-spinner { animation-duration: 1.4s; } }
</style>
