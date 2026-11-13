<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    inputId: string;
    label: string;
    error?: boolean;
    disabled?: boolean;
    controlSize?: 'small' | 'medium' | 'large';
    labelContent?: Snippet;
    end?: Snippet;
    children: Snippet;
  }
  let { inputId, label, error = false, disabled = false, controlSize = 'medium', labelContent, end, children }: Props = $props();
</script>

<div class="cfms-field" data-control-size={controlSize} class:cfms-field--error={error} class:cfms-field--disabled={disabled}>
  <label class="cfms-field__label" for={inputId} title={label}>
    {#if labelContent}{@render labelContent()}{:else}{label}{/if}
  </label>
  <div class="cfms-field__content cfms-field-surface">
    <div class="cfms-field__input" class:cfms-field__input--with-end={Boolean(end)}>{@render children()}</div>
    {#if end}<span class="cfms-field__end">{@render end()}</span>{/if}
  </div>
  <!-- The decorative legend cuts a real notch without painting over translucent surfaces. -->
  <fieldset class="cfms-field__outline" aria-hidden="true">
    <legend><span>{#if labelContent}{@render labelContent()}{:else}{label}{/if}</span></legend>
  </fieldset>
</div>

<style>
  .cfms-field {
    --cfms-outline-color: var(--colorNeutralStroke1);
    --cfms-field-padding-block: 0px;
    /* Give ordinary notched labels room without resizing compact or explicit
     * large fields. Date/time clearance already reaches this minimum. */
    --cfms-control-height: max(var(--cfms-field-height-medium), calc(var(--cfms-control-height-medium) + 2 * var(--cfms-field-padding-block)));
    box-sizing: border-box;
    position: relative;
    block-size: fit-content;
    inline-size: 100%;
    min-inline-size: 0;
    border-radius: var(--borderRadiusMedium);
  }
  .cfms-field[data-control-size="small"] { --cfms-control-height: calc(var(--cfms-control-height-small) + 2 * var(--cfms-field-padding-block)); }
  .cfms-field[data-control-size="large"] { --cfms-control-height: calc(var(--cfms-control-height-large) + 2 * var(--cfms-field-padding-block)); }
  .cfms-field:has(:global(input:is([type="date"], [type="time"], [type="datetime-local"]))) {
    --cfms-field-padding-block: 4px;
  }
  .cfms-field__label, .cfms-field__outline legend {
    font: 400 12px/16px var(--fontFamilyBase);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cfms-field__label {
    position: absolute;
    inset-block-start: calc(-1 * var(--cfms-field-label-offset));
    inset-inline-start: 12px;
    z-index: 1;
    max-inline-size: calc(100% - 24px);
    color: var(--colorNeutralForeground3);
    cursor: text;
    transition: color var(--durationFaster) var(--curveEasyEase);
  }
  .cfms-field__content {
    box-sizing: border-box;
    display: flex;
    min-inline-size: 0;
    min-block-size: var(--cfms-control-height);
    align-items: center;
    border: 1px solid transparent;
    border-radius: inherit;
  }
  .cfms-field__outline {
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    inset-block-start: calc(-1 * var(--cfms-field-label-offset));
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 1px solid var(--cfms-outline-color);
    border-block-end-color: var(--colorNeutralStrokeAccessible);
    border-radius: inherit;
    pointer-events: none;
    transition: border-color var(--durationFaster) var(--curveEasyEase);
  }
  .cfms-field__input {
    display: flex;
    flex: 1;
    min-inline-size: 0;
    align-items: center;
    border-radius: inherit;
  }
  .cfms-field__end {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0;
    margin-block: -1px;
    border-radius: inherit;
  }
  .cfms-field__input--with-end { container-type: inline-size; }
  /* At narrow/zoomed sizes, keep space for editable text and full-size actions
   * before spending it on the decorative leading icon or fixed padding. */
  @container (max-width: 80px) {
    .cfms-field__input--with-end :global([data-field-leading-icon]) { display: none; }
    .cfms-field__input--with-end :global(input) { padding-inline: min(12px, 20cqi); }
  }
  .cfms-field__end :global(:is(button, .cfms-button)) {
    box-sizing: border-box;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    inline-size: var(--cfms-control-height);
    block-size: var(--cfms-control-height);
    min-inline-size: var(--cfms-control-height);
    min-block-size: var(--cfms-control-height);
    padding: 0;
  }
  .cfms-field__end :global(:is(button, .cfms-button):last-child) {
    border-start-end-radius: var(--borderRadiusMedium);
    border-end-end-radius: var(--borderRadiusMedium);
  }
  .cfms-field .cfms-field__outline legend {
    margin-block: 0;
    max-inline-size: calc(100% - 16px);
    margin-inline-start: 8px;
    padding-inline: 4px;
  }
  .cfms-field__outline legend span { visibility: hidden; }
  .cfms-field:hover { --cfms-outline-color: var(--colorNeutralStroke1Hover); }
  .cfms-field:focus-within { --cfms-outline-color: var(--colorStrokeFocus2); }
  .cfms-field:focus-within .cfms-field__outline {
    border-color: var(--cfms-outline-color);
    border-block-end-width: 2px;
  }
  .cfms-field:focus-within .cfms-field__label { color: var(--colorBrandForeground1); }
  .cfms-field--error, .cfms-field--error:hover, .cfms-field--error:focus-within,
  .cfms-field:has(:global([aria-invalid="true"])) { --cfms-outline-color: var(--colorStatusDangerBorder1); }
  .cfms-field--error .cfms-field__outline,
  .cfms-field:has(:global([aria-invalid="true"])) .cfms-field__outline { border-color: var(--cfms-outline-color); }
  .cfms-field--error .cfms-field__label,
  .cfms-field:has(:global([aria-invalid="true"])) .cfms-field__label { color: var(--colorStatusDangerForeground1); }
  .cfms-field--disabled,
  .cfms-field:has(:global(:is(input:disabled, textarea:disabled, select:disabled, fluent-text-input[disabled]))) {
    --cfms-outline-color: var(--colorNeutralStrokeDisabled);
  }
  .cfms-field--disabled .cfms-field__label,
  .cfms-field:has(:global(:is(input:disabled, textarea:disabled, select:disabled, fluent-text-input[disabled]))) .cfms-field__label {
    color: var(--colorNeutralForegroundDisabled);
    cursor: default;
  }
  .cfms-field--disabled .cfms-field__outline,
  .cfms-field:has(:global(:is(input:disabled, textarea:disabled, select:disabled, fluent-text-input[disabled]))) .cfms-field__outline {
    border-color: var(--colorNeutralStrokeDisabled);
  }
  @media (pointer: coarse) {
    .cfms-field__content :global(:is(input, textarea, select)) { font-size: 16px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cfms-field__label, .cfms-field__outline { transition: none; }
  }
  @media (forced-colors: active) {
    .cfms-field { --cfms-outline-color: ButtonText; }
    .cfms-field__label { color: FieldText; }
    .cfms-field:focus-within { --cfms-outline-color: Highlight; }
    .cfms-field:focus-within .cfms-field__label { color: Highlight; }
    .cfms-field--disabled .cfms-field__outline { border-color: GrayText; }
    .cfms-field--disabled .cfms-field__label { color: GrayText; }
  }
</style>
