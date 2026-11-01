<script lang="ts">
  import { onMount } from 'svelte';
  import { locale, _ as t } from 'svelte-i18n';
  import type { ManagedUserInfo } from '$lib/api';
  import { filterAccountPermissions, formatAccountTimestamp } from '$lib/account-profile';
  import { permissionEntryState } from '$lib/permission-entries';

  let { info }: { info: ManagedUserInfo } = $props();
  let now = $state(Date.now() / 1000);
  const headingId = $props.id();
  const visiblePermissions = $derived(filterAccountPermissions(info.effective_permissions, ''));
  const sources = $derived([
    { title: $t('settings.account.ownPermissions'), permissions: filterAccountPermissions(info.effective_own_permissions, '') },
    { title: $t('settings.account.inheritedPermissions'), permissions: filterAccountPermissions(info.effective_inherited_permissions, '') },
  ]);

  // Update validity labels locally; the server remains authoritative for effective rights.
  onMount(() => {
    const timer = setInterval(() => { now = Date.now() / 1000; }, 1000);
    return () => clearInterval(timer);
  });

  function date(value: number | null | undefined) {
    return formatAccountTimestamp(value, $locale ?? 'zh-CN', $t('settings.account.notProvided'));
  }
</script>

<section class="permissions-section" aria-labelledby={headingId}>
  <div class="cfms-heading-copy">
    <h2 id={headingId}>{$t('settings.account.effectivePermissions')} <span class="count">{visiblePermissions.length}</span></h2>
    <p>{$t('settings.account.permissionsHint')}</p>
  </div>

  {#if visiblePermissions.length}
    <ul class="effective-permissions" aria-label={$t('settings.account.effectivePermissions')}>
      {#each visiblePermissions as permission (permission)}<li><code>{permission}</code></li>{/each}
    </ul>
  {:else}
    <p class="empty" role="status">{$t('settings.account.noPermissions')}</p>
  {/if}

  <details class="permission-details">
    <summary>{$t('settings.account.authorizationDetails')}</summary>
    <div class="details-body">
      <div class="cfms-heading-copy">
        <h3>{$t('settings.account.directPermissions')}</h3>
        <p>{$t('settings.account.directPermissionsHint')}</p>
      </div>
      {#if info.permissions.length}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region needs keyboard access.) -->
        <div class="permission-scroll permission-scroll--rules" role="region" tabindex="0" aria-label={$t('settings.account.directPermissions')}>
        <ul class="permission-rules" aria-label={$t('settings.account.directPermissions')}>
          {#each info.permissions as entry}
            {@const state = permissionEntryState(entry, now)}
            <li>
              <div class="rule-title"><code>{entry.permission}</code><span class="rule-effect">{$t(entry.granted ? 'manage.permissionGrant' : 'manage.permissionRevoke')}</span></div>
              <span class="rule-state">{$t(`manage.permissionState.${state}`)}</span>
              <dl class="rule-times">
                <div><dt>{$t('manage.permissionStartsAt')}</dt><dd>{date(entry.start_time)}</dd></div>
                <div><dt>{$t('manage.permissionEndsAt')}</dt><dd>{entry.end_time === null ? $t('manage.permissionNeverExpires') : date(entry.end_time)}</dd></div>
              </dl>
            </li>
          {/each}
        </ul>
        </div>
      {:else}
        <p class="empty">{$t('manage.noPermissionEntries')}</p>
      {/if}
      <p class="source-hint">{$t('settings.account.permissionSourcesHint')}</p>
      {#each sources as source}
        <div class="permission-source">
          <h3>{source.title} <span class="count">{source.permissions.length}</span></h3>
          {#if source.permissions.length}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scroll region needs keyboard access.) -->
            <div class="permission-scroll" role="region" tabindex="0" aria-label={source.title}>
            <ul class="permission-names" aria-label={source.title}>
              {#each source.permissions as permission (permission)}<li><code>{permission}</code></li>{/each}
            </ul>
            </div>
          {:else}<p class="empty">{$t('settings.account.noSourcePermissions')}</p>{/if}
        </div>
      {/each}
    </div>
  </details>
</section>

<style>
  .permissions-section { display: grid; min-width: 0; gap: 12px; }
  h2, h3 { margin: 0; color: var(--colorNeutralForeground1); font: 600 16px/22px var(--fontFamilyBase); }
  h3 { font-size: 14px; line-height: 20px; }
  p, dl, dd { margin: 0; }
  p, dt, .count, .rule-state { color: var(--colorNeutralForeground3); font: 400 12px/16px var(--fontFamilyBase); }
  .count { margin-inline-start: 8px; font-variant-numeric: tabular-nums; }
  .effective-permissions { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; list-style: none; }
  .effective-permissions li { min-width: 0; max-width: 100%; }
  .permission-names, .permission-rules { margin: 0; padding: 0; list-style: none; }
  .permission-scroll { min-width: 0; border: 1px solid var(--colorNeutralStroke2); border-radius: 8px; overflow: auto; max-height: 320px; }
  .permission-scroll--rules { max-height: 480px; }
  .permission-names li { padding: 8px 12px; }
  .permission-names li + li, .permission-rules li + li { border-top: 1px solid var(--colorNeutralStroke2); }
  code { font: 400 13px/20px var(--fontFamilyMonospace); overflow-wrap: anywhere; }
  .empty { padding-block: 8px; }
  .permission-details { min-width: 0; border-top: 1px solid var(--colorNeutralStroke2); }
  summary { width: fit-content; max-width: 100%; padding: 10px 4px; border-radius: 4px; cursor: pointer; color: var(--colorBrandForegroundLink); font: 600 14px/20px var(--fontFamilyBase); }
  summary:hover { background: var(--colorSubtleBackgroundHover); }
  .details-body { display: grid; min-width: 0; gap: 12px; padding-top: 8px; }
  .permission-rules li { padding: 12px; }
  .rule-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 16px; }
  .rule-title code { flex: 1; }
  .rule-effect { font: 600 12px/16px var(--fontFamilyBase); }
  .rule-state { display: block; margin-top: 4px; }
  .rule-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin-top: 12px; }
  .rule-times div { min-width: 0; }
  dd { margin-top: 4px; font: 400 12px/16px var(--fontFamilyBase); overflow-wrap: anywhere; }
  .source-hint { margin-top: 8px; max-width: 70ch; }
  .permission-source { display: grid; min-width: 0; gap: 8px; }
  @media (max-width: 640px) { .rule-times { grid-template-columns: minmax(0, 1fr); } }
  @media (pointer: coarse) { summary { min-height: 44px; } }
</style>
