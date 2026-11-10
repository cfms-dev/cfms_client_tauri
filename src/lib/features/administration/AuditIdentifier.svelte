<script lang="ts">
  import { onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import { copyText } from '$lib/shared/platform/clipboard';

  let { value }: { value: string | null | undefined } = $props();
  let expanded = $state(false);
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;
  const shortened = $derived(Boolean(value && value.length > 7));

  function clearLongPress() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  onDestroy(clearLongPress);

  async function copy() {
    if (!value) return;
    try {
      await copyText(value);
      notificationStore.success($t('manage.auditIdCopied'), 1600);
    } catch {
      notificationStore.error($t('manage.auditIdCopyFailed'));
    }
  }
</script>

{#if value}
  <button
    type="button"
    class="audit-identifier rounded-md px-1 py-0.5 text-left leading-relaxed transition-colors hover:bg-md3-primary-container/30 hover:text-md3-primary-emphasis"
    title={value}
    aria-label={$t(expanded ? 'manage.collapseAuditId' : 'manage.expandAuditId')}
    aria-expanded={expanded}
    onclick={(event) => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
      } else expanded = !expanded;
    }}
    oncontextmenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      clearLongPress();
      void copy();
    }}
    onpointerdown={(event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      clearLongPress();
      suppressClick = false;
      longPressTimer = setTimeout(() => {
        suppressClick = true;
        longPressTimer = null;
        void copy();
      }, 550);
    }}
    onpointerup={clearLongPress}
    onpointercancel={clearLongPress}
    onpointerleave={clearLongPress}
  >
    {expanded || !shortened ? value : `${value.slice(0, 7)}…`}
  </button>
{:else}
  <span class="text-md3-on-surface-variant">—</span>
{/if}

<style>
  .audit-identifier {
    max-width: 100%;
    overflow-wrap: anywhere;
    vertical-align: top;
    touch-action: manipulation;
    -webkit-touch-callout: none;
    user-select: none;
  }
</style>
