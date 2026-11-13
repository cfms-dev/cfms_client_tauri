<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import { portal } from '$lib/shared/actions/portal';
  import { menuScale } from '$lib/shared/motion/transitions';

  interface Props {
    labels: { label: string; button: string; title: string; help: string; search: string; searchPlaceholder: string; clearSearch: string; options: string; noMatches: string; noSuggestions: string; selected: (count: number) => string; apply: string; addCustom?: string };
    allowCustom?: boolean;
    availableOptions: readonly string[];
    selectedOptions: readonly string[];
    disabled?: boolean;
    onApply: (filters: string[]) => void | Promise<void>;
  }

  let {
    labels,
    allowCustom = false,
    availableOptions,
    selectedOptions,
    disabled = false,
    onApply,
  }: Props = $props();

  const instanceId = $props.id();
  let panelElement = $state<HTMLDivElement | null>(null);
  let rootElement = $state<HTMLDivElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let queryInput = $state<HTMLInputElement | null>(null);
  let open = $state(false);
  let query = $state('');
  let draftOptions = $state<string[]>([]);
  let panelPlacement = $state<'above' | 'below'>('below');
  let panelOffsetX = $state(-320);
  let panelTop = $state(0);
  let panelWidth = $state(400);
  let panelMaxHeight = $state(544);

  const PANEL_GAP = 8;
  const VIEWPORT_PADDING = 16;
  const PANEL_MAX_WIDTH = 400;
  const PANEL_MAX_HEIGHT = 544;
  const PANEL_PREFERRED_MIN_HEIGHT = 360;

  const normalizedAvailableOptions = $derived.by(() => normalizeOptions([
    ...availableOptions,
    ...selectedOptions,
    ...draftOptions,
  ]));
  const normalizedSelectedOptions = $derived(normalizeOptions(selectedOptions));
  const trimmedQuery = $derived(query.trim());
  const filteredOptions = $derived.by(() => {
    const normalizedQuery = trimmedQuery.toLocaleLowerCase();
    if (!normalizedQuery) return normalizedAvailableOptions;
    return normalizedAvailableOptions.filter((action) =>
      action.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
  const customActionAvailable = $derived(
    allowCustom && Boolean(trimmedQuery)
      && !normalizedAvailableOptions.includes(trimmedQuery),
  );
  const draftChanged = $derived(
    JSON.stringify(normalizeOptions(draftOptions)) !== JSON.stringify(normalizedSelectedOptions),
  );

  $effect(() => {
    if (!open || typeof window === 'undefined') return;

    const reposition = () => positionPanel();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && (rootElement?.contains(event.target) || panelElement?.contains(event.target))) return;
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

  $effect(() => {
    if (disabled && open) void closePanel(false);
  });

  function normalizeOptions(actions: readonly string[]): string[] {
    return [...new Set(actions.map((action) => action.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  async function openPanel() {
    if (disabled) return;
    draftOptions = [...normalizedSelectedOptions];
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
    draftOptions = [];
    if (!returnFocus) return;
    await tick();
    triggerElement?.focus({ preventScroll: true });
  }

  function toggleAction(action: string) {
    if (disabled) return;
    if (draftOptions.includes(action)) {
      draftOptions = draftOptions.filter((candidate) => candidate !== action);
    } else {
      draftOptions = normalizeOptions([...draftOptions, action]);
    }
  }

  function addQueryAction() {
    const action = trimmedQuery;
    if (!allowCustom || !action || disabled) return;
    if (!draftOptions.includes(action)) {
      draftOptions = normalizeOptions([...draftOptions, action]);
    }
    query = '';
    void tick().then(() => queryInput?.focus({ preventScroll: true }));
  }

  async function applyFilters() {
    if (disabled) return;
    const filters = normalizeOptions(draftOptions);
    await closePanel();
    await onApply(filters);
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !(event.target instanceof HTMLInputElement)) {
      const options = Array.from(panelElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void closePanel();
    }
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      panelElement?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
      return;
    }
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
    panelOffsetX = clampedLeft;

    const spaceBelow = Math.max(
      0,
      viewportHeight - triggerRect.bottom - PANEL_GAP - VIEWPORT_PADDING,
    );
    const spaceAbove = Math.max(0, triggerRect.top - PANEL_GAP - VIEWPORT_PADDING);

    const openBelow = spaceBelow >= PANEL_PREFERRED_MIN_HEIGHT || spaceBelow >= spaceAbove;
    panelPlacement = openBelow ? 'below' : 'above';
    panelMaxHeight = Math.min(PANEL_MAX_HEIGHT, openBelow ? spaceBelow : spaceAbove);
    panelTop = openBelow ? triggerRect.bottom + PANEL_GAP : triggerRect.top - PANEL_GAP;
  }
</script>

<div class="multi-select-filter" bind:this={rootElement}>
  <button data-fluent-owner="shared-multi-select-filter"
    bind:this={triggerElement}
    type="button"
    class="filter-trigger"
    class:filter-trigger--active={selectedOptions.length > 0}
    aria-label={labels.button}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={`${instanceId}-panel`}
    {disabled}
    onclick={() => open ? closePanel() : openPanel()}
  >
    <Icon name="filterList" size="18px" />
    <span>{labels.label}</span>
    {#if selectedOptions.length > 0}
      <span class="filter-count" aria-hidden="true">{selectedOptions.length}</span>
    {/if}
  </button>

  {#if open}
    <div
      use:portal
      bind:this={panelElement}
      id={`${instanceId}-panel`}
      class="filter-panel cfms-acrylic-surface"
      class:filter-panel--above={panelPlacement === 'above'}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${instanceId}-title`}
      tabindex="-1"
      style={`left: ${panelOffsetX}px; top: ${panelTop}px; width: ${panelWidth}px; max-height: ${panelMaxHeight}px;`}
      transition:menuScale={{ duration: 150, y: -4 }}
      onkeydown={handlePanelKeydown}
    >
      <header class="filter-panel__header">
        <div>
          <h3 id={`${instanceId}-title`}>{labels.title}</h3>
          <p>{labels.help}</p>
        </div>
        <FluentButton data-fluent-owner="shared-multi-select-filter"
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
          aria-label={labels.search}
          placeholder={labels.searchPlaceholder}
          onkeydown={handleInputKeydown}
        />
        {#if query}
          <span class="cfms-input-composite__end">
            <FluentButton data-fluent-owner="shared-multi-select-filter"
              type="button"
              aria-label={labels.clearSearch}
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

      <div class="filter-options" role="listbox" aria-multiselectable="true" aria-label={labels.options}>
        {#if customActionAvailable}
          <button data-fluent-owner="shared-multi-select-filter"
            type="button"
            class="filter-option filter-option--custom"
            role="option"
            aria-selected="false"
            onclick={addQueryAction}
          >
            <span class="filter-option__icon"><Icon name="add" size="17px" /></span>
            <span class="filter-option__content">
              <span>{labels.addCustom}</span>
              <code>{trimmedQuery}</code>
            </span>
          </button>
        {/if}

        {#each filteredOptions as action (action)}
          <button data-fluent-owner="shared-multi-select-filter"
            type="button"
            class="filter-option"
            class:filter-option--selected={draftOptions.includes(action)}
            role="option"
            aria-selected={draftOptions.includes(action)}
            onclick={() => toggleAction(action)}
          >
            <span class="filter-option__icon">
              <Icon name={draftOptions.includes(action) ? 'checkBox' : 'checkBoxBlank'} size="18px" />
            </span>
            <code>{action}</code>
          </button>
        {:else}
          {#if !customActionAvailable}
            <div class="filter-empty">
              <Icon name={trimmedQuery ? 'search' : 'filterList'} size="22px" />
              <p>{trimmedQuery ? labels.noMatches : labels.noSuggestions}</p>
            </div>
          {/if}
        {/each}
      </div>

      <footer class="filter-panel__footer">
        <div class="filter-panel__selection">
          <FluentButton data-fluent-owner="shared-multi-select-filter"
            type="button"
            disabled={draftOptions.length === 0}
            aria-label={$t('common.reset')}
            title={$t('common.reset')}
            onclick={() => {
              draftOptions = [];
              query = '';
            }}
            appearance="subtle"
            class="filter-reset"
            iconOnly
          >
            <Icon name="resetSettings" size="20px" />
          </FluentButton>
          <span class="filter-selection-summary">
            {labels.selected(draftOptions.length)}
          </span>
        </div>
        <div class="filter-panel__actions">
          <FluentButton data-fluent-owner="shared-multi-select-filter"
            type="button"
            onclick={() => closePanel()}
            appearance="subtle"
            class="filter-cancel"
          >
            {$t('common.cancel')}
          </FluentButton>
          <FluentButton data-fluent-owner="shared-multi-select-filter"
            type="button"
            disabled={!draftChanged}
            onclick={applyFilters}
            appearance="subtle"
            class="filter-apply"
          >
            {labels.apply}
          </FluentButton>
        </div>
      </footer>
    </div>
  {/if}
</div>

<style>
  .multi-select-filter {
    position: relative;
    flex: none;
    font-family: var(--fontFamilyBase);
  }

  .filter-trigger {
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    gap: 8px;
    border-radius: var(--borderRadiusMedium);
    padding: 0.3rem 0.55rem;
    color: var(--colorNeutralForeground2);
    font-size: 12px;
    font-weight: 600;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }

  .filter-trigger:hover:not(:is(:disabled, [disabled])),
  .filter-trigger--active {
    color: var(--colorBrandForeground1);
    background: color-mix(in srgb, var(--colorBrandBackground2) 48%, transparent);
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
    color: var(--colorBrandForeground1);
    background: var(--colorBrandBackground2);
    font-size: 12px;
    line-height: 1;
  }

  .filter-panel {
    position: fixed;
    z-index: 50;
    margin: 0;
    right: auto;
    bottom: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: 12px;
    color: var(--colorNeutralForeground1);
    background: var(--cfms-acrylic);
    box-shadow: var(--shadow64);
    -webkit-backdrop-filter: var(--cfms-material-filter);
    backdrop-filter: var(--cfms-material-filter);
  }

  .filter-panel--above {
    translate: 0 -100%;
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
    color: var(--colorNeutralForeground2);
    font-size: 12px;
    line-height: 1.45;
  }

  :global(.filter-close[data-fluent-owner="shared-multi-select-filter"]) {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border-radius: 9999px;
    color: var(--colorNeutralForeground2);
    transition: background-color 120ms ease, color 120ms ease;
  }

  :global(.filter-close[data-fluent-owner="shared-multi-select-filter"]:hover) {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .filter-search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    margin: 0 1rem 0.75rem;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: 8px;
    color: var(--colorNeutralForeground2);
    background: var(--colorNeutralBackground1);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .filter-search:focus-within {
    border-color: var(--colorBrandStroke1);
    box-shadow: inset 0 0 0 1px var(--colorBrandStroke1);
  }

  .filter-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    color: var(--colorNeutralForeground1);
    background: transparent;
    font-size: 12px;
  }

  .filter-search input::placeholder {
    color: var(--colorNeutralForeground2);
  }

  .filter-search :global(:is(button[data-fluent-owner="shared-multi-select-filter"], .cfms-button[data-fluent-owner="shared-multi-select-filter"])) {
    flex: none;
    border-radius: var(--borderRadiusMedium);
    transition: background-color 120ms ease, color 120ms ease;
  }

  .filter-search :global(:is(button[data-fluent-owner="shared-multi-select-filter"], .cfms-button[data-fluent-owner="shared-multi-select-filter"]):hover) {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .filter-options {
    min-height: 0;
    max-height: 20rem;
    flex: 1 1 auto;
    overflow-x: hidden;
    overflow-y: auto;
    border-block: 1px solid color-mix(in srgb, var(--colorNeutralStroke2) 65%, transparent);
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
    background: color-mix(in srgb, var(--colorBrandBackground2) 32%, transparent);
  }

  .filter-option--selected {
    color: var(--colorBrandForeground1);
  }

  .filter-option__icon {
    display: inline-grid;
    width: 1.2rem;
    flex: none;
    place-items: center;
    color: var(--colorNeutralForeground2);
  }

  .filter-option--selected .filter-option__icon,
  .filter-option--custom .filter-option__icon {
    color: var(--colorBrandForeground1);
  }

  .filter-option code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: inherit;
    font-family: var(--font-cfms-mono);
    font-size: 12px;
  }

  .filter-option__content {
    display: grid;
    min-width: 0;
    gap: 4px;
    color: var(--colorNeutralForeground2);
    font-size: 12px;
  }

  .filter-option__content code {
    color: var(--colorNeutralForeground1);
  }

  .filter-empty {
    display: grid;
    min-height: 7rem;
    place-items: center;
    align-content: center;
    gap: 8px;
    padding: 1rem;
    color: var(--colorNeutralForeground2);
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
    color: var(--colorNeutralForeground2);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]),
  :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]),
  :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]) {
    min-height: 2rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0.35rem 0.65rem;
    font-size: 12px;
    font-weight: 600;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }

  :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]) {
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

  :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]),
  :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]) {
    flex: none;
    min-inline-size: 0;
  }

  :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]),
  :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]) {
    color: var(--colorNeutralForeground2);
  }

  :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]:hover:not(:is(:disabled, [disabled]))),
  :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]:hover) {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]) {
    color: var(--colorBrandForeground1);
    background: var(--colorBrandBackground2);
  }

  :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]:hover:not(:is(:disabled, [disabled]))) {
    filter: none;
  }

  :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]:is(:disabled, [disabled])),
  :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]:is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.42;
  }

  :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]:active:not(:is(:disabled, [disabled]))),
  :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]:active),
  :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]:active:not(:is(:disabled, [disabled]))) {
    transform: none;
  }

  @media (pointer: coarse) {
    .filter-trigger,
    .filter-option,
    :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]),
    :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]),
    :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]) {
      min-height: 2.75rem;
    }

    :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]) {
      inline-size: 44px;
      min-inline-size: 44px;
      max-inline-size: 44px;
      block-size: 44px;
    }

    :global(.filter-close[data-fluent-owner="shared-multi-select-filter"]) {
      width: 2.75rem;
      height: 2.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .filter-trigger,
    :global(.filter-close[data-fluent-owner="shared-multi-select-filter"]),
    .filter-search,
    .filter-search :global(:is(button[data-fluent-owner="shared-multi-select-filter"], .cfms-button[data-fluent-owner="shared-multi-select-filter"])),
    .filter-option,
    :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]),
    :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]),
    :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]) {
      transition: none;
    }

    .filter-trigger:active:not(:is(:disabled, [disabled])),
    :global(.filter-reset[data-fluent-owner="shared-multi-select-filter"]:active:not(:is(:disabled, [disabled]))),
    :global(.filter-cancel[data-fluent-owner="shared-multi-select-filter"]:active),
    :global(.filter-apply[data-fluent-owner="shared-multi-select-filter"]:active:not(:is(:disabled, [disabled]))) {
      transform: none;
    }
  }
</style>
