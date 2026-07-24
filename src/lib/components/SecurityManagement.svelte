<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import {
    createBannedSubnet,
    deleteBannedSubnet,
    listAuthLockouts,
    listBannedSubnets,
    serverErrorMessage,
    serverErrorStatus,
    unlockAuthLockouts,
    updateBannedSubnet,
    type AuthLockout,
    type AuthLockoutSelector,
    type BannedSubnet,
  } from '$lib/api';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { notificationStore } from '$lib/stores.svelte';
  import DialogActionButton from './DialogActionButton.svelte';
  import Icon from './Icon.svelte';
  import MdSwitch from './MdSwitch.svelte';
  import ModalFrame from './ModalFrame.svelte';
  import ProgressRing from './ProgressRing.svelte';

  let {
    canListSubnets,
    canManageSubnets,
    canListLockouts,
    canUnlockLockouts,
    refreshKey = 0,
  }: {
    canListSubnets: boolean;
    canManageSubnets: boolean;
    canListLockouts: boolean;
    canUnlockLockouts: boolean;
    refreshKey?: number;
  } = $props();

  let subnets = $state<BannedSubnet[]>([]);
  let lockouts = $state<AuthLockout[]>([]);
  let loadingSubnets = $state(false);
  let loadingLockouts = $state(false);
  let busyKey = $state<string | null>(null);
  let editorRule = $state<BannedSubnet | null | undefined>(undefined);
  let subnet = $state('');
  let reason = $state('');
  let startsAt = $state(toLocalInput(Date.now()));
  let expiryEnabled = $state(false);
  let expiresAt = $state(toLocalInput(Date.now() + 24 * 60 * 60 * 1000));
  let editorError = $state<string | null>(null);

  $effect(() => {
    refreshKey;
    void loadAll();
  });

  async function loadAll() {
    await Promise.all([loadSubnets(), loadLockouts()]);
  }

  async function loadSubnets() {
    if (!canListSubnets) {
      subnets = [];
      return;
    }
    loadingSubnets = true;
    try {
      subnets = await listBannedSubnets();
    } catch (error) {
      subnets = [];
      notificationStore.error(serverErrorMessage(error));
    } finally {
      loadingSubnets = false;
    }
  }

  async function loadLockouts() {
    if (!canListLockouts) {
      lockouts = [];
      return;
    }
    loadingLockouts = true;
    try {
      lockouts = await listAuthLockouts();
    } catch (error) {
      lockouts = [];
      notificationStore.error(serverErrorMessage(error));
    } finally {
      loadingLockouts = false;
    }
  }

  function openCreateRule() {
    editorRule = null;
    subnet = '';
    reason = '';
    startsAt = toLocalInput(Date.now());
    expiryEnabled = false;
    expiresAt = toLocalInput(Date.now() + 24 * 60 * 60 * 1000);
    editorError = null;
  }

  function openEditRule(rule: BannedSubnet) {
    editorRule = rule;
    subnet = rule.subnet;
    reason = rule.reason ?? '';
    startsAt = toLocalInput(rule.starts_at * 1000);
    expiryEnabled = rule.expires_at !== null;
    expiresAt = toLocalInput((rule.expires_at ?? Math.floor(Date.now() / 1000) + 86_400) * 1000);
    editorError = null;
  }

  function closeEditor() {
    if (busyKey === 'save-subnet') return;
    editorRule = undefined;
    editorError = null;
  }

  async function saveRule(confirmSelfBlock = false) {
    const normalizedSubnet = subnet.trim();
    if (!normalizedSubnet) {
      editorError = $t('manage.security.subnetRequired');
      return;
    }

    const startTimestamp = parseLocalInput(startsAt);
    const expiryTimestamp = expiryEnabled ? parseLocalInput(expiresAt) : null;
    if (startTimestamp === null) {
      editorError = $t('manage.security.invalidStart');
      return;
    }
    if (expiryEnabled && (expiryTimestamp === null || expiryTimestamp <= startTimestamp)) {
      editorError = $t('manage.security.invalidInterval');
      return;
    }

    busyKey = 'save-subnet';
    editorError = null;
    try {
      if (editorRule) {
        await updateBannedSubnet(
          editorRule.subnet,
          reason.trim() || null,
          startTimestamp,
          expiryTimestamp,
          confirmSelfBlock,
        );
        notificationStore.success($t('manage.security.ruleUpdated'));
      } else {
        await createBannedSubnet(
          normalizedSubnet,
          reason.trim() || null,
          startTimestamp,
          expiryTimestamp,
          confirmSelfBlock,
        );
        notificationStore.success($t('manage.security.ruleCreated'));
      }
      editorRule = undefined;
      await loadSubnets();
    } catch (error) {
      const errorMessage = serverErrorMessage(error);
      const isSelfBlockConflict = serverErrorStatus(error) === 409
        && errorMessage.toLocaleLowerCase().includes('current ip');
      if (isSelfBlockConflict && !confirmSelfBlock) {
        const confirmed = await dialogStore.confirm({
          title: $t('manage.security.selfBlockTitle'),
          message: $t('manage.security.selfBlockMessage'),
          confirmLabel: $t('manage.security.continueBlocking'),
          cancelLabel: $t('common.cancel'),
          danger: true,
        });
        if (confirmed) await saveRule(true);
      } else {
        editorError = errorMessage;
      }
    } finally {
      if (busyKey === 'save-subnet') busyKey = null;
    }
  }

  async function removeRule(rule: BannedSubnet) {
    const confirmed = await dialogStore.confirm({
      title: $t('manage.security.deleteRuleTitle'),
      message: $t('manage.security.deleteRuleMessage', { values: { subnet: rule.subnet } }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;

    busyKey = `delete:${rule.subnet}`;
    try {
      await deleteBannedSubnet(rule.subnet);
      notificationStore.success($t('manage.security.ruleDeleted'));
      await loadSubnets();
    } catch (error) {
      notificationStore.error(serverErrorMessage(error));
    } finally {
      busyKey = null;
    }
  }

  async function unlock(lockout: AuthLockout) {
    const reasonValue = await dialogStore.prompt({
      title: $t('manage.security.unlockTitle'),
      message: $t('manage.security.unlockReasonHelp'),
      placeholder: $t('manage.security.unlockReasonPlaceholder'),
      confirmLabel: $t('manage.security.unlockAction'),
      cancelLabel: $t('common.cancel'),
      multiline: true,
      maxLength: 1024,
    });
    const normalizedReason = reasonValue?.trim();
    if (reasonValue !== null && !normalizedReason) {
      notificationStore.warning($t('manage.security.unlockReasonRequired'));
    }
    if (!normalizedReason) return;

    const selector = lockoutSelector(lockout);
    if (!selector) {
      notificationStore.error($t('manage.security.invalidLockout'));
      return;
    }

    busyKey = `unlock:${lockoutKey(lockout)}`;
    try {
      const result = await unlockAuthLockouts([selector], normalizedReason);
      if (result.cleared.length > 0) {
        notificationStore.success($t('manage.security.lockoutCleared'));
      } else {
        notificationStore.info($t('manage.security.lockoutAlreadyEnded'));
      }
      await loadLockouts();
    } catch (error) {
      notificationStore.error(serverErrorMessage(error));
    } finally {
      busyKey = null;
    }
  }

  function lockoutSelector(lockout: AuthLockout): AuthLockoutSelector | null {
    if (lockout.scope === 'ip' && lockout.ip_address) {
      return { scope: 'ip', ip_address: lockout.ip_address };
    }
    if (lockout.scope === 'account' && lockout.username && lockout.factor) {
      return { scope: 'account', username: lockout.username, factor: lockout.factor };
    }
    if (lockout.scope === 'account_ip' && lockout.username && lockout.ip_address) {
      return { scope: 'account_ip', username: lockout.username, ip_address: lockout.ip_address };
    }
    return null;
  }

  function lockoutKey(lockout: AuthLockout) {
    return [lockout.scope, lockout.username, lockout.factor, lockout.ip_address].join(':');
  }

  function lockoutIdentity(lockout: AuthLockout) {
    if (lockout.scope === 'ip') return lockout.ip_address ?? '-';
    if (lockout.scope === 'account') {
      return `${lockout.username ?? '-'} · ${lockout.factor ?? '-'}`;
    }
    return `${lockout.username ?? '-'} · ${lockout.ip_address ?? '-'}`;
  }

  function formatTimestamp(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '-';
    return new Date(value * 1000).toLocaleString();
  }

  function toLocalInput(value: number) {
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function parseLocalInput(value: string): number | null {
    const milliseconds = new Date(value).getTime();
    return Number.isFinite(milliseconds) && milliseconds >= 0
      ? Math.floor(milliseconds / 1000)
      : null;
  }
</script>

<div class="security-workspace">
  <section class="security-section">
    <header class="section-header">
      <div class="section-heading">
        <span class="section-icon"><Icon name="security" size="21px" /></span>
        <div>
          <h2>{$t('manage.security.subnetRules')}</h2>
          <p>{$t('manage.security.subnetRulesDescription')}</p>
        </div>
      </div>
      {#if canManageSubnets}
        <button class="primary-pill" type="button" onclick={openCreateRule} disabled={busyKey !== null}>
          <Icon name="add" size="16px" />
          {$t('manage.security.addSubnet')}
        </button>
      {/if}
    </header>

    {#if !canListSubnets}
      <p class="empty-state">{$t('manage.missingPermission', { values: { permission: 'list_banned_subnets' } })}</p>
    {:else if loadingSubnets}
      <div class="loading-state"><ProgressRing size={18} strokeWidth={2.4} label={$t('common.loadingEllipsis')} /> {$t('common.loadingEllipsis')}</div>
    {:else if subnets.length === 0}
      <p class="empty-state">{$t('manage.security.noSubnetRules')}</p>
    {:else}
      <div class="record-list">
        {#each subnets as rule (rule.subnet)}
          <article class="security-record">
            <span class="record-leading"><Icon name={rule.status === 'active' ? 'block' : 'schedule'} size="20px" /></span>
            <div class="record-main">
              <div class="record-title-row">
                <strong>{rule.subnet}</strong>
                <span class="status-chip status-chip--{rule.status}">{$t(`manage.security.status.${rule.status}`)}</span>
              </div>
              <p class="record-reason">{rule.reason || $t('manage.security.noReason')}</p>
              <p class="record-meta">
                {$t('manage.security.rulePeriod', {
                  values: {
                    start: formatTimestamp(rule.starts_at),
                    end: rule.expires_at === null ? $t('manage.permanent') : formatTimestamp(rule.expires_at),
                  },
                })}
              </p>
            </div>
            {#if canManageSubnets}
              <div class="record-actions">
                <button type="button" title={$t('common.edit')} onclick={() => openEditRule(rule)} disabled={busyKey !== null}>
                  <Icon name="edit" size="18px" />
                </button>
                <button class="danger-action" type="button" title={$t('common.delete')} onclick={() => removeRule(rule)} disabled={busyKey !== null}>
                  <Icon name="delete" size="18px" />
                </button>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <section class="security-section">
    <header class="section-header">
      <div class="section-heading">
        <span class="section-icon"><Icon name="lock" size="21px" /></span>
        <div>
          <h2>{$t('manage.security.temporaryLockouts')}</h2>
          <p>{$t('manage.security.temporaryLockoutsDescription')}</p>
        </div>
      </div>
    </header>

    {#if !canListLockouts}
      <p class="empty-state">{$t('manage.missingPermission', { values: { permission: 'list_auth_lockouts' } })}</p>
    {:else if loadingLockouts}
      <div class="loading-state"><ProgressRing size={18} strokeWidth={2.4} label={$t('common.loadingEllipsis')} /> {$t('common.loadingEllipsis')}</div>
    {:else if lockouts.length === 0}
      <p class="empty-state">{$t('manage.security.noTemporaryLockouts')}</p>
    {:else}
      <div class="record-list">
        {#each lockouts as lockout (lockoutKey(lockout))}
          <article class="security-record">
            <span class="record-leading record-leading--warning"><Icon name="lockPerson" size="20px" /></span>
            <div class="record-main">
              <div class="record-title-row">
                <strong>{lockoutIdentity(lockout)}</strong>
                <span class="scope-chip">{$t(`manage.security.scope.${lockout.scope}`)}</span>
              </div>
              <p class="record-reason">
                {$t('manage.security.failedAttempts', { values: { count: lockout.failed_attempts } })}
              </p>
              <p class="record-meta">
                {$t('manage.security.lockedUntil', { values: { time: formatTimestamp(lockout.locked_until) } })}
              </p>
            </div>
            {#if canUnlockLockouts}
              <button class="unlock-button" type="button" onclick={() => unlock(lockout)} disabled={busyKey !== null}>
                <Icon name="lockOpen" size="17px" />
                {$t('manage.security.unlockAction')}
              </button>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>

{#if editorRule !== undefined}
  <ModalFrame
    title={editorRule ? $t('manage.security.editRuleTitle') : $t('manage.security.addRuleTitle')}
    maxWidth="max-w-xl"
    closeLabel={$t('common.close')}
    onClose={closeEditor}
  >
    <form class="editor-form" onsubmit={(event) => { event.preventDefault(); void saveRule(); }}>
      <label>
        <span>{$t('manage.security.subnetLabel')}</span>
        <input bind:value={subnet} disabled={Boolean(editorRule) || busyKey !== null} placeholder="192.0.2.0/24 · 2001:db8::/32" autocomplete="off" />
        <small>{$t('manage.security.subnetHelp')}</small>
      </label>
      <label>
        <span>{$t('manage.security.reasonLabel')}</span>
        <textarea bind:value={reason} disabled={busyKey !== null} maxlength="255" rows="3" placeholder={$t('manage.security.reasonPlaceholder')}></textarea>
      </label>
      <label>
        <span>{$t('manage.security.startsAt')}</span>
        <input bind:value={startsAt} disabled={busyKey !== null} type="datetime-local" />
      </label>
      <div class="expiry-panel">
        <div class="expiry-toggle">
          <MdSwitch bind:checked={expiryEnabled} disabled={busyKey !== null} ariaLabel={$t('manage.security.setEndTime')} />
          <div>
            <strong>{$t('manage.security.setEndTime')}</strong>
            <small>{$t('manage.security.endTimeHelp')}</small>
          </div>
        </div>
        {#if expiryEnabled}
          <label>
            <span>{$t('manage.security.expiresAt')}</span>
            <input bind:value={expiresAt} disabled={busyKey !== null} type="datetime-local" />
          </label>
        {/if}
      </div>

      {#if editorError}
        <div class="editor-error"><Icon name="errorFilled" size="17px" /><span>{editorError}</span></div>
      {/if}

      <footer>
        <DialogActionButton disabled={busyKey !== null} onclick={closeEditor}>{$t('common.cancel')}</DialogActionButton>
        <DialogActionButton type="submit" variant="primary" disabled={busyKey !== null}>
          {#if busyKey === 'save-subnet'}
            <ProgressRing size={16} strokeWidth={2.4} label={$t('common.saving')} />
            {$t('common.saving')}
          {:else}
            <Icon name="done" size="16px" />
            {$t('common.save')}
          {/if}
        </DialogActionButton>
      </footer>
    </form>
  </ModalFrame>
{/if}

<style>
  .security-workspace { display: grid; gap: 1rem; padding: 1rem; }
  .security-section { overflow: hidden; border: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent); border-radius: 0.75rem; background: color-mix(in srgb, var(--color-md3-surface-container-high) 34%, transparent); }
  .section-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 58%, transparent); padding: 0.9rem 1rem; }
  .section-heading { display: flex; min-width: 0; align-items: center; gap: 0.75rem; }
  .section-heading h2 { color: var(--color-md3-on-surface); font: 650 0.9rem/1.3 var(--font-md3-sans); }
  .section-heading p { margin-top: 0.12rem; color: var(--color-md3-on-surface-variant); font: 400 0.72rem/1.45 var(--font-md3-sans); }
  .section-icon, .record-leading { display: grid; width: 2.25rem; height: 2.25rem; flex: none; place-items: center; border-radius: 0.65rem; color: var(--color-md3-primary); background: var(--color-md3-primary-container); }
  .primary-pill { display: inline-flex; min-height: 2rem; flex: none; align-items: center; gap: 0.35rem; border-radius: 999px; padding: 0.3rem 0.8rem; color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); font: 600 0.72rem/1 var(--font-md3-sans); transition: filter 120ms ease, transform 120ms ease; }
  .primary-pill:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
  button:disabled { cursor: not-allowed; opacity: 0.46; }
  .record-list { display: grid; }
  .security-record { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; padding: 0.85rem 1rem; transition: background-color 140ms ease; }
  .security-record + .security-record { border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 48%, transparent); }
  .security-record:hover { background: color-mix(in srgb, var(--color-md3-primary-container) 13%, transparent); }
  .record-leading { width: 2.1rem; height: 2.1rem; }
  .record-leading--warning { color: var(--color-md3-error); background: var(--color-md3-error-container); }
  .record-main { min-width: 0; }
  .record-title-row { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 0.45rem; }
  .record-title-row strong { overflow-wrap: anywhere; color: var(--color-md3-on-surface); font: 600 0.82rem/1.4 var(--font-md3-sans); }
  .record-reason, .record-meta { margin-top: 0.16rem; overflow-wrap: anywhere; color: var(--color-md3-on-surface-variant); font: 400 0.7rem/1.45 var(--font-md3-sans); }
  .record-meta { opacity: 0.82; }
  .status-chip, .scope-chip { border-radius: 999px; padding: 0.16rem 0.48rem; color: var(--color-md3-on-surface-variant); background: var(--color-md3-surface-container-highest); font: 600 0.62rem/1.2 var(--font-md3-sans); }
  .status-chip--active { color: var(--color-md3-on-error-container); background: var(--color-md3-error-container); }
  .status-chip--scheduled { color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); }
  .record-actions { display: flex; gap: 0.15rem; }
  .record-actions button { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: 999px; color: var(--color-md3-on-surface-variant); transition: color 120ms ease, background-color 120ms ease; }
  .record-actions button:hover:not(:disabled) { color: var(--color-md3-primary); background: var(--color-md3-primary-container); }
  .record-actions .danger-action:hover:not(:disabled) { color: var(--color-md3-error); background: var(--color-md3-error-container); }
  .unlock-button { display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid var(--color-md3-outline); border-radius: 999px; padding: 0.34rem 0.7rem; color: var(--color-md3-on-surface-variant); font: 600 0.7rem/1 var(--font-md3-sans); transition: color 120ms ease, background-color 120ms ease; }
  .unlock-button:hover:not(:disabled) { color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); }
  .empty-state, .loading-state { padding: 2rem 1rem; text-align: center; color: var(--color-md3-on-surface-variant); font: 400 0.78rem/1.5 var(--font-md3-sans); }
  .loading-state { display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
  .editor-form { display: grid; gap: 1rem; padding: 1.25rem; }
  .editor-form label { display: grid; gap: 0.38rem; color: var(--color-md3-on-surface); font: 500 0.78rem/1.4 var(--font-md3-sans); }
  .editor-form input, .editor-form textarea { width: 100%; border: 1px solid var(--color-md3-outline); border-radius: 0.55rem; padding: 0.62rem 0.72rem; color: var(--color-md3-on-surface); background: var(--color-md3-field); font: 400 0.78rem/1.4 var(--font-md3-sans); outline: none; transition: border-color 120ms ease, box-shadow 120ms ease; }
  .editor-form input:focus, .editor-form textarea:focus { border-color: var(--color-md3-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-md3-primary) 22%, transparent); }
  .editor-form textarea { resize: vertical; }
  .editor-form small { color: var(--color-md3-on-surface-variant); font-size: 0.68rem; font-weight: 400; }
  .expiry-panel { display: grid; gap: 0.85rem; border: 1px solid color-mix(in srgb, var(--color-md3-outline) 70%, transparent); border-radius: 0.65rem; padding: 0.8rem; }
  .expiry-toggle { display: flex; align-items: flex-start; gap: 0.7rem; }
  .expiry-toggle strong, .expiry-toggle small { display: block; }
  .expiry-toggle strong { color: var(--color-md3-on-surface); font: 600 0.78rem/1.4 var(--font-md3-sans); }
  .editor-error { display: flex; align-items: flex-start; gap: 0.5rem; border: 1px solid color-mix(in srgb, var(--color-md3-error) 40%, transparent); border-radius: 0.6rem; padding: 0.7rem; color: var(--color-md3-on-error-container); background: color-mix(in srgb, var(--color-md3-error-container) 45%, transparent); font: 400 0.75rem/1.45 var(--font-md3-sans); }
  .editor-form footer { display: flex; justify-content: flex-end; gap: 0.5rem; border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 60%, transparent); padding-top: 1rem; }
  @media (max-width: 640px) {
    .security-workspace { padding: 0.75rem; }
    .section-header { align-items: flex-start; }
    .security-record { grid-template-columns: auto minmax(0, 1fr); }
    .record-actions, .unlock-button { grid-column: 2; justify-self: end; }
    .section-heading p { display: none; }
  }
</style>
