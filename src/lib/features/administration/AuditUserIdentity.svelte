<script lang="ts">
  // Fluent log identity preview: compact trigger, readable summary, explicit actions.
  // The existing user details modal remains the destination for deeper inspection.
  import { onDestroy, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { ManagedUserInfo } from '$lib/api';
  import type { AuditUserPreviewCache } from '$lib/features/authentication/audit-user-preview';
  import { portal } from '$lib/shared/actions/portal';
  import { copyText } from '$lib/shared/platform/clipboard';
  import { serverErrorStatus } from '$lib/api/server-errors';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import { menuScale } from '$lib/shared/motion/transitions';
  import AvatarPreview from '$lib/features/authentication/AvatarPreview.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';

  let { value, previewKey, activeKey = $bindable(null), cache, onViewDetails, disabled = false }: {
    value: string | null | undefined;
    previewKey: string;
    activeKey: string | null;
    cache: AuditUserPreviewCache;
    onViewDetails: (userId: string, info?: ManagedUserInfo) => void | Promise<void>;
    disabled?: boolean;
  } = $props();

  const panelId = $props.id();
  let trigger = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();
  let info = $state<ManagedUserInfo | null>(null);
  let errorKey = $state<string | null>(null);
  let avatarPath = $state<string | null>(null);
  let left = $state(0);
  let top = $state(0);
  let maxHeight = $state(0);
  let ready = $state(false);
  let copied = $state(false);
  const open = $derived(Boolean(value) && activeKey === previewKey);
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerFocusing = false;
  let keyboardFocus = false;
  let restoringFocus = false;
  let suppressCopy = false;
  let touchStart: { x: number; y: number } | null = null;

  const contains = (target: EventTarget | null) => target instanceof Node
    && Boolean(trigger?.contains(target) || panel?.contains(target));

  function clearTimers() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    clearTimeout(pressTimer);
  }
  onDestroy(() => {
    clearTimers();
    clearTimeout(copiedTimer);
  });

  function close(returnFocus = false) {
    clearTimers();
    if (activeKey === previewKey) activeKey = null;
    if (returnFocus) {
      restoringFocus = true;
      trigger?.focus({ preventScroll: true });
      restoringFocus = false;
    }
  }

  function scheduleClose() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (keyboardFocus && contains(document.activeElement)) return;
      close();
    }, 200);
  }

  function show() {
    if (!value || disabled) return;
    clearTimeout(closeTimer);
    activeKey = previewKey;
  }

  function enter() {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    if (!open) openTimer = setTimeout(show, 300);
  }

  function date(value: number | null | undefined) {
    return value && value > 0 ? new Date(value * 1000).toLocaleString() : '-';
  }

  async function copy() {
    if (!value) return;
    try {
      await copyText(value);
      clearTimeout(copiedTimer);
      copied = true;
      copiedTimer = setTimeout(() => { copied = false; }, 1600);
    } catch {
      clearTimeout(copiedTimer);
      copied = false;
      notificationStore.error($t('manage.userIdCopyFailed'));
    }
  }

  function actions() {
    return Array.from(panel?.querySelectorAll<HTMLElement>('[data-preview-action]') ?? [])
      .filter((element) => element.getAttribute('aria-disabled') !== 'true');
  }

  function panelKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const buttons = actions();
    const focused = event.composedPath();
    if (event.shiftKey && focused.includes(buttons[0])) {
      event.preventDefault();
      restoringFocus = true;
      trigger?.focus({ preventScroll: true });
      restoringFocus = false;
    } else if (!event.shiftKey && focused.includes(buttons[buttons.length - 1])) {
      // Resume natural tab order from the trigger, rather than the body portal.
      close(true);
    }
  }

  $effect(() => {
    if (!open || !value) return;
    clearTimeout(copiedTimer);
    copied = false;
    const userId = value;
    let current = true;
    info = null;
    errorKey = null;
    avatarPath = null;
    ready = false;
    void cache.info(userId).then(async (result) => {
      if (!current) return;
      info = result;
      const path = await cache.avatar(result);
      if (current) avatarPath = path;
    }).catch((error: unknown) => {
      if (!current) return;
      const status = serverErrorStatus(error);
      errorKey = status === 403 ? 'manage.userPreviewDenied'
        : status === 404 ? 'manage.userPreviewMissing' : 'manage.userPreviewFailed';
    });
    return () => { current = false; };
  });

  $effect(() => {
    if (!open) return;
    let current = true;
    let observer: ResizeObserver | undefined;
    const position = () => {
      if (!current || !trigger || !panel) return;
      const anchor = trigger.getBoundingClientRect();
      const padding = 12;
      const below = window.innerHeight - anchor.bottom - padding - 8;
      const above = anchor.top - padding - 8;
      maxHeight = Math.max(0, Math.max(below, above));
      left = Math.max(padding, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - padding));
      top = below >= panel.offsetHeight || below >= above
        ? anchor.bottom + 8 : Math.max(padding, anchor.top - Math.min(panel.offsetHeight, maxHeight) - 8);
      ready = true;
    };
    void tick().then(() => {
      position();
      if (!current || !panel || typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(position);
      observer.observe(panel);
    });
    const dismiss = () => close();
    const outside = (event: PointerEvent) => { if (!contains(event.target)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(contains(document.activeElement));
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      close();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      current = false;
      observer?.disconnect();
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  });
</script>

{#if value}
  <button
    bind:this={trigger}
    type="button"
    class="user-identity"
    aria-label={$t('manage.previewUserId', { values: { id: value } })}
    aria-expanded={open}
    aria-controls={open ? panelId : undefined}
    aria-haspopup="dialog"
    {disabled}
    onpointerenter={enter}
    onpointerleave={() => {
      clearTimeout(pressTimer);
      pointerFocusing = false;
      if (touchStart) { touchStart = null; suppressCopy = true; }
      scheduleClose();
    }}
    onfocus={() => {
      if (restoringFocus || pointerFocusing) return;
      keyboardFocus = true;
      show();
    }}
    onblur={(event) => { if (!contains(event.relatedTarget)) { keyboardFocus = false; scheduleClose(); } }}
    onkeydown={(event) => {
      if (event.key === 'Tab' && !event.shiftKey && open) {
        event.preventDefault();
        actions()[0]?.focus();
      }
    }}
    onpointerdown={(event) => {
      if (event.button !== 0) return;
      clearTimeout(pressTimer);
      pointerFocusing = true;
      keyboardFocus = false;
      suppressCopy = false;
      touchStart = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null;
      if (touchStart) {
        pressTimer = setTimeout(() => { suppressCopy = true; void copy(); }, 550);
      }
    }}
    onpointermove={(event) => {
      if (touchStart && Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 10) {
        clearTimeout(pressTimer);
        suppressCopy = true;
      }
    }}
    onpointerup={() => { clearTimeout(pressTimer); touchStart = null; pointerFocusing = false; }}
    onpointercancel={() => { clearTimeout(pressTimer); touchStart = null; pointerFocusing = false; suppressCopy = true; }}
    oncontextmenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(pressTimer);
      if (!suppressCopy) void copy();
      suppressCopy = true;
    }}
  >{value.length > 7 ? `${value.slice(0, 7)}…` : value}</button>
{:else}
  <span class="text-md3-on-surface-variant">—</span>
{/if}

{#if open}
  <div
    use:portal
    bind:this={panel}
    id={panelId}
    role="dialog"
    aria-modal="false"
    aria-label={$t('manage.userPreviewTitle')}
    aria-busy={!info && !errorKey}
    tabindex="-1"
    class="user-preview cfms-acrylic-surface"
    style:left={`${left}px`}
    style:top={`${top}px`}
    style:max-height={ready ? `${maxHeight}px` : undefined}
    style:visibility={ready ? 'visible' : 'hidden'}
    in:menuScale={{ duration: 200 }}
    onpointerenter={() => clearTimeout(closeTimer)}
    onpointerleave={scheduleClose}
    onfocusin={() => { keyboardFocus = true; clearTimeout(closeTimer); }}
    onfocusout={(event) => { if (!contains(event.relatedTarget)) { keyboardFocus = false; scheduleClose(); } }}
    onkeydown={panelKeydown}
  >
    <header class="user-preview__header">
      <AvatarPreview username={info?.username ?? ''} size={48} {avatarPath} />
      <div class="user-preview__identity" aria-live="polite">
        {#if info}
          <h3>{info.nickname || info.username}</h3>
          <p>@{info.username}</p>
        {:else}
          <h3>{$t('manage.userPreviewTitle')}</h3>
          <p>{errorKey ? $t('manage.userPreviewUnavailable') : $t('common.loading')}</p>
        {/if}
      </div>
      <FluentButton appearance="subtle" iconOnly data-preview-action
        aria-label={$t('manage.viewUserDetails')} title={$t('manage.viewUserDetails')}
        disabled={!info || disabled}
        onclick={() => { if (info && value) { const result = info; close(true); void onViewDetails(value, result); } }}
      ><Icon name="info" size="20px" /></FluentButton>
    </header>
    <div class="user-preview__id">
      <div><span>{$t('manage.userId')}</span><code>{value}</code></div>
      <FluentButton appearance="subtle" iconOnly data-preview-action
        aria-label={$t('manage.copyUserId')} title={$t('manage.copyUserId')} onclick={copy}
      ><Icon name={copied ? 'check' : 'contentCopy'} size="18px" /></FluentButton>
    </div>
    <div class="user-preview__summary" aria-live="polite">
      {#if info}
        <dl>
          <div><dt>{$t('manage.accountStatus')}</dt><dd>{info.status === 'active' ? $t('manage.statusActive') : $t('manage.statusDisabled')}</dd></div>
          <div><dt>{$t('manage.lastLogin')}</dt><dd>{date(info.last_login)}</dd></div>
          <div><dt>{$t('manage.registered')}</dt><dd>{date(info.created_time)}</dd></div>
        </dl>
      {:else if errorKey}
        <p class="user-preview__error" role="status"><span class="cfms-icon-text__icon"><Icon name="info" size="18px" /></span><span>{$t(errorKey)}</span></p>
      {:else}
        <p role="status">{$t('manage.userPreviewLoading')}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .user-identity {
    max-inline-size: 100%;
    padding: 2px 4px;
    border-radius: 4px;
    color: var(--colorBrandForegroundLink);
    text-align: start;
    overflow-wrap: anywhere;
    touch-action: pan-y;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .user-identity:hover { background: var(--colorSubtleBackgroundHover); }
  .user-identity:disabled { color: var(--colorNeutralForegroundDisabled); }
  .user-preview {
    position: fixed;
    z-index: 45;
    box-sizing: border-box;
    inline-size: min(336px, calc(100vw - 24px));
    padding: 16px;
    overflow: auto;
    border-radius: 12px;
    box-shadow: var(--shadow16);
    color: var(--colorNeutralForeground1);
    font: 14px/20px var(--fontFamilyBase);
  }
  .user-preview__header { display: flex; align-items: center; gap: 12px; }
  .user-preview__identity { flex: 1; min-inline-size: 0; }
  h3 { margin: 0; font-size: 16px; line-height: 22px; font-weight: 600; overflow-wrap: anywhere; }
  p { margin: 0; }
  .user-preview__identity p { color: var(--colorNeutralForeground2); overflow-wrap: anywhere; }
  .user-preview__id { display: flex; align-items: center; gap: 8px; margin-block: 16px; }
  .user-preview__id > div { flex: 1; min-inline-size: 0; }
  .user-preview__id span, dt { color: var(--colorNeutralForeground2); font-size: 12px; line-height: 16px; }
  code { display: block; overflow-wrap: anywhere; font-family: var(--fontFamilyMonospace); font-size: 12px; line-height: 18px; }
  .user-preview__summary { min-block-size: 76px; }
  dl { margin: 0; display: grid; gap: 8px; }
  dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  dd { margin: 0; text-align: end; overflow-wrap: anywhere; }
  .user-preview__error { display: flex; align-items: start; gap: 8px; color: var(--colorNeutralForeground2); }
  @supports ((backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px))) {
    .user-preview { --cfms-acrylic: color-mix(in srgb, var(--colorNeutralBackground1) 90%, transparent); }
  }
  @media (pointer: coarse) { .user-identity { min-block-size: 44px; min-inline-size: 44px; } }
  @media (forced-colors: active) { .user-preview { border: 1px solid CanvasText; box-shadow: none; } }
</style>
