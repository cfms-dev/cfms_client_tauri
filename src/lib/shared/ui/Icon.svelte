<script lang="ts">
  import { ICON_VARIANTS, type IconName } from '$lib/shared/ui/icons';
  interface Props { name: IconName; size?: string | number; filled?: boolean; duotone?: boolean; tone?: 'default' | 'warning'; class?: string; }
  let { name, size = 24, filled = false, duotone = false, tone = 'default', class: className = '' }: Props = $props();
  const isDuotone = $derived(duotone && 'duotone' in ICON_VARIANTS[name]);
  const primaryIsBrand = $derived.by(() => {
    const icon = ICON_VARIANTS[name];
    return isDuotone && 'primaryTone' in icon && icon.primaryTone === 'brand';
  });
  const iconSize = $derived(typeof size === 'number' ? size + 'px' : /^\d+(\.\d+)?(px|em|rem|%)$/.test(size) ? size : '24px');
  const artwork = $derived.by(() => {
    const icon = ICON_VARIANTS[name];
    const small = typeof size === 'number' ? size <= 20 : /^\d+(\.\d+)?px$/.test(size) && parseFloat(size) <= 20;
    if (duotone && 'duotone' in icon) return small ? icon.smallDuotone : icon.duotone;
    return small ? filled ? icon.smallFilled : icon.small : filled ? icon.filled : icon.regular;
  });
</script>
<span class="cfms-icon select-none {className}" class:duotone={isDuotone} class:primary-brand={primaryIsBrand} class:warning={tone === 'warning'} style:width={iconSize} style:height={iconSize} aria-hidden="true" data-icon={name}>
  {@html artwork}
</span>
<style>
  .cfms-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; vertical-align: middle; color: inherit; fill: currentColor; line-height: 1; }
  .cfms-icon :global(svg) { display: block; width: 100%; height: 100%; }
  .duotone { --cfms-icon-primary: currentColor; --cfms-icon-secondary: var(--colorCompoundBrandForeground1); }
  .duotone.primary-brand { --cfms-icon-primary: var(--colorCompoundBrandForeground1); --cfms-icon-secondary: currentColor; }
  .warning { color: var(--colorStatusWarningForeground1); }
  .duotone.warning { --cfms-icon-primary: currentColor; --cfms-icon-secondary: var(--colorNeutralForeground2); }
  @media (forced-colors: active) {
    .warning { color: inherit; }
    .duotone, .duotone.primary-brand, .duotone.warning { --cfms-icon-primary: currentColor; --cfms-icon-secondary: currentColor; }
  }
</style>
