<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    createBannedSubnet,
    deleteBannedSubnet,
    listAuthLockouts,
    listBannedSubnets,
    serverErrorStatus,
    unlockAuthLockouts,
    updateBannedSubnet,
    type AuthLockout,
    type AuthLockoutSelector,
    type BannedSubnet,
  } from '$lib/api';
  import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

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

  type SecurityView = 'overview' | 'subnets' | 'lockouts';

  let activeView = $state<SecurityView>('overview');
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
    if (activeView === 'subnets') void loadSubnets();
    if (activeView === 'lockouts') void loadLockouts();
  });

  function openView(view: Exclude<SecurityView, 'overview'>) {
    activeView = view;
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
      notificationStore.error(formatUserFacingError(error));
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
      notificationStore.error(formatUserFacingError(error));
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
          reason || null,
          startTimestamp,
          expiryTimestamp,
          confirmSelfBlock,
        );
        notificationStore.success($t('manage.security.ruleUpdated'));
      } else {
        await createBannedSubnet(
          normalizedSubnet,
          reason || null,
          startTimestamp,
          expiryTimestamp,
          confirmSelfBlock,
        );
        notificationStore.success($t('manage.security.ruleCreated'));
      }
      editorRule = undefined;
      await loadSubnets();
    } catch (error) {
      const errorMessage = formatUserFacingError(error);
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
      notificationStore.error(formatUserFacingError(error));
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
      notificationStore.error(formatUserFacingError(error));
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
  const outlinedId = $props.id();
</script>

<div class="security-workspace">
  {#if activeView === 'overview'}
    <div class="security-entries" aria-label={$t('manage.security.title')}>
      <button data-fluent-owner="lib-components-security-management" class="security-entry" type="button" disabled={!canListSubnets} onclick={() => openView('subnets')}>
        <span class="section-icon"><Icon name="security" size="22px" /></span>
        <span class="entry-copy">
          <strong>{$t('manage.security.subnetRules')}</strong>
          <span>{$t('manage.security.subnetRulesDescription')}</span>
          {#if !canListSubnets}<small>{$t('manage.missingPermission', { values: { permission: 'list_banned_subnets' } })}</small>{/if}
        </span>
        <Icon name="breadcrumbSep" size="20px" />
      </button>
      <button data-fluent-owner="lib-components-security-management" class="security-entry" type="button" disabled={!canListLockouts} onclick={() => openView('lockouts')}>
        <span class="section-icon"><Icon name="lock" size="22px" /></span>
        <span class="entry-copy">
          <strong>{$t('manage.security.temporaryLockouts')}</strong>
          <span>{$t('manage.security.temporaryLockoutsDescription')}</span>
          {#if !canListLockouts}<small>{$t('manage.missingPermission', { values: { permission: 'list_auth_lockouts' } })}</small>{/if}
        </span>
        <Icon name="breadcrumbSep" size="20px" />
      </button>
    </div>
  {:else}
    <section class="security-section">
      <header class="section-header">
        <FluentButton data-fluent-owner="lib-components-security-management"
          type="button"
          aria-label={$t('common.back')}
          onclick={() => (activeView = 'overview')}
          appearance="subtle"
          class="back-button"
          iconOnly
        >
          <Icon name="arrowBack" size="20px" />
        </FluentButton>
        <div class="section-heading">
          <div>
            <h2>{activeView === 'subnets' ? $t('manage.security.subnetRules') : $t('manage.security.temporaryLockouts')}</h2>
            <p>{activeView === 'subnets' ? $t('manage.security.subnetRulesDescription') : $t('manage.security.temporaryLockoutsDescription')}</p>
          </div>
        </div>
        {#if activeView === 'subnets' && canManageSubnets}
          <FluentButton data-fluent-owner="lib-components-security-management"
            type="button"
            onclick={openCreateRule}
            disabled={busyKey !== null}
            appearance="subtle"
            class="primary-pill"
          >
            <Icon name="add" size="16px" />
            {$t('manage.security.addSubnet')}
          </FluentButton>
        {/if}
      </header>

      {#if activeView === 'subnets'}
        {#if loadingSubnets}
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
                  <p class="record-meta">{$t('manage.security.rulePeriod', { values: { start: formatTimestamp(rule.starts_at), end: rule.expires_at === null ? $t('manage.permanent') : formatTimestamp(rule.expires_at) } })}</p>
                </div>
                {#if canManageSubnets}
                  <div class="record-actions">
                    <FluentButton data-fluent-owner="lib-components-security-management"
                      type="button"
                      title={$t('common.edit')}
                      onclick={() => openEditRule(rule)}
                      disabled={busyKey !== null}
                      appearance="subtle"
                      iconOnly
                      aria-label={$t('common.edit')}
                    ><Icon name="edit" size="18px" /></FluentButton>
                    <FluentButton data-fluent-owner="lib-components-security-management"
                      type="button"
                      title={$t('common.delete')}
                      onclick={() => removeRule(rule)}
                      disabled={busyKey !== null}
                      appearance="subtle"
                      tone="danger"
                      class="danger-action"
                      iconOnly
                      aria-label={$t('common.delete')}
                    ><Icon name="delete" size="18px" /></FluentButton>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
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
                <p class="record-reason">{$t('manage.security.failedAttempts', { values: { count: lockout.failed_attempts } })}</p>
                <p class="record-meta">{$t('manage.security.lockedUntil', { values: { time: formatTimestamp(lockout.locked_until) } })}</p>
              </div>
              {#if canUnlockLockouts}
                <FluentButton data-fluent-owner="lib-components-security-management"
                  type="button"
                  onclick={() => unlock(lockout)}
                  disabled={busyKey !== null}
                  appearance="subtle"
                  class="unlock-button"
                ><Icon name="lockOpen" size="17px" />{$t('manage.security.unlockAction')}</FluentButton>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

{#if editorRule !== undefined}
  <ModalFrame
    title={editorRule ? $t('manage.security.editRuleTitle') : $t('manage.security.addRuleTitle')}
    maxWidth="max-w-xl"
    closeLabel={$t('common.close')}
    onClose={closeEditor}
  >
    <form class="editor-form" onsubmit={(event) => { event.preventDefault(); void saveRule(); }}>
      <div>
        <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('manage.security.subnetLabel')} disabled={Boolean(editorRule) || busyKey !== null}>
          <input id={`${outlinedId}-1`} data-focus-ring="delegated" class="cfms-native-field" bind:value={subnet} disabled={Boolean(editorRule) || busyKey !== null} placeholder="192.0.2.0/24 · 2001:db8::/32" autocomplete="off" />
        </MdOutlinedField>
        <small>{$t('manage.security.subnetHelp')}</small>
      </div>
      <div>
        <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('manage.security.reasonLabel')} disabled={busyKey !== null}>
          <textarea id={`${outlinedId}-2`} data-focus-ring="delegated" class="cfms-native-field" bind:value={reason} disabled={busyKey !== null} maxlength="1024" rows="3" placeholder={$t('manage.security.reasonPlaceholder')}></textarea>
        </MdOutlinedField>
      </div>
      <div>
        <MdOutlinedField inputId={`${outlinedId}-3`} label={$t('manage.security.startsAt')} disabled={busyKey !== null}>
          <input id={`${outlinedId}-3`} data-focus-ring="delegated" class="cfms-native-field" bind:value={startsAt} disabled={busyKey !== null} type="datetime-local" />
        </MdOutlinedField>
      </div>
      <div class="expiry-panel">
        <div class="expiry-toggle">
          <MdSwitch bind:checked={expiryEnabled} disabled={busyKey !== null} ariaLabel={$t('manage.security.setEndTime')} />
          <div>
            <strong>{$t('manage.security.setEndTime')}</strong>
            <small>{$t('manage.security.endTimeHelp')}</small>
          </div>
        </div>
        {#if expiryEnabled}
          <div>
            <MdOutlinedField inputId={`${outlinedId}-4`} label={$t('manage.security.expiresAt')} disabled={busyKey !== null}>
              <input id={`${outlinedId}-4`} data-focus-ring="delegated" class="cfms-native-field" bind:value={expiresAt} disabled={busyKey !== null} type="datetime-local" />
            </MdOutlinedField>
          </div>
        {/if}
      </div>

      {#if editorError}
        <div class="editor-error"><span class="cfms-icon-text__icon"><Icon name="errorFilled" size="17px" /></span><span>{editorError}</span></div>
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
  .security-workspace { min-height: 22rem; }
  .security-entries { border-block: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent); }
  .security-entry { display: grid; width: 100%; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 1.1rem 1rem; text-align: left; transition: background-color 140ms ease; }
  .security-entry + .security-entry { border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 52%, transparent); }
  .security-entry:hover:not(:is(:disabled, [disabled])) { background: color-mix(in srgb, var(--color-md3-primary-container) 13%, transparent); }
  .entry-copy { display: grid; min-width: 0; gap: 4px; }
  .entry-copy strong { color: var(--color-md3-on-surface); font: 600 14px/20px var(--font-md3-sans); }
  .entry-copy > span { color: var(--color-md3-on-surface-variant); font: 400 12px/16px var(--font-md3-sans); }
  .entry-copy small { color: var(--color-md3-error); font: 500 12px/16px var(--font-md3-sans); }
  .security-section { min-height: 22rem; }
  .section-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 58%, transparent); padding: 0.9rem 1rem; }
  .section-heading { min-width: 0; flex: 1; }
  .section-heading h2 { color: var(--color-md3-on-surface); font: 600 14px/20px var(--font-md3-sans); }
  .section-heading p { margin-top: 0.12rem; color: var(--color-md3-on-surface-variant); font: 400 12px/16px var(--font-md3-sans); }
  .section-icon, .record-leading { display: grid; width: 2.25rem; height: 2.25rem; flex: none; place-items: center; border-radius: 0.65rem; color: var(--colorCompoundBrandForeground1); background: var(--color-md3-primary-container); }
  :global(.back-button[data-fluent-owner="lib-components-security-management"]) { display: grid; width: 2rem; height: 2rem; flex: none; place-items: center; border-radius: var(--borderRadiusMedium); color: var(--color-md3-on-surface-variant); transition: color 120ms ease, background-color 120ms ease; }
  :global(.back-button[data-fluent-owner="lib-components-security-management"]:hover) { color: var(--colorBrandForegroundLinkHover); background: var(--color-md3-primary-container); }
  :global(.primary-pill[data-fluent-owner="lib-components-security-management"]) { display: inline-flex; min-height: 2rem; flex: none; align-items: center; gap: 4px; border-radius: 999px; padding: 0.3rem 0.8rem; color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); font: 600 12px/16px var(--font-md3-sans); transition: filter 120ms ease, transform 120ms ease; }
  :global(.primary-pill[data-fluent-owner="lib-components-security-management"]:hover:not(:is(:disabled, [disabled]))) { filter: none; transform: translateY(-1px); }
  :global(:is(button[data-fluent-owner="lib-components-security-management"], .cfms-button[data-fluent-owner="lib-components-security-management"]):is(:disabled, [disabled])) { cursor: not-allowed; opacity: 0.46; }
  .record-list { display: grid; }
  .security-record { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 0.85rem 1rem; transition: background-color 140ms ease; }
  .security-record + .security-record { border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 48%, transparent); }
  .security-record:hover { background: color-mix(in srgb, var(--color-md3-primary-container) 13%, transparent); }
  .record-leading { width: 2.1rem; height: 2.1rem; }
  .record-leading--warning { color: var(--color-md3-error); background: var(--color-md3-error-container); }
  .record-main { min-width: 0; }
  .record-title-row { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; }
  .record-title-row strong { overflow-wrap: anywhere; color: var(--color-md3-on-surface); font: 600 14px/20px var(--font-md3-sans); }
  .record-reason, .record-meta { margin-top: 0.16rem; overflow-wrap: anywhere; color: var(--color-md3-on-surface-variant); font: 400 12px/16px var(--font-md3-sans); }
  .record-meta { opacity: 0.82; }
  .status-chip, .scope-chip { border-radius: 999px; padding: 0.16rem 0.48rem; color: var(--color-md3-on-surface-variant); background: var(--color-md3-surface-container-highest); font: 600 12px/16px var(--font-md3-sans); }
  .status-chip--active { color: var(--color-md3-on-error-container); background: var(--color-md3-error-container); }
  .status-chip--scheduled { color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); }
  .record-actions { display: flex; gap: 4px; }
  .record-actions :global(:is(button[data-fluent-owner="lib-components-security-management"], .cfms-button[data-fluent-owner="lib-components-security-management"])) { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: var(--borderRadiusMedium); color: var(--color-md3-on-surface-variant); transition: color 120ms ease, background-color 120ms ease; }
  .record-actions :global(:is(button[data-fluent-owner="lib-components-security-management"], .cfms-button[data-fluent-owner="lib-components-security-management"]):hover:not(:is(:disabled, [disabled]))) { color: var(--colorBrandForegroundLinkHover); background: var(--color-md3-primary-container); }
  .record-actions :global(.danger-action[data-fluent-owner="lib-components-security-management"]:hover:not(:is(:disabled, [disabled]))) { color: var(--color-md3-error); background: var(--color-md3-error-container); }
  :global(.unlock-button[data-fluent-owner="lib-components-security-management"]) { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--color-md3-outline); border-radius: var(--borderRadiusMedium); padding: 0.34rem 0.7rem; color: var(--color-md3-on-surface-variant); font: 600 12px/16px var(--font-md3-sans); transition: color 120ms ease, background-color 120ms ease; }
  :global(.unlock-button[data-fluent-owner="lib-components-security-management"]:hover:not(:is(:disabled, [disabled]))) { color: var(--color-md3-on-primary-container); background: var(--color-md3-primary-container); }
  .empty-state, .loading-state { padding: 2rem 1rem; text-align: center; color: var(--color-md3-on-surface-variant); font: 400 12px/16px var(--font-md3-sans); }
  .loading-state { display: flex; align-items: center; justify-content: center; gap: 8px; }
  .editor-form { display: grid; gap: 16px; padding: 1.25rem; }
  .editor-form input, .editor-form textarea { width: 100%; color: var(--color-md3-on-surface); font: 400 12px/16px var(--font-md3-sans); }
  .editor-form textarea { resize: vertical; padding: 0.62rem 0.72rem; }
  .editor-form small { color: var(--color-md3-on-surface-variant); font-size: 12px; font-weight: 400; }
  .expiry-panel { display: grid; gap: 12px; border: 1px solid color-mix(in srgb, var(--color-md3-outline) 70%, transparent); border-radius: 0.65rem; padding: 0.8rem; }
  .expiry-toggle { display: flex; align-items: flex-start; gap: 12px; }
  .expiry-toggle strong, .expiry-toggle small { display: block; }
  .expiry-toggle strong { color: var(--color-md3-on-surface); font: 600 12px/16px var(--font-md3-sans); }
  .editor-error { display: flex; align-items: flex-start; gap: 8px; border: 1px solid color-mix(in srgb, var(--color-md3-error) 40%, transparent); border-radius: 0.6rem; padding: 0.7rem; color: var(--color-md3-on-error-container); background: color-mix(in srgb, var(--color-md3-error-container) 45%, transparent); font: 400 12px/16px var(--font-md3-sans); }
  .editor-form footer { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 60%, transparent); padding-top: 1rem; }
  @media (max-width: 640px) {
    .section-header { align-items: flex-start; }
    .security-record { grid-template-columns: auto minmax(0, 1fr); }
    .record-actions, :global(.unlock-button[data-fluent-owner="lib-components-security-management"]) { grid-column: 2; justify-self: end; }
    .section-heading p { display: none; }
  }
</style>
