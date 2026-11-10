<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import { menuScale } from '$lib/shared/motion/transitions';

  interface Props {
    availableActions: readonly string[];
    selectedActions: readonly string[];
    disabled?: boolean;
    onApply: (filters: string[]) => void | Promise<void>;
  }

  let {
    availableActions,
    selectedActions,
    disabled = false,
    onApply,
  }: Props = $props();

  let rootElement = $state<HTMLDivElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let queryInput = $state<HTMLInputElement | null>(null);
  let open = $state(false);
  let query = $state('');
  let draftActions = $state<string[]>([]);
  let panelPlacement = $state<'above' | 'below'>('below');
  let panelOffsetX = $state(-320);
  let panelWidth = $state(400);
  let panelMaxHeight = $state(544);

  const PANEL_GAP = 8;
  const VIEWPORT_PADDING = 16;
  const PANEL_MAX_WIDTH = 400;
  const PANEL_MAX_HEIGHT = 544;
  const PANEL_PREFERRED_MIN_HEIGHT = 360;

  const normalizedAvailableActions = $derived.by(() => normalizeActions([
    ...availableActions,
    ...selectedActions,
    ...draftActions,
  ]));
  const normalizedSelectedActions = $derived(normalizeActions(selectedActions));
  const trimmedQuery = $derived(query.trim());
  const filteredActions = $derived.by(() => {
    const normalizedQuery = trimmedQuery.toLocaleLowerCase();
    if (!normalizedQuery) return normalizedAvailableActions;
    return normalizedAvailableActions.filter((action) =>
      action.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
  const customActionAvailable = $derived(
    Boolean(trimmedQuery)
      && !normalizedAvailableActions.includes(trimmedQuery),
  );
  const draftChanged = $derived(
    JSON.stringify(normalizeActions(draftActions)) !== JSON.stringify(normalizedSelectedActions),
  );

  $effect(() => {
    if (!open || typeof window === 'undefined') return;

    const reposition = () => positionPanel();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && rootElement?.contains(event.target)) return;
      void closePanel();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    };
  });

  function normalizeActions(actions: readonly string[]): string[] {
    return [...new Set(actions.map((action) => action.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  async function openPanel() {
    if (disabled) return;
    draftActions = [...normalizedSelectedActions];
    query = '';
    positionPanel();
    open = true;
    await tick();
    positionPanel();
    queryInput?.focus({ preventScroll: true });
  }

  async function closePanel(returnFocus = true) {
    if (!open) return;
    open = false;
    query = '';
    draftActions = [];
    if (!returnFocus) return;
    await tick();
    triggerElement?.focus({ preventScroll: true });
  }

  function toggleAction(action: string) {
    if (disabled) return;
    if (draftActions.includes(action)) {
      draftActions = draftActions.filter((candidate) => candidate !== action);
    } else {
      draftActions = normalizeActions([...draftActions, action]);
    }
  }

  function addQueryAction() {
    const action = trimmedQuery;
    if (!action || disabled) return;
    if (!draftActions.includes(action)) {
      draftActions = normalizeActions([...draftActions, action]);
    }
    query = '';
    void tick().then(() => queryInput?.focus({ preventScroll: true }));
  }

  async function applyFilters() {
    if (disabled) return;
    const filters = normalizeActions(draftActions);
    await closePanel();
    await onApply(filters);
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void closePanel();
    }
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !trimmedQuery) return;
    event.preventDefault();
    addQueryAction();
  }

  function positionPanel() {
    if (typeof window === 'undefined' || !triggerElement) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const triggerRect = triggerElement.getBoundingClientRect();
    const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);
    panelWidth = Math.min(PANEL_MAX_WIDTH, availableWidth);
    const naturalLeft = triggerRect.right - panelWidth;
    const clampedLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(naturalLeft, viewportWidth - panelWidth - VIEWPORT_PADDING),
    );
    panelOffsetX = clampedLeft - triggerRect.left;

    const spaceBelow = Math.max(
      0,
      viewportHeight - triggerRect.bottom - PANEL_GAP - VIEWPORT_PADDING,
    );
    const spaceAbove = Math.max(0, triggerRect.top - PANEL_GAP - VIEWPORT_PADDING);

    const openBelow = spaceBelow >= PANEL_PREFERRED_MIN_HEIGHT || spaceBelow >= spaceAbove;
    panelPlacement = openBelow ? 'below' : 'above';
    panelMaxHeight = Math.min(PANEL_MAX_HEIGHT, openBelow ? spaceBelow : spaceAbove);
  }
</script>

<div class="audit-filter" bind:this={rootElement}>
  <button data-fluent-owner="lib-components-audit-log-filter"
    bind:this={triggerElement}
    type="button"
    class="filter-trigger"
    class:filter-trigger--active={selectedActions.length > 0}
    aria-label={$t('manage.auditFilterButton', { values: { count: selectedActions.length } })}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls="audit-action-filter-panel"
    {disabled}
    onclick={() => open ? closePanel() : openPanel()}
  >
    <Icon name="filterList" size="18px" />
    <span>{$t('manage.auditFilter')}</span>
    {#if selectedActions.length > 0}
      <span class="filter-count" aria-hidden="true">{selectedActions.length}</span>
    {/if}
  </button>

  {#if open}
    <div
      id="audit-action-filter-panel"
      class="filter-panel cfms-acrylic-surface"
      class:filter-panel--above={panelPlacement === 'above'}
      role="dialog"
      aria-modal="false"
      aria-labelledby="audit-action-filter-title"
      tabindex="-1"
      style={`left: ${panelOffsetX}px; width: ${panelWidth}px; max-height: ${panelMaxHeight}px;`}
      transition:menuScale={{ duration: 150, y: -4 }}
      onkeydown={handlePanelKeydown}
    >
      <header class="filter-panel__header">
        <div>
          <h3 id="audit-action-filter-title">{$t('manage.auditFilterTitle')}</h3>
          <p>{$t('manage.auditFilterHelp')}</p>
        </div>
        <FluentButton data-fluent-owner="lib-components-audit-log-filter"
          type="button"
          aria-label={$t('common.close')}
          onclick={() => closePanel()}
          appearance="subtle"
          class="filter-close"
          iconOnly
        >
          <Icon name="close" size="17px" />
        </FluentButton>
      </header>

      <div class="filter-search cfms-input-composite cfms-field-surface">
        <Icon name="search" size="18px" />
        <input class="cfms-native-field"
          bind:this={queryInput}
          bind:value={query}
          type="text"
          data-focus-ring="delegated"
          autocomplete="off"
          aria-label={$t('manage.auditFilterSearch')}
          placeholder={$t('manage.auditFilterSearchPlaceholder')}
          onkeydown={handleInputKeydown}
        />
        {#if query}
          <span class="cfms-input-composite__end">
            <FluentButton data-fluent-owner="lib-components-audit-log-filter"
              type="button"
              aria-label={$t('manage.auditFilterClearSearch')}
              onclick={() => {
                query = '';
                queryInput?.focus({ preventScroll: true });
              }}
              appearance="subtle"
              class="cfms-control-action"
              iconOnly
            >
              <Icon name="close" size="15px" />
            </FluentButton>
          </span>
        {/if}
      </div>

      <div class="filter-options" role="listbox" aria-multiselectable="true" aria-label={$t('manage.auditFilterOptions')}>
        {#if customActionAvailable}
          <button data-fluent-owner="lib-components-audit-log-filter"
            type="button"
            class="filter-option filter-option--custom"
            role="option"
            aria-selected="false"
            onclick={addQueryAction}
          >
            <span class="filter-option__icon"><Icon name="add" size="17px" /></span>
            <span class="filter-option__content">
              <span>{$t('manage.auditFilterAddCustom')}</span>
              <code>{trimmedQuery}</code>
            </span>
          </button>
        {/if}

        {#each filteredActions as action (action)}
          <button data-fluent-owner="lib-components-audit-log-filter"
            type="button"
            class="filter-option"
            class:filter-option--selected={draftActions.includes(action)}
            role="option"
            aria-selected={draftActions.includes(action)}
            onclick={() => toggleAction(action)}
          >
            <span class="filter-option__icon">
              <Icon name={draftActions.includes(action) ? 'checkBox' : 'checkBoxBlank'} size="18px" />
            </span>
            <code>{action}</code>
          </button>
        {:else}
          {#if !customActionAvailable}
            <div class="filter-empty">
              <Icon name={trimmedQuery ? 'search' : 'filterList'} size="22px" />
              <p>{trimmedQuery ? $t('manage.auditFilterNoMatches') : $t('manage.auditFilterNoSuggestions')}</p>
            </div>
          {/if}
        {/each}
      </div>

      <footer class="filter-panel__footer">
        <div class="filter-panel__selection">
          <FluentButton data-fluent-owner="lib-components-audit-log-filter"
            type="button"
            disabled={draftActions.length === 0}
            aria-label={$t('common.reset')}
            title={$t('common.reset')}
            onclick={() => {
              draftActions = [];
              query = '';
            }}
            appearance="subtle"
            class="filter-reset"
            iconOnly
          >
            <Icon name="resetSettings" size="20px" />
          </FluentButton>
          <span class="filter-selection-summary">
            {$t('manage.auditFilterSelected', { values: { count: draftActions.length } })}
          </span>
        </div>
        <div class="filter-panel__actions">
          <FluentButton data-fluent-owner="lib-components-audit-log-filter"
            type="button"
            onclick={() => closePanel()}
            appearance="subtle"
            class="filter-cancel"
          >
            {$t('common.cancel')}
          </FluentButton>
          <FluentButton data-fluent-owner="lib-components-audit-log-filter"
            type="button"
            disabled={!draftChanged}
            onclick={applyFilters}
            appearance="subtle"
            class="filter-apply"
          >
            {$t('manage.auditFilterApply')}
          </FluentButton>
        </div>
      </footer>
    </div>
  {/if}
</div>

<style>
  .audit-filter {
    position: relative;
    flex: none;
    font-family: var(--font-md3-sans);
  }

  .filter-trigger {
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    gap: 8px;
    border-radius: var(--borderRadiusMedium);
    padding: 0.3rem 0.55rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    font-weight: 600;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }

  .filter-trigger:hover:not(:is(:disabled, [disabled])),
  .filter-trigger--active {
    color: var(--color-md3-primary-emphasis);
    background: color-mix(in srgb, var(--color-md3-primary-container) 48%, transparent);
  }

  .filter-trigger:active:not(:is(:disabled, [disabled])) {
    transform: none;
  }

  .filter-trigger:is(:disabled, [disabled]) {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .filter-count {
    display: inline-grid;
    min-width: 1.15rem;
    height: 1.15rem;
    place-items: center;
    border-radius: 9999px;
    padding: 0 0.28rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font-size: 12px;
    line-height: 1;
  }

  .filter-panel {
    position: absolute;
    z-index: 50;
    top: calc(100% + 0.5rem);
    right: auto;
    bottom: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: 12px;
    color: var(--color-md3-on-surface);
    background: var(--cfms-acrylic);
    box-shadow: var(--shadow64);
    -webkit-backdrop-filter: var(--cfms-material-filter);
    backdrop-filter: var(--cfms-material-filter);
  }

  .filter-panel--above {
    top: auto;
    bottom: calc(100% + 0.5rem);
  }

  .filter-panel__header {
    display: flex;
    flex: none;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 1rem 1rem 0.85rem;
  }

  .filter-panel__header h3 {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
  }

  .filter-panel__header p {
    max-width: 32ch;
    margin-top: 0.25rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    line-height: 1.45;
  }

  :global(.filter-close[data-fluent-owner="lib-components-audit-log-filter"]) {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border-radius: 9999px;
    color: var(--color-md3-on-surface-variant);
    transition: background-color 120ms ease, color 120ms ease;
  }

  :global(.filter-close[data-fluent-owner="lib-components-audit-log-filter"]:hover) {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .filter-search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    margin: 0 1rem 0.75rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 8px;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-field);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .filter-search:focus-within {
    border-color: var(--color-md3-primary);
    box-shadow: inset 0 0 0 1px var(--color-md3-primary);
  }

  .filter-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    color: var(--color-md3-on-surface);
    background: transparent;
    font-size: 12px;
  }

  .filter-search input::placeholder {
    color: var(--color-md3-on-surface-variant);
  }

  .filter-search :global(:is(button[data-fluent-owner="lib-components-audit-log-filter"], .cfms-button[data-fluent-owner="lib-components-audit-log-filter"])) {
    flex: none;
    border-radius: var(--borderRadiusMedium);
    transition: background-color 120ms ease, color 120ms ease;
  }

  .filter-search :global(:is(button[data-fluent-owner="lib-components-audit-log-filter"], .cfms-button[data-fluent-owner="lib-components-audit-log-filter"]):hover) {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .filter-options {
    min-height: 0;
    max-height: 20rem;
    flex: 1 1 auto;
    overflow-x: hidden;
    overflow-y: auto;
    border-block: 1px solid color-mix(in srgb, var(--color-md3-outline) 65%, transparent);
    overscroll-behavior: contain;
    padding: 0.35rem 0;
  }

  .filter-option {
    display: flex;
    width: 100%;
    min-height: 2.35rem;
    align-items: center;
    gap: 8px;
    padding: 0.45rem 1rem;
    text-align: left;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .filter-option:hover,
  .filter-option--selected {
    background: color-mix(in srgb, var(--color-md3-primary-container) 32%, transparent);
  }

  .filter-option--selected {
    color: var(--color-md3-primary-emphasis);
  }

  .filter-option__icon {
    display: inline-grid;
    width: 1.2rem;
    flex: none;
    place-items: center;
    color: var(--color-md3-on-surface-variant);
  }

  .filter-option--selected .filter-option__icon,
  .filter-option--custom .filter-option__icon {
    color: var(--color-md3-primary-emphasis);
  }

  .filter-option code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: inherit;
    font-family: var(--font-md3-mono);
    font-size: 12px;
  }

  .filter-option__content {
    display: grid;
    min-width: 0;
    gap: 4px;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
  }

  .filter-option__content code {
    color: var(--color-md3-on-surface);
  }

  .filter-empty {
    display: grid;
    min-height: 7rem;
    place-items: center;
    align-content: center;
    gap: 8px;
    padding: 1rem;
    color: var(--color-md3-on-surface-variant);
    text-align: center;
  }

  .filter-empty p {
    max-width: 30ch;
    font-size: 12px;
    line-height: 1.45;
  }

  .filter-panel__footer {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    min-height: 56px;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 12px 16px;
  }

  .filter-panel__selection {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .filter-panel__actions {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    max-width: 100%;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-inline-start: auto;
  }

  .filter-selection-summary {
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]),
  :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]),
  :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]) {
    min-height: 2rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0.35rem 0.65rem;
    font-size: 12px;
    font-weight: 600;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }

  :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]) {
    display: inline-flex;
    flex: none;
    inline-size: 32px;
    min-inline-size: 32px;
    max-inline-size: 32px;
    block-size: 32px;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]),
  :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]) {
    flex: none;
    min-inline-size: 0;
  }

  :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]),
  :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]) {
    color: var(--color-md3-on-surface-variant);
  }

  :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]:hover:not(:is(:disabled, [disabled]))),
  :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]:hover) {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]) {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]:hover:not(:is(:disabled, [disabled]))) {
    filter: none;
  }

  :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]:is(:disabled, [disabled])),
  :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]:is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.42;
  }

  :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]:active:not(:is(:disabled, [disabled]))),
  :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]:active),
  :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]:active:not(:is(:disabled, [disabled]))) {
    transform: none;
  }

  @media (pointer: coarse) {
    .filter-trigger,
    .filter-option,
    :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]),
    :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]),
    :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]) {
      min-height: 2.75rem;
    }

    :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]) {
      inline-size: 44px;
      min-inline-size: 44px;
      max-inline-size: 44px;
      block-size: 44px;
    }

    :global(.filter-close[data-fluent-owner="lib-components-audit-log-filter"]) {
      width: 2.75rem;
      height: 2.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .filter-trigger,
    :global(.filter-close[data-fluent-owner="lib-components-audit-log-filter"]),
    .filter-search,
    .filter-search :global(:is(button[data-fluent-owner="lib-components-audit-log-filter"], .cfms-button[data-fluent-owner="lib-components-audit-log-filter"])),
    .filter-option,
    :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]),
    :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]),
    :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]) {
      transition: none;
    }

    .filter-trigger:active:not(:is(:disabled, [disabled])),
    :global(.filter-reset[data-fluent-owner="lib-components-audit-log-filter"]:active:not(:is(:disabled, [disabled]))),
    :global(.filter-cancel[data-fluent-owner="lib-components-audit-log-filter"]:active),
    :global(.filter-apply[data-fluent-owner="lib-components-audit-log-filter"]:active:not(:is(:disabled, [disabled]))) {
      transform: none;
    }
  }
</style>
