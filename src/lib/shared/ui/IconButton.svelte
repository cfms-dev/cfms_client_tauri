<script lang="ts">
  import Icon from '$lib/shared/ui/Icon.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import type { IconName } from '$lib/shared/ui/icons';
  interface Props {
    icon: IconName; label: string; active?: boolean; disabled?: boolean; badge?: number;
    tone?: 'default' | 'danger'; size?: number | string; class?: string; onclick?: (event: MouseEvent) => void;
  }
  let { icon, label, active = false, disabled = false, badge = 0, tone = 'default', size = 20, class: className = '', onclick }: Props = $props();
</script>
<span class="cfms-icon-button" class:cfms-icon-button--danger={tone === 'danger'}>
  <FluentButton appearance={active ? 'outline' : 'subtle'} iconOnly {disabled} {onclick}
    aria-label={label} title={label} aria-pressed={active ? 'true' : undefined} class={className}>
    <Icon name={icon} {size} filled={active} />
  </FluentButton>
  {#if badge > 0}<span class="cfms-icon-button__badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>{/if}
</span>
<style>
  .cfms-icon-button { position: relative; display: inline-flex; flex-shrink: 0; }
  .cfms-icon-button--danger { --colorNeutralForeground2: var(--colorStatusDangerForeground1); }
  .cfms-icon-button__badge { position: absolute; pointer-events: none; top: -3px; right: -3px; min-width: 14px; padding: 1px 4px; border-radius: 99px; background: var(--colorStatusDangerBackground3); color: var(--colorNeutralForegroundStaticInverted); font: 600 12px/16pxpx var(--fontFamilyBase); text-align: center; }
</style>
