<script lang="ts">
  import { onMount } from 'svelte';
  import '@fluentui/web-components/switch.js';
  import type { Switch } from '@fluentui/web-components';
  import { disabledAttribute } from '$lib/shared/fluent/control';
  interface Props {
    checked?: boolean; disabled?: boolean; ariaLabel?: string; class?: string;
    onChange?: (checked: boolean) => void;
  }
  let { checked = $bindable(false), disabled = false, ariaLabel = '', class: className = '', onChange }: Props = $props();
  const controlId = $props.id();
  let element: Switch | undefined = $state();
  let pressed = $state(false);
  let motionReady = $state(false);
  $effect(() => { if (element) element.checked = checked; });
  $effect(() => { if (disabled) pressed = false; });

  // Apply the initial bound value before enabling transitions on the part.
  onMount(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { motionReady = true; });
    });
    return () => cancelAnimationFrame(frame);
  });

  function releasePress() { pressed = false; }
</script>
<label class="cfms-choice-target" for={controlId}><fluent-switch bind:this={element} id={controlId} role="switch" use:disabledAttribute={disabled} aria-label={ariaLabel}
  tabindex={disabled ? -1 : 0}
  aria-checked={checked} aria-disabled={disabled || undefined} data-focus-ring="fluent"
  class="cfms-switch {className}"
  data-pressed={pressed && !disabled || undefined}
  data-motion-ready={motionReady || undefined}
  onpointerdown={(event) => { if (!disabled && event.button === 0) pressed = true; }}
  onpointerup={releasePress}
  onpointercancel={releasePress}
  onpointerleave={releasePress}
  onkeydown={(event) => { if (!disabled && event.key === ' ') pressed = true; }}
  onkeyup={(event) => { if (event.key === ' ') releasePress(); }}
  onblur={releasePress}
  onchange={() => { if (element && !disabled) { checked = element.checked; onChange?.(checked); } }}
></fluent-switch></label>
<style>
  .cfms-switch {
    vertical-align: middle;
    flex-shrink: 0;
    transition: background-color var(--durationFaster) var(--curveEasyEase),
      border-color var(--durationFaster) var(--curveEasyEase);
  }
  .cfms-switch::part(checked-indicator) {
    margin-inline-start: 0;
    transform: translateX(var(--switch-offset, 0px)) scale(var(--switch-scale, 1));
    transform-origin: left center;
    transition: none;
  }
  .cfms-switch[data-motion-ready]::part(checked-indicator) {
    transition: transform calc(var(--durationNormal) * 0.9) cubic-bezier(0.16, 1, 0.3, 1),
      background-color var(--durationFaster) var(--curveEasyEase),
      opacity var(--durationFaster) var(--curveEasyEase);
  }
  .cfms-switch[aria-checked="true"] { --switch-offset: 20px; }
  .cfms-switch[aria-checked="true"]::part(checked-indicator) { transform-origin: right center; }
  .cfms-switch:dir(rtl)[aria-checked="true"] { --switch-offset: -20px; }
  .cfms-switch:dir(rtl)::part(checked-indicator) { transform-origin: right center; }
  .cfms-switch:dir(rtl)[aria-checked="true"]::part(checked-indicator) { transform-origin: left center; }
  @media (hover: hover) {
    .cfms-switch:hover:not([aria-disabled="true"]) { --switch-scale: 1.08; }
  }
  .cfms-switch[data-pressed]:not([aria-disabled="true"]) {
    border-color: var(--colorNeutralStrokeAccessiblePressed);
  }
  .cfms-switch[data-pressed][aria-checked="true"]:not([aria-disabled="true"]) {
    background-color: var(--colorCompoundBrandBackgroundPressed);
    border-color: var(--colorCompoundBrandBackgroundPressed);
  }
  .cfms-switch[data-pressed]:not([aria-disabled="true"])::part(checked-indicator) { opacity: 0.8; }
  @media (forced-colors: active) {
    .cfms-switch[data-pressed]:not([aria-disabled="true"]) { border-color: ButtonText; }
    .cfms-switch[data-pressed][aria-checked="true"]:not([aria-disabled="true"]) {
      background-color: Highlight;
      border-color: Highlight;
    }
    .cfms-switch[data-pressed]:not([aria-disabled="true"])::part(checked-indicator) { opacity: 1; }
  }
  :global(html[data-reduce-motion="true"]) .cfms-switch:not([aria-disabled="true"]) { --switch-scale: 1; }
  :global(html[data-reduce-motion="true"]) .cfms-switch::part(checked-indicator) { transition: none; }
  @media (prefers-reduced-motion: reduce) {
    :global(html:not([data-reduce-motion="false"])) .cfms-switch:not([aria-disabled="true"]) { --switch-scale: 1; }
    :global(html:not([data-reduce-motion="false"])) .cfms-switch { transition: none; }
    :global(html:not([data-reduce-motion="false"])) .cfms-switch::part(checked-indicator) { transition: none; }
  }
  .cfms-choice-target { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; min-inline-size: 28px; min-block-size: 28px; position: relative; }
  @media (pointer: coarse) { .cfms-choice-target { min-block-size: 44px; min-inline-size: 44px; } }
</style>
