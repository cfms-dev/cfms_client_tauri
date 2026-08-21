<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { PermissionEntry } from '$lib/api';
  import {
    parseLocalDateTimeInput,
    toLocalDateTimeInput,
    type PermissionEntryChangeKind,
    type PermissionEntryValidation,
  } from '$lib/permission-entries';
  import Icon from './Icon.svelte';

  type StartMode = 'immediate' | 'specified';
  type EndMode = 'never' | 'specified';

  interface EditorRow {
    key: string;
    entry: PermissionEntry;
    change: PermissionEntryChangeKind;
    startMode: StartMode;
    endMode: EndMode;
  }

  let {
    row,
    validation,
    suggestions,
    disabled = false,
    onPatch,
    onStartModeChange,
    onEndModeChange,
    onDelete,
    onUndo,
  }: {
    row: EditorRow | null;
    validation: PermissionEntryValidation | null;
    suggestions: string[];
    disabled?: boolean;
    onPatch: (patch: Partial<PermissionEntry>) => void;
    onStartModeChange: (mode: StartMode) => void;
    onEndModeChange: (mode: EndMode) => void;
    onDelete: () => void;
    onUndo: () => void;
  } = $props();

  let permissionInput: HTMLInputElement | undefined = $state();
  let undoButton: HTMLButtonElement | undefined = $state();

  export function focusPermissionName() {
    permissionInput?.focus();
  }

  export function focusUndo() {
    undoButton?.focus();
  }

  function updateStartTime(value: string) {
    onPatch({ start_time: parseLocalDateTimeInput(value) ?? Number.NaN });
  }

  function updateEndTime(value: string) {
    onPatch({ end_time: parseLocalDateTimeInput(value) ?? Number.NaN });
  }
</script>

<section class="entry-editor-pane" aria-labelledby="permission-rule-editor-title">
  {#if row === null}
    <div class="editor-empty">
      <span class="editor-empty-icon"><Icon name="rule" size="30px" /></span>
      <h3 id="permission-rule-editor-title">{$t('manage.selectPermissionEntryTitle')}</h3>
      <p>{$t('manage.selectPermissionEntryDescription')}</p>
    </div>
  {:else if row.change === 'deleted'}
    {#key row.key}
      <div class="deleted-editor editor-enter">
        <span class="deleted-icon"><Icon name="delete" size="26px" /></span>
        <div>
          <h3 id="permission-rule-editor-title">{$t('manage.permissionPendingDeletion')}</h3>
          <p>{$t('manage.permissionPendingDeletionDescription', {
            values: { permission: row.entry.permission || $t('manage.unnamedPermissionEntry') },
          })}</p>
        </div>
        <button bind:this={undoButton} type="button" disabled={disabled} onclick={onUndo}>
          <Icon name="history" size="17px" />
          {$t('manage.undoDeletePermissionEntry')}
        </button>
      </div>
    {/key}
  {:else}
    {#key row.key}
      <div class="editor-content editor-enter">
        <header class="editor-header">
          <div>
            <div class="editor-heading-line">
              <h3 id="permission-rule-editor-title">
                {row.change === 'added'
                  ? $t('manage.newPermissionEntry')
                  : $t('manage.editPermissionEntry')}
              </h3>
              {#if row.change !== 'unchanged'}
                <span>{$t(`manage.permissionChange.${row.change}`)}</span>
              {/if}
            </div>
            <p>{$t('manage.permissionEditorAutosaveHint')}</p>
          </div>
          <button
            type="button"
            class="editor-delete"
            aria-label={$t('manage.deletePermissionEntry')}
            title={$t('manage.deletePermissionEntry')}
            disabled={disabled}
            onclick={onDelete}
          >
            <Icon name="delete" size="18px" />
          </button>
        </header>

        <div class="editor-form" aria-live="polite">
          <div class="field-group" class:field-error={validation?.permission !== null}>
            <label class="field-label" for="permission-entry-name">{$t('manage.permissionName')}</label>
            <span class="field-description">{$t('manage.permissionNameHelp')}</span>
            <input
              id="permission-entry-name"
              bind:this={permissionInput}
              value={row.entry.permission}
              list="permission-entry-suggestions"
              maxlength="255"
              autocomplete="off"
              aria-invalid={validation?.permission !== null}
              aria-describedby={validation?.permission ? 'permission-name-error' : undefined}
              disabled={disabled}
              oninput={(event) => onPatch({ permission: event.currentTarget.value })}
            />
            <datalist id="permission-entry-suggestions">
              {#each suggestions as suggestion (suggestion)}
                <option value={suggestion}></option>
              {/each}
            </datalist>
            {#if validation?.permission}
              <span id="permission-name-error" class="validation-message" role="alert">
                <Icon name="errorFilled" size="14px" />
                {$t('manage.permissionNameRequired')}
              </span>
            {/if}
          </div>

          <fieldset class="field-group">
            <legend class="field-label">{$t('manage.permissionEffect')}</legend>
            <span class="field-description">{$t('manage.permissionEffectHelp')}</span>
            <div class="segmented-control segmented-effect">
              <button
                type="button"
                class:active={row.entry.granted}
                aria-pressed={row.entry.granted}
                disabled={disabled}
                onclick={() => onPatch({ granted: true })}
              >
                <Icon name="checkCircle" size="17px" />
                <span>{$t('manage.permissionGrant')}</span>
              </button>
              <button
                type="button"
                class:active={!row.entry.granted}
                class:danger-active={!row.entry.granted}
                aria-pressed={!row.entry.granted}
                disabled={disabled}
                onclick={() => onPatch({ granted: false })}
              >
                <Icon name="block" size="17px" />
                <span>{$t('manage.permissionRevoke')}</span>
              </button>
            </div>
          </fieldset>

          <fieldset class="field-group" class:field-error={validation?.startTime !== null}>
            <legend class="field-label">{$t('manage.permissionStartsAt')}</legend>
            <span class="field-description">{$t('manage.permissionStartModeHelp')}</span>
            <div class="segmented-control">
              <button
                type="button"
                class:active={row.startMode === 'immediate'}
                aria-pressed={row.startMode === 'immediate'}
                disabled={disabled}
                onclick={() => onStartModeChange('immediate')}
              >
                <Icon name="done" size="16px" />
                <span>{$t('manage.permissionStartImmediately')}</span>
              </button>
              <button
                type="button"
                class:active={row.startMode === 'specified'}
                aria-pressed={row.startMode === 'specified'}
                disabled={disabled}
                onclick={() => onStartModeChange('specified')}
              >
                <Icon name="schedule" size="16px" />
                <span>{$t('manage.permissionStartSpecified')}</span>
              </button>
            </div>
            {#if row.startMode === 'specified'}
              <input
                type="datetime-local"
                step="1"
                value={toLocalDateTimeInput(row.entry.start_time)}
                aria-label={$t('manage.permissionStartsAt')}
                aria-invalid={validation?.startTime !== null}
                aria-describedby={validation?.startTime ? 'permission-start-error' : undefined}
                disabled={disabled}
                oninput={(event) => updateStartTime(event.currentTarget.value)}
              />
            {:else}
              <div class="mode-summary">
                <Icon name="accessTime" size="16px" />
                {$t('manage.permissionImmediateSummary')}
              </div>
            {/if}
            {#if validation?.startTime}
              <span id="permission-start-error" class="validation-message" role="alert">
                <Icon name="errorFilled" size="14px" />
                {$t('manage.permissionStartInvalid')}
              </span>
            {/if}
          </fieldset>

          <fieldset class="field-group" class:field-error={validation?.endTime !== null}>
            <legend class="field-label">{$t('manage.permissionEndsAt')}</legend>
            <span class="field-description">{$t('manage.permissionEndModeHelp')}</span>
            <div class="segmented-control">
              <button
                type="button"
                class:active={row.endMode === 'never'}
                aria-pressed={row.endMode === 'never'}
                disabled={disabled}
                onclick={() => onEndModeChange('never')}
              >
                <Icon name="history" size="16px" />
                <span>{$t('manage.permissionNeverExpires')}</span>
              </button>
              <button
                type="button"
                class:active={row.endMode === 'specified'}
                aria-pressed={row.endMode === 'specified'}
                disabled={disabled}
                onclick={() => onEndModeChange('specified')}
              >
                <Icon name="calendarToday" size="16px" />
                <span>{$t('manage.permissionEndSpecified')}</span>
              </button>
            </div>
            {#if row.endMode === 'specified'}
              <input
                type="datetime-local"
                step="1"
                value={toLocalDateTimeInput(row.entry.end_time ?? Number.NaN)}
                aria-label={$t('manage.permissionEndsAt')}
                aria-invalid={validation?.endTime !== null}
                aria-describedby={validation?.endTime ? 'permission-end-error' : undefined}
                disabled={disabled}
                oninput={(event) => updateEndTime(event.currentTarget.value)}
              />
            {:else}
              <div class="mode-summary">
                <Icon name="verified" size="16px" />
                {$t('manage.permissionNoExpirySummary')}
              </div>
            {/if}
            {#if validation?.endTime}
              <span id="permission-end-error" class="validation-message" role="alert">
                <Icon name="errorFilled" size="14px" />
                {$t(validation.endTime === 'before-start'
                  ? 'manage.permissionIntervalInvalid'
                  : 'manage.permissionEndInvalid')}
              </span>
            {/if}
          </fieldset>
        </div>
      </div>
    {/key}
  {/if}
</section>

<style>
  .entry-editor-pane {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: var(--color-md3-surface-container);
  }

  .editor-empty,
  .deleted-editor {
    display: grid;
    min-height: 100%;
    place-items: center;
    align-content: center;
    gap: 0.65rem;
    padding: 2rem;
    text-align: center;
  }

  .editor-empty-icon,
  .deleted-icon {
    display: grid;
    width: 3.25rem;
    height: 3.25rem;
    place-items: center;
    border-radius: var(--explorer-radius-large, 12px);
    color: var(--color-md3-primary-emphasis);
    background: var(--color-md3-primary-container);
  }

  .deleted-icon {
    color: var(--color-md3-error);
    background: var(--color-md3-error-container);
  }

  h3 { margin: 0; color: var(--color-md3-on-surface); font: 650 0.9375rem/1.3 var(--font-md3-sans); }

  .editor-empty p,
  .deleted-editor p {
    max-width: 44ch;
    margin: 0.25rem auto 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 0.8rem/1.55 var(--font-md3-sans);
  }

  .deleted-editor button {
    display: inline-flex;
    min-height: 2.25rem;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.45rem;
    border-radius: var(--explorer-radius-small, 6px);
    padding: 0.35rem 0.75rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font: 600 0.76rem/1.2 var(--font-md3-sans);
  }

  .editor-content { min-height: 100%; }

  .editor-enter {
    animation: editor-context-enter 170ms cubic-bezier(0.05, 0.7, 0.1, 1) both;
  }

  @keyframes editor-context-enter {
    from { opacity: 0.65; transform: translateX(8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .editor-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 68%, transparent);
    padding: 1rem 1.15rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 42%, transparent);
  }

  .editor-heading-line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; }

  .editor-heading-line > span {
    border-radius: 9999px;
    padding: 0.12rem 0.42rem;
    color: var(--color-md3-primary-emphasis);
    background: var(--color-md3-primary-container);
    font: 600 0.65rem/1.35 var(--font-md3-sans);
  }

  .editor-header p {
    margin: 0.25rem 0 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 0.72rem/1.45 var(--font-md3-sans);
  }

  .editor-delete {
    display: grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border-radius: 9999px;
    color: var(--color-md3-error);
    transition: background-color 100ms ease, transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .editor-delete:hover:not(:disabled) { background: var(--color-md3-error-container); }
  .editor-delete:active:not(:disabled) { transform: scale(0.93); }

  .editor-form {
    display: grid;
    gap: 1.35rem;
    max-width: 42rem;
    padding: 1.25rem 1.15rem 1.75rem;
  }

  .field-group {
    display: grid;
    min-width: 0;
    gap: 0.45rem;
    margin: 0;
    border: 0;
    padding: 0;
  }

  .field-label { color: var(--color-md3-on-surface); font: 600 0.8rem/1.35 var(--font-md3-sans); }
  .field-description { margin-top: -0.2rem; color: var(--color-md3-on-surface-variant); font: 400 0.69rem/1.45 var(--font-md3-sans); }

  input {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.625rem;
    min-width: 0;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    outline: 0;
    padding: 0 0.75rem;
    color: var(--color-md3-on-surface);
    background: var(--color-md3-field);
    font: 400 0.82rem/1.4 var(--font-md3-sans);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  input:focus {
    border-color: var(--color-md3-primary);
    box-shadow: inset 0 0 0 1px var(--color-md3-primary);
  }

  .field-error input {
    border-color: var(--color-md3-error);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-md3-error) 35%, transparent);
  }

  .segmented-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    background: var(--color-md3-surface-container-high);
  }

  .segmented-control button {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.45rem 0.65rem;
    color: var(--color-md3-on-surface-variant);
    font: 600 0.76rem/1.25 var(--font-md3-sans);
    transition: color 120ms ease, background-color 120ms ease, transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .segmented-control button + button { border-left: 1px solid var(--color-md3-outline); }
  .segmented-control button:hover:not(:disabled):not(.active) { color: var(--color-md3-on-surface); background: var(--color-md3-surface-container-highest); }
  .segmented-control button.active { color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); }
  .segmented-control button.danger-active { color: var(--color-md3-on-error-container); background: var(--color-md3-error-container); }
  .segmented-control button:active:not(:disabled) { transform: scale(0.98); }

  .mode-summary {
    display: flex;
    min-height: 2.625rem;
    align-items: center;
    gap: 0.45rem;
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0 0.75rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-high);
    font: 400 0.78rem/1.4 var(--font-md3-sans);
  }

  .validation-message {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--color-md3-error);
    font: 500 0.7rem/1.4 var(--font-md3-sans);
  }

  button:disabled,
  input:disabled { cursor: not-allowed; opacity: 0.45; }

  @media (max-width: 719px) {
    .entry-editor-pane { width: 100%; max-width: 100%; min-height: 30rem; }
  }

  @media (pointer: coarse) {
    .editor-delete { width: 2.75rem; height: 2.75rem; }
    .segmented-control button,
    input,
    .mode-summary,
    .deleted-editor button { min-height: 3rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .editor-enter { animation: none; }
    .editor-delete,
    .segmented-control button { transition: none; }
  }
</style>
