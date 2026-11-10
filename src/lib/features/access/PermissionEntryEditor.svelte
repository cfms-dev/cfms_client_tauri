<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import type { PermissionEntry } from '$lib/api';
  import {
    parseLocalDateTimeInput,
    toLocalDateTimeInput,
    type PermissionEntryChangeKind,
    type PermissionEntryValidation,
  } from '$lib/features/access/permission-entries';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';

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
        <button data-fluent-owner="lib-components-permission-entry-editor" bind:this={undoButton} type="button" disabled={disabled} onclick={onUndo}>
          <Icon name="undo" size="17px" />
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
          <FluentButton data-fluent-owner="lib-components-permission-entry-editor"
            type="button"
            aria-label={$t('manage.deletePermissionEntry')}
            title={$t('manage.deletePermissionEntry')}
            disabled={disabled}
            onclick={onDelete}
            appearance="subtle"
            class="editor-delete"
            iconOnly
          >
            <Icon name="delete" size="18px" />
          </FluentButton>
        </header>

        <div class="editor-form" aria-live="polite">
          <div class="field-group" class:field-error={validation?.permission !== null}>
            <span class="field-description">{$t('manage.permissionNameHelp')}</span>
            <MdOutlinedField inputId="permission-entry-name" label={$t('manage.permissionName')} {disabled}>
              <input class="cfms-native-field" data-focus-ring="delegated"
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
            </MdOutlinedField>
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
              <FluentButton data-fluent-owner="lib-components-permission-entry-editor"
                type="button"
                aria-pressed={row.entry.granted}
                disabled={disabled}
                onclick={() => onPatch({ granted: true })}
                appearance="subtle"
                class={((row.entry.granted) ? " active" : '')}
              >
                <Icon name="approvalDelegation" size="17px" />
                <span>{$t('manage.permissionGrant')}</span>
              </FluentButton>
              <FluentButton data-fluent-owner="lib-components-permission-entry-editor"
                type="button"
                aria-pressed={!row.entry.granted}
                disabled={disabled}
                onclick={() => onPatch({ granted: false })}
                appearance="subtle"
                class={((!row.entry.granted) ? " active" : '') + ((!row.entry.granted) ? " danger-active" : '')}
              >
                <Icon name="block" size="17px" />
                <span>{$t('manage.permissionRevoke')}</span>
              </FluentButton>
            </div>
          </fieldset>

          <fieldset class="field-group" class:field-error={validation?.startTime !== null}>
            <legend class="field-label">{$t('manage.permissionStartsAt')}</legend>
            <span class="field-description">{$t('manage.permissionStartModeHelp')}</span>
            <div class="segmented-control">
              <FluentButton data-fluent-owner="lib-components-permission-entry-editor"
                type="button"
                aria-pressed={row.startMode === 'immediate'}
                disabled={disabled}
                onclick={() => onStartModeChange('immediate')}
                appearance="subtle"
                class={((row.startMode === 'immediate') ? " active" : '')}
              >
                <Icon name="today" size="16px" />
                <span>{$t('manage.permissionStartImmediately')}</span>
              </FluentButton>
              <FluentButton data-fluent-owner="lib-components-permission-entry-editor"
                type="button"
                aria-pressed={row.startMode === 'specified'}
                disabled={disabled}
                onclick={() => onStartModeChange('specified')}
                appearance="subtle"
                class={((row.startMode === 'specified') ? " active" : '')}
              >
                <Icon name="eventUpcoming" size="16px" />
                <span>{$t('manage.permissionStartSpecified')}</span>
              </FluentButton>
            </div>
            {#if row.startMode === 'specified'}
              <input class="cfms-native-field"
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
            <legend class="field-label">{$t('manage.permissionValidity')}</legend>
            <span class="field-description">{$t('manage.permissionEndModeHelp')}</span>
            <div class="expiry-switch-row">
              <span class="expiry-switch-label">
                <Icon name="allInclusive" size="18px" />
                <span>{$t('manage.permissionNeverExpires')}</span>
              </span>
              <MdSwitch
                checked={row.endMode === 'never'}
                ariaLabel={$t('manage.permissionNeverExpires')}
                {disabled}
                onChange={(checked) => onEndModeChange(checked ? 'never' : 'specified')}
              />
            </div>
            {#if row.endMode === 'specified'}
              <div class="end-time-section">
                <MdOutlinedField inputId="permission-entry-end-time" label={$t('manage.permissionEndsAt')} disabled={disabled}>
                  <input data-focus-ring="delegated" class="cfms-native-field"
                    id="permission-entry-end-time"
                    type="datetime-local"
                    step="1"
                    value={toLocalDateTimeInput(row.entry.end_time ?? Number.NaN)}
                    aria-invalid={validation?.endTime !== null}
                    aria-describedby={validation?.endTime ? 'permission-end-error' : undefined}
                    disabled={disabled}
                    oninput={(event) => updateEndTime(event.currentTarget.value)}
                  />
                </MdOutlinedField>
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
    gap: 12px;
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

  h3 { margin: 0; color: var(--color-md3-on-surface); font: 600 14px/20px var(--font-md3-sans); }

  .editor-empty p,
  .deleted-editor p {
    max-width: 44ch;
    margin: 0.25rem auto 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 12px/16px var(--font-md3-sans);
  }

  .deleted-editor :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"])) {
    display: inline-flex;
    min-height: 2.25rem;
    align-items: center;
    gap: 8px;
    margin-top: 0.45rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0.35rem 0.75rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font: 600 12px/16px var(--font-md3-sans);
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
    gap: 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 68%, transparent);
    padding: 1rem 1.15rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 42%, transparent);
  }

  .editor-heading-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

  .editor-heading-line > span {
    border-radius: 9999px;
    padding: 0.12rem 0.42rem;
    color: var(--color-md3-primary-emphasis);
    background: var(--color-md3-primary-container);
    font: 600 12px/16px var(--font-md3-sans);
  }

  .editor-header p {
    margin: 0.25rem 0 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 12px/16px var(--font-md3-sans);
  }

  :global(.editor-delete[data-fluent-owner="lib-components-permission-entry-editor"]) {
    display: grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border-radius: 9999px;
    color: var(--color-md3-error);
    transition: background-color 100ms ease, transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  :global(.editor-delete[data-fluent-owner="lib-components-permission-entry-editor"]:hover:not(:is(:disabled, [disabled]))) { background: var(--color-md3-error-container); }
  :global(.editor-delete[data-fluent-owner="lib-components-permission-entry-editor"]:active:not(:is(:disabled, [disabled]))) { transform: none; }

  .editor-form {
    display: grid;
    gap: 20px;
    max-width: 42rem;
    padding: 1.25rem 1.15rem 1.75rem;
  }

  .field-group {
    display: grid;
    min-width: 0;
    gap: 8px;
    margin: 0;
    border: 0;
    padding: 0;
  }

  .field-label { color: var(--color-md3-on-surface); font: 600 12px/16px var(--font-md3-sans); }
  .field-description { margin-top: -0.2rem; color: var(--color-md3-on-surface-variant); font: 400 12px/16px var(--font-md3-sans); }

  input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    color: var(--color-md3-on-surface);
    font: 400 14px/20px var(--font-md3-sans);
  }

  .segmented-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    background: var(--color-md3-surface-container-high);
  }

  .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"])) {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0.45rem 0.65rem;
    color: var(--color-md3-on-surface-variant);
    font: 600 12px/16px var(--font-md3-sans);
    transition: color 120ms ease, background-color 120ms ease, transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"])) + :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"])) { border-left: 1px solid var(--color-md3-outline); }
  .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"]):hover:not(:is(:disabled, [disabled])):not(.active[data-fluent-owner="lib-components-permission-entry-editor"])) { color: var(--color-md3-on-surface); background: var(--color-md3-surface-container-highest); }
  .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"]).active[data-fluent-owner="lib-components-permission-entry-editor"]) { color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); }
  .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"]).danger-active[data-fluent-owner="lib-components-permission-entry-editor"]) { color: var(--color-md3-on-error-container); background: var(--color-md3-error-container); }
  .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"]):active:not(:is(:disabled, [disabled]))) { transform: none; }

  .mode-summary {
    display: flex;
    min-height: 2.625rem;
    align-items: center;
    gap: 8px;
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0 0.75rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-high);
    font: 400 12px/16px var(--font-md3-sans);
  }

  .expiry-switch-row {
    display: flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0.15rem 0;
  }

  .expiry-switch-label {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    color: var(--color-md3-on-surface);
    font: 600 12px/16px var(--font-md3-sans);
  }

  .expiry-switch-label :global(.cfms-icon) {
    color: var(--color-md3-primary-emphasis);
  }

  .end-time-section {
    display: grid;
    gap: 8px;
    padding-top: 0.15rem;
  }

  .validation-message {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-md3-error);
    font: 500 12px/16px var(--font-md3-sans);
  }

  :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"]):is(:disabled, [disabled])),
  input:is(:disabled, [disabled]) { cursor: not-allowed; opacity: 0.45; }

  @media (max-width: 719px) {
    .entry-editor-pane { width: 100%; max-width: 100%; min-height: 30rem; }
  }

  @media (pointer: coarse) {
    :global(.editor-delete[data-fluent-owner="lib-components-permission-entry-editor"]) { width: 2.75rem; height: 2.75rem; }
    .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"])),
    .mode-summary,
    .deleted-editor :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"])) { min-height: 3rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .editor-enter { animation: none; }
    :global(.editor-delete[data-fluent-owner="lib-components-permission-entry-editor"]),
    .segmented-control :global(:is(button[data-fluent-owner="lib-components-permission-entry-editor"], .cfms-button[data-fluent-owner="lib-components-permission-entry-editor"])) { transition: none; }
  }
</style>
