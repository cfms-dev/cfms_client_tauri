<script lang="ts">
  import { onMount } from 'svelte';
  import { readExtensionPage, type DeclarativeBlock, type DeclarativePage } from '$lib/api/extensions';
  import { runExtensionWorkflow } from '$lib/extension-workflows';
  import { notificationStore } from '$lib/stores.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let { extensionId, pageId }: { extensionId: string; pageId: string } = $props();
  let page = $state<DeclarativePage | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let runningAction = $state<string | null>(null);
  let formValues = $state<Record<string, Record<string, unknown>>>({});

  onMount(load);

  async function load() {
    loading = true;
    error = null;
    try {
      page = await readExtensionPage(extensionId, pageId);
      if (page.schema_version !== 1 || !Array.isArray(page.blocks)) {
        throw new Error('Unsupported extension page schema');
      }
      const values: Record<string, Record<string, unknown>> = {};
      for (const block of page.blocks) {
        if (block.type !== 'form') continue;
        values[block.id] = Object.fromEntries(block.fields.map((field) => [field.id, field.default ?? (field.type === 'toggle' ? false : '')]));
      }
      formValues = values;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function updateField(formId: string, fieldId: string, value: unknown) {
    formValues = {
      ...formValues,
      [formId]: { ...(formValues[formId] ?? {}), [fieldId]: value },
    };
  }

  async function runAction(action: Extract<DeclarativeBlock, { type: 'actions' }>['actions'][number]) {
    if (runningAction) return;
    runningAction = action.id;
    try {
      await runExtensionWorkflow(extensionId, action.workflow, { input: formValues });
    } catch (cause) {
      notificationStore.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      runningAction = null;
    }
  }

  function cellValue(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (value === null || value === undefined) return '—';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
</script>

{#if loading}
  <div class="extension-state"><ProgressRing size={28} label="Loading extension" /></div>
{:else if error}
  <div class="extension-state extension-error" role="alert">
    <strong>Unable to open extension</strong><p>{error}</p>
    <button type="button" onclick={load}>Try again</button>
  </div>
{:else if page}
  <article class="extension-page">
    <header><h1>{page.title}</h1>{#if page.description}<p>{page.description}</p>{/if}</header>
    <div class="extension-grid">
      {#each page.blocks as block, index (`${block.type}:${index}`)}
        {#if block.type === 'text'}
          <p class:extension-heading={block.style === 'heading'} class:extension-caption={block.style === 'caption'}>{block.text}</p>
        {:else if block.type === 'status_card'}
          <section class="extension-card status-card tone-{block.tone ?? 'default'}">
            <span>{block.title}</span><strong>{block.value}</strong>{#if block.description}<small>{block.description}</small>{/if}
          </section>
        {:else if block.type === 'alert'}
          <section class="extension-alert tone-{block.tone ?? 'info'}" role="status">
            {#if block.title}<strong>{block.title}</strong>{/if}<p>{block.message}</p>
          </section>
        {:else if block.type === 'progress'}
          <section class="extension-card"><span>{block.label}</span><progress aria-label={block.label} value={block.value} max={block.max ?? 100}></progress></section>
        {:else if block.type === 'list'}
          <section class="extension-card extension-wide">
            {#if block.title}<h2>{block.title}</h2>{/if}
            {#if block.items.length === 0}<p class="muted">No items</p>{/if}
            <ul>{#each block.items as item}<li><span><strong>{item.title}</strong>{#if item.description}<small>{item.description}</small>{/if}</span>{#if item.value}<b>{item.value}</b>{/if}</li>{/each}</ul>
          </section>
        {:else if block.type === 'table'}
          <section class="extension-card extension-wide table-wrap">
            {#if block.title}<h2>{block.title}</h2>{/if}
            <table><thead><tr>{#each block.columns as column}<th>{column.label}</th>{/each}</tr></thead>
              <tbody>{#each block.rows as row}<tr>{#each block.columns as column}<td>{cellValue(row, column.key)}</td>{/each}</tr>{/each}</tbody>
            </table>
          </section>
        {:else if block.type === 'empty_state'}
          <section class="extension-card extension-wide empty"><strong>{block.title}</strong>{#if block.description}<p>{block.description}</p>{/if}</section>
        {:else if block.type === 'form'}
          <section class="extension-card extension-wide form-card">
            {#each block.fields as field}
              <label><span>{field.label}</span>
                {#if field.type === 'toggle'}
                  <input type="checkbox" checked={Boolean(formValues[block.id]?.[field.id])} onchange={(event) => updateField(block.id, field.id, event.currentTarget.checked)} />
                {:else if field.type === 'select'}
                  <select value={String(formValues[block.id]?.[field.id] ?? '')} onchange={(event) => updateField(block.id, field.id, event.currentTarget.value)}>
                    {#each field.options ?? [] as option}<option value={option}>{option}</option>{/each}
                  </select>
                {:else}
                  <input type={field.type} value={String(formValues[block.id]?.[field.id] ?? '')} oninput={(event) => updateField(block.id, field.id, field.type === 'number' ? event.currentTarget.valueAsNumber : event.currentTarget.value)} />
                {/if}
              </label>
            {/each}
          </section>
        {:else if block.type === 'actions'}
          <div class="extension-actions extension-wide">
            {#each block.actions as action}
              <button type="button" class:primary={action.tone === 'primary'} class:danger={action.tone === 'danger'} disabled={runningAction !== null} onclick={() => runAction(action)}>{runningAction === action.id ? 'Working…' : action.label}</button>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  </article>
{/if}

<style>
  .extension-page { max-width: 1080px; margin: 0 auto; padding: 1.5rem; color: var(--explorer-text); }
  header { margin-bottom: 1.25rem; } h1 { font-size: 1.35rem; font-weight: 700; } header p, .muted, small { color: var(--explorer-text-muted); }
  .extension-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
  .extension-card, .extension-alert { display: grid; gap: .45rem; border: 1px solid var(--explorer-border); border-radius: var(--explorer-radius-medium); padding: 1rem; background: var(--explorer-surface-raised); }
  .status-card > strong { font-size: 1.65rem; } .extension-wide { grid-column: 1 / -1; }
  .extension-alert { grid-column: 1 / -1; border-left-width: 4px; } .tone-success { border-left-color: var(--explorer-success); } .tone-warning { border-left-color: var(--explorer-warning); } .tone-danger { border-left-color: var(--explorer-danger); }
  .extension-heading { grid-column: 1 / -1; font-size: 1.05rem; font-weight: 650; } .extension-caption { color: var(--explorer-text-muted); font-size: .75rem; }
  ul { display: grid; gap: .25rem; } li { display: flex; justify-content: space-between; gap: 1rem; padding: .6rem 0; border-bottom: 1px solid var(--explorer-border); } li span { display: grid; }
  .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid var(--explorer-border); padding: .65rem; text-align: left; font-size: .8rem; }
  .empty { place-items: center; min-height: 140px; text-align: center; } .form-card label { display: grid; gap: .3rem; } input:not([type='checkbox']), select { min-height: 40px; border: 1px solid var(--explorer-border); border-radius: 8px; padding: .45rem .6rem; background: var(--explorer-background); }
  progress { width: 100%; accent-color: var(--explorer-accent); } .extension-actions { display: flex; flex-wrap: wrap; gap: .6rem; }
  button { border: 1px solid var(--explorer-border); border-radius: 999px; padding: .55rem .9rem; background: var(--explorer-surface-raised); } button.primary { color: var(--explorer-background); background: var(--explorer-accent); } button.danger { color: var(--explorer-danger); }
  .extension-state { display: grid; min-height: 260px; place-items: center; padding: 2rem; text-align: center; } .extension-error { align-content: center; gap: .6rem; }
  @media (max-width: 700px) { .extension-page { padding: 1rem; } .extension-grid { grid-template-columns: 1fr; } .extension-wide { grid-column: auto; } }
</style>
