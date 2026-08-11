<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { sendDeveloperRequest, type JsonValue, type ServerResponse } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';

  const HISTORY_LIMIT = 30;

  type RequestStatus = 'pending' | 'response' | 'error';

  interface RequestHistoryEntry {
    id: string;
    action: string;
    payload: JsonValue;
    payloadText: string;
    requestedAt: number;
    durationMs: number | null;
    status: RequestStatus;
    response: ServerResponse<JsonValue> | null;
    error: string | null;
  }

  let {
    open,
    onClose,
    serverAddress,
    username,
    scopeKey,
  }: {
    open: boolean;
    onClose: () => void;
    serverAddress: string;
    username: string;
    scopeKey: string;
  } = $props();

  let action = $state('');
  let payloadText = $state('{}');
  let actionError = $state<string | null>(null);
  let payloadError = $state<string | null>(null);
  let busy = $state(false);
  let history = $state<RequestHistoryEntry[]>([]);
  let selectedId = $state<string | null>(null);
  let activeScopeKey = $state('');
  let requestSequence = 0;
  let announcement = $state('');
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');

  const selectedEntry = $derived(
    history.find((entry) => entry.id === selectedId) ?? null,
  );

  $effect(() => {
    if (scopeKey === activeScopeKey) return;
    activeScopeKey = scopeKey;
    resetSession();
  });

  function resetSession() {
    action = '';
    payloadText = '{}';
    actionError = null;
    payloadError = null;
    busy = false;
    history = [];
    selectedId = null;
    announcement = '';
    copyState = 'idle';
  }

  function parsePayload(): JsonValue | null {
    try {
      const parsed = JSON.parse(payloadText) as JsonValue;
      payloadError = null;
      return parsed;
    } catch (error) {
      payloadError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  function validateAction() {
    if (action.trim()) {
      actionError = null;
      return true;
    }
    actionError = $t('developerConsole.businessRequired');
    return false;
  }

  function formatPayload() {
    const parsed = parsePayload();
    if (parsed === null && payloadText.trim() !== 'null') return;
    payloadText = JSON.stringify(parsed, null, 2);
  }

  async function submitRequest() {
    if (busy) return;
    const actionValid = validateAction();
    const parsed = parsePayload();
    if (!actionValid || (parsed === null && payloadText.trim() !== 'null')) return;

    const normalizedAction = action.trim();
    const requestScopeKey = scopeKey;
    const entry: RequestHistoryEntry = {
      id: `${Date.now()}-${requestSequence++}`,
      action: normalizedAction,
      payload: parsed,
      payloadText,
      requestedAt: Date.now(),
      durationMs: null,
      status: 'pending',
      response: null,
      error: null,
    };

    history = [entry, ...history].slice(0, HISTORY_LIMIT);
    selectedId = entry.id;
    busy = true;
    copyState = 'idle';
    announcement = $t('developerConsole.sendingAnnouncement', {
      values: { action: normalizedAction },
    });

    try {
      const response = await sendDeveloperRequest(normalizedAction, parsed);
      if (scopeKey !== requestScopeKey) return;
      updateHistoryEntry(entry.id, {
        status: 'response',
        response,
        durationMs: Date.now() - entry.requestedAt,
      });
      announcement = $t('developerConsole.responseAnnouncement', {
        values: { action: normalizedAction, code: response.code },
      });
    } catch (error) {
      if (scopeKey !== requestScopeKey) return;
      const message = error instanceof Error ? error.message : String(error);
      updateHistoryEntry(entry.id, {
        status: 'error',
        error: message,
        durationMs: Date.now() - entry.requestedAt,
      });
      announcement = $t('developerConsole.errorAnnouncement', {
        values: { action: normalizedAction },
      });
    } finally {
      if (scopeKey === requestScopeKey) busy = false;
    }
  }

  function updateHistoryEntry(
    id: string,
    changes: Partial<Pick<RequestHistoryEntry, 'status' | 'response' | 'error' | 'durationMs'>>,
  ) {
    history = history.map((entry) => entry.id === id ? { ...entry, ...changes } : entry);
  }

  function selectHistoryEntry(entry: RequestHistoryEntry) {
    selectedId = entry.id;
    action = entry.action;
    payloadText = entry.payloadText;
    actionError = null;
    payloadError = null;
    copyState = 'idle';
  }

  function clearHistory() {
    history = [];
    selectedId = null;
    copyState = 'idle';
    announcement = $t('developerConsole.historyCleared');
  }

  function resultText(entry: RequestHistoryEntry) {
    if (entry.response) return JSON.stringify(entry.response, null, 2);
    if (entry.error) return entry.error;
    return '';
  }

  async function copyResult() {
    if (!selectedEntry || selectedEntry.status === 'pending') return;
    const text = resultText(selectedEntry);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      copyState = 'copied';
      announcement = $t('developerConsole.resultCopied');
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy command failed');
        copyState = 'copied';
        announcement = $t('developerConsole.resultCopied');
      } catch {
        copyState = 'failed';
        announcement = $t('developerConsole.copyFailed');
      }
    }
  }

  function statusTone(entry: RequestHistoryEntry) {
    if (entry.status === 'pending') return 'pending';
    if (entry.status === 'error') return 'error';
    const code = entry.response?.code ?? 0;
    if (code >= 200 && code < 300) return 'success';
    if (code >= 400) return 'error';
    return 'warning';
  }

  function statusLabel(entry: RequestHistoryEntry) {
    if (entry.status === 'pending') return $t('developerConsole.pending');
    if (entry.status === 'error') return $t('developerConsole.clientError');
    return String(entry.response?.code ?? '—');
  }

  function formatDuration(durationMs: number | null) {
    if (durationMs === null) return '—';
    if (durationMs < 1000) return `${durationMs} ms`;
    return `${(durationMs / 1000).toFixed(2)} s`;
  }

  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
</script>

{#if open}
  <ModalFrame
    title={$t('developerConsole.title')}
    maxWidth="max-w-6xl"
    resizable
    maximizable
    minWidth={720}
    minHeight={480}
    closeLabel={$t('common.close')}
    onClose={onClose}
  >
    <div class="developer-console">
      <div class="risk-strip" role="note">
        <Icon name="warning" size="19px" />
        <div>
          <strong>{$t('developerConsole.riskTitle')}</strong>
          <p>{$t('developerConsole.riskBody', { values: { server: serverAddress, username } })}</p>
        </div>
      </div>

      <div class="console-body">
        <aside class="history-pane" aria-label={$t('developerConsole.history')}>
          <div class="pane-heading">
            <div>
              <span class="pane-kicker">{$t('developerConsole.session')}</span>
              <h3>{$t('developerConsole.history')}</h3>
            </div>
            <button
              type="button"
              class="icon-action"
              aria-label={$t('developerConsole.clearHistory')}
              title={$t('developerConsole.clearHistory')}
              disabled={history.length === 0}
              onclick={clearHistory}
            >
              <Icon name="deleteSweep" size="18px" />
            </button>
          </div>

          {#if history.length === 0}
            <div class="history-empty">
              <Icon name="history" size="24px" />
              <p>{$t('developerConsole.emptyHistory')}</p>
            </div>
          {:else}
            <div class="history-list">
              {#each history as entry (entry.id)}
                <button
                  type="button"
                  class="history-entry"
                  class:selected={entry.id === selectedId}
                  aria-current={entry.id === selectedId ? 'true' : undefined}
                  onclick={() => selectHistoryEntry(entry)}
                >
                  <span class="history-entry__topline">
                    <strong>{entry.action}</strong>
                    <span class="status-code" data-tone={statusTone(entry)}>{statusLabel(entry)}</span>
                  </span>
                  <span class="history-entry__meta">
                    <time datetime={new Date(entry.requestedAt).toISOString()}>{formatTime(entry.requestedAt)}</time>
                    <span>{formatDuration(entry.durationMs)}</span>
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </aside>

        <div class="workbench">
          <form class="request-editor" aria-label={$t('developerConsole.request')} onsubmit={(event) => { event.preventDefault(); void submitRequest(); }}>
            <div class="section-heading">
              <div>
                <span class="pane-kicker">{$t('developerConsole.request')}</span>
                <h3>{$t('developerConsole.compose')}</h3>
              </div>
              <span class="shortcut-hint">Ctrl+Enter</span>
            </div>

            <label class="field-group">
              <span>{$t('developerConsole.businessName')}</span>
              <input
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="get_document"
                aria-invalid={actionError ? 'true' : undefined}
                aria-describedby={actionError ? 'developer-business-error' : undefined}
                bind:value={action}
                oninput={() => { if (actionError) validateAction(); }}
              />
            </label>
            {#if actionError}
              <p id="developer-business-error" class="field-error">{actionError}</p>
            {/if}

            <div class="payload-heading">
              <label for="developer-payload">{$t('developerConsole.payload')}</label>
              <button type="button" class="text-action" onclick={formatPayload}>
                <Icon name="code" size="16px" />
                {$t('developerConsole.formatJson')}
              </button>
            </div>
            <textarea
              id="developer-payload"
              class="payload-editor allow-native-context-menu"
              spellcheck="false"
              autocapitalize="off"
              aria-invalid={payloadError ? 'true' : undefined}
              aria-describedby={payloadError ? 'developer-payload-error' : undefined}
              bind:value={payloadText}
              onblur={() => { parsePayload(); }}
            ></textarea>
            {#if payloadError}
              <p id="developer-payload-error" class="field-error">{$t('developerConsole.invalidJson', { values: { error: payloadError } })}</p>
            {/if}

            <div class="request-actions">
              <p>{$t('developerConsole.sendHint')}</p>
              <button type="submit" class="send-action" disabled={busy}>
                <Icon name={busy ? 'refresh' : 'resume'} size="18px" />
                {busy ? $t('developerConsole.sending') : $t('developerConsole.send')}
              </button>
            </div>
          </form>

          <section class="result-pane" aria-labelledby="developer-result-title" aria-busy={selectedEntry?.status === 'pending'}>
            <div class="section-heading result-heading">
              <div>
                <span class="pane-kicker">{$t('developerConsole.response')}</span>
                <h3 id="developer-result-title">
                  {selectedEntry ? selectedEntry.action : $t('developerConsole.noResultTitle')}
                </h3>
              </div>
              <div class="result-actions">
                {#if selectedEntry}
                  <span class="result-duration">{formatDuration(selectedEntry.durationMs)}</span>
                {/if}
                <button
                  type="button"
                  class="text-action"
                  disabled={!selectedEntry || selectedEntry.status === 'pending'}
                  onclick={() => { void copyResult(); }}
                >
                  <Icon name={copyState === 'copied' ? 'done' : 'filePresent'} size="16px" />
                  {copyState === 'copied' ? $t('developerConsole.copied') : $t('developerConsole.copyResult')}
                </button>
              </div>
            </div>

            {#if !selectedEntry}
              <div class="result-content">
                <div class="result-empty">
                  <Icon name="code" size="28px" />
                  <p>{$t('developerConsole.noResult')}</p>
                </div>
              </div>
            {:else if selectedEntry.status === 'pending'}
              <div class="result-content">
                <div class="result-empty result-pending">
                  <Icon name="refresh" size="28px" />
                  <p>{$t('developerConsole.waitingResponse')}</p>
                </div>
              </div>
            {:else}
              <div class="result-content result-content--data">
                <div class="result-summary">
                  <span class="status-code" data-tone={statusTone(selectedEntry)}>{statusLabel(selectedEntry)}</span>
                  <span>{selectedEntry.response ? selectedEntry.response.message : $t('developerConsole.transportFailure')}</span>
                </div>
                <textarea
                  class="response-output allow-native-context-menu"
                  class:error-result={selectedEntry.status === 'error'}
                  readonly
                  wrap={selectedEntry.status === 'error' ? 'soft' : 'off'}
                  aria-label={$t('developerConsole.responseContent')}
                  value={resultText(selectedEntry)}
                ></textarea>
              </div>
            {/if}
          </section>
        </div>
      </div>

      <p class="sr-only" aria-live="polite">{announcement}</p>
    </div>
  </ModalFrame>
{/if}

<style>
  .developer-console {
    display: grid;
    /* Account for ModalFrame's inset, header, border, and subpixel rounding. */
    height: min(calc(100dvh - 5.5rem), 46rem);
    min-height: min(30rem, calc(100dvh - 5.5rem));
    grid-template-rows: auto minmax(0, 1fr);
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container);
  }

  .risk-strip {
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-warning) 38%, var(--color-md3-outline));
    padding: 0.72rem 1rem;
    color: var(--color-md3-warning);
    background: color-mix(in srgb, var(--color-md3-warning) 10%, var(--color-md3-surface-container-high));
  }

  .risk-strip strong,
  .risk-strip p {
    margin: 0;
  }

  .risk-strip strong {
    font-size: 0.79rem;
    font-weight: 700;
  }

  .risk-strip p {
    margin-top: 0.14rem;
    color: color-mix(in srgb, var(--color-md3-warning) 78%, var(--color-md3-on-surface));
    font-size: 0.74rem;
    line-height: 1.45;
  }

  .console-body {
    display: grid;
    min-height: 0;
    grid-template-columns: 14rem minmax(0, 1fr);
  }

  .history-pane {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    border-right: 1px solid var(--color-md3-outline);
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 38%, transparent);
  }

  .pane-heading,
  .section-heading,
  .payload-heading,
  .request-actions,
  .result-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .pane-heading {
    min-height: 3.75rem;
    border-bottom: 1px solid var(--color-md3-outline);
    padding: 0.7rem 0.8rem 0.65rem 1rem;
  }

  .pane-kicker {
    display: block;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.65rem;
    font-weight: 650;
    line-height: 1.2;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h3 {
    margin: 0.16rem 0 0;
    color: var(--color-md3-on-surface);
    font-size: 0.88rem;
    font-weight: 680;
    line-height: 1.3;
  }

  button {
    font-family: var(--font-md3-sans);
  }

  .icon-action,
  .text-action,
  .send-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 5px);
    transition:
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .icon-action {
    width: 32px;
    height: 32px;
    color: var(--color-md3-on-surface-variant);
    background: transparent;
  }

  .icon-action:hover:not(:disabled),
  .text-action:hover:not(:disabled) {
    border-color: var(--color-md3-outline);
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-highest);
  }

  .icon-action:active:not(:disabled),
  .text-action:active:not(:disabled),
  .send-action:active:not(:disabled) {
    transform: scale(0.96);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .history-list {
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
  }

  .history-entry {
    display: grid;
    width: 100%;
    gap: 0.38rem;
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
    padding: 0.7rem 0.85rem 0.68rem 1rem;
    color: var(--color-md3-on-surface);
    background: transparent;
    text-align: left;
    transition: background-color var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .history-entry:hover {
    background: var(--color-md3-surface-container-highest);
  }

  .history-entry.selected {
    background: var(--color-md3-primary-container);
    box-shadow: inset 3px 0 0 var(--color-md3-primary);
  }

  .history-entry__topline,
  .history-entry__meta {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
  }

  .history-entry__topline strong {
    overflow: hidden;
    font: 550 0.76rem/1.35 var(--font-md3-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-entry__meta {
    color: var(--color-md3-on-surface-variant);
    font: 0.66rem/1.3 var(--font-md3-mono);
  }

  .status-code {
    display: inline-flex;
    min-width: 2.6rem;
    min-height: 1.35rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    padding: 0.1rem 0.4rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-highest);
    font: 650 0.65rem/1 var(--font-md3-mono);
  }

  .status-code[data-tone='success'] {
    color: var(--color-md3-success);
    background: color-mix(in srgb, var(--color-md3-success) 13%, transparent);
  }

  .status-code[data-tone='warning'],
  .status-code[data-tone='pending'] {
    color: var(--color-md3-warning);
    background: color-mix(in srgb, var(--color-md3-warning) 12%, transparent);
  }

  .status-code[data-tone='error'] {
    color: var(--color-md3-error);
    background: var(--color-md3-error-container);
  }

  .history-empty,
  .result-empty {
    display: grid;
    min-height: 0;
    place-content: center;
    justify-items: center;
    gap: 0.6rem;
    padding: 1.2rem;
    color: var(--color-md3-on-surface-variant);
    text-align: center;
  }

  .history-empty p,
  .result-empty p {
    max-width: 30ch;
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .workbench {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-rows: minmax(19rem, 3fr) minmax(10.5rem, 2fr);
  }

  .request-editor {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 0.55rem;
    overflow: auto;
    border-bottom: 1px solid var(--color-md3-outline);
    padding: 1rem 1.1rem;
    scrollbar-gutter: stable;
  }

  .section-heading {
    margin-bottom: 0.15rem;
  }

  .shortcut-hint,
  .result-duration {
    color: var(--color-md3-on-surface-variant);
    font: 0.67rem/1.3 var(--font-md3-mono);
  }

  .field-group {
    display: grid;
    gap: 0.3rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.71rem;
    font-weight: 620;
  }

  .field-group input,
  .payload-editor {
    width: 100%;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    color: var(--color-md3-on-surface);
    background: var(--color-md3-field);
    font-family: var(--font-md3-mono);
  }

  .field-group input {
    height: 2.5rem;
    padding: 0 0.75rem;
    font-size: 0.78rem;
  }

  .payload-heading {
    margin-top: 0.18rem;
  }

  .payload-heading label {
    color: var(--color-md3-on-surface-variant);
    font-size: 0.71rem;
    font-weight: 620;
  }

  .text-action {
    min-height: 1.85rem;
    gap: 0.34rem;
    padding: 0.25rem 0.48rem;
    color: var(--color-md3-on-surface-variant);
    background: transparent;
    font-size: 0.7rem;
    font-weight: 620;
  }

  .payload-editor {
    min-height: 5.25rem;
    max-height: 14rem;
    flex: 1 1 8.5rem;
    resize: vertical;
    padding: 0.65rem 0.75rem;
    font-size: 0.75rem;
    line-height: 1.5;
    tab-size: 2;
  }

  [aria-invalid='true'] {
    border-color: var(--color-md3-error) !important;
  }

  .field-error {
    margin: -0.12rem 0 0;
    color: var(--color-md3-error);
    font-size: 0.69rem;
    line-height: 1.4;
  }

  .request-actions {
    align-items: flex-end;
    margin-top: 0.2rem;
  }

  .request-actions p {
    max-width: 56ch;
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.68rem;
    line-height: 1.45;
  }

  .send-action {
    min-width: 6.5rem;
    min-height: 2rem;
    gap: 0.4rem;
    padding: 0.35rem 0.78rem;
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .send-action :global(.material-symbols-outlined) {
    font-variation-settings: 'FILL' 1;
  }

  .send-action:disabled :global(.material-symbols-outlined),
  .result-pending :global(.material-symbols-outlined) {
    animation: developer-console-spin 1.1s linear infinite;
  }

  .result-pane {
    display: grid;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    background: color-mix(in srgb, var(--color-md3-surface) 45%, transparent);
  }

  .result-content {
    display: grid;
    min-height: 0;
  }

  .result-content--data {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .result-heading {
    min-height: 3.55rem;
    border-bottom: 1px solid var(--color-md3-outline);
    padding: 0.65rem 1.1rem;
  }

  .result-heading h3 {
    overflow: hidden;
    max-width: 42ch;
    font-family: var(--font-md3-mono);
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .result-summary {
    justify-content: flex-start;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 70%, transparent);
    padding: 0.52rem 1.1rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
  }

  .response-output {
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    resize: none;
    border: 0;
    border-radius: 0;
    margin: 0;
    padding: 0.9rem 1.1rem 1.2rem;
    color: var(--color-md3-on-surface);
    background: transparent;
    font: 0.74rem/1.55 var(--font-md3-mono);
    tab-size: 2;
    white-space: pre;
  }

  .response-output.error-result {
    color: var(--color-md3-error);
    white-space: pre-wrap;
  }

  @keyframes developer-console-spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 760px) {
    .developer-console {
      height: min(calc(100dvh - 5.5rem), 46rem);
      min-height: min(32rem, calc(100dvh - 5.5rem));
    }

    .console-body {
      overflow: auto;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 9.5rem auto;
    }

    .history-pane {
      grid-template-columns: 10rem minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      border-right: 0;
      border-bottom: 1px solid var(--color-md3-outline);
    }

    .pane-heading {
      border-right: 1px solid var(--color-md3-outline);
      border-bottom: 0;
    }

    .history-list {
      display: flex;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .history-entry {
      width: 12rem;
      min-width: 12rem;
      border-right: 1px solid var(--color-md3-outline);
      border-bottom: 0;
    }

    .history-entry.selected {
      box-shadow: inset 0 3px 0 var(--color-md3-primary);
    }

    .history-empty {
      border-left: 0;
    }

    .workbench {
      min-height: 29.5rem;
      grid-template-rows: 19rem 10.5rem;
    }
  }

  @media (max-width: 520px) {
    .risk-strip {
      padding-inline: 0.8rem;
    }

    .history-pane {
      grid-template-columns: 8rem minmax(0, 1fr);
    }

    .request-editor,
    .result-heading,
    .result-summary,
    .response-output {
      padding-inline: 0.8rem;
    }

    .request-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .send-action {
      width: 100%;
      min-height: 2.5rem;
    }
  }
</style>
