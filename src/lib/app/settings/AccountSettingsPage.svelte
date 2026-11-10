<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { goto } from '$app/navigation';
  import { tick, untrack } from 'svelte';
  import { locale, _ as t } from 'svelte-i18n';
  import { getUserInfo, renameUser, serverErrorStatus, type ManagedUserInfo } from '$lib/api';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
  import { canSetOwnAvatar } from '$lib/features/authentication/avatar-permissions';
  import { formatAccountTimestamp } from '$lib/features/authentication/account-profile';
  import { copyText } from '$lib/shared/platform/clipboard';
  import AccountPermissions from '$lib/features/authentication/AccountPermissions.svelte';
  import UserAvatarPicker from '$lib/features/authentication/UserAvatarPicker.svelte';
  import IconButton from '$lib/shared/ui/IconButton.svelte';
  import AvatarPreview from '$lib/features/authentication/AvatarPreview.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import SettingsPageHeader from '$lib/shared/ui/SettingsPageHeader.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  const NICKNAME_MAX_LENGTH = 255;
  let editingNickname = $state(false);
  let nicknameInput = $state('');
  let nicknameInputElement = $state<HTMLInputElement | null>(null);
  let nicknameBusy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let info = $state<ManagedUserInfo | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let updatedAt = $state<number | null>(null);
  let showAvatarPicker = $state(false);
  let avatarButton: HTMLButtonElement | undefined = $state();
  let requestSequence = 0;
  let accountGeneration = 0;
  let nicknameWriteVersion = 0;
  const accountScope = $derived(authStore.isLoggedIn && authStore.userId
    ? JSON.stringify([serverStateStore.remoteAddress, authStore.userId]) : null);
  const displayName = $derived(info?.nickname?.trim() || info?.username || authStore.displayName || authStore.username || $t('common.unknown'));
  const canChangeAvatar = $derived(authStore.isLoggedIn && canSetOwnAvatar(authStore.permissions));
  const profileFields = $derived(info ? [
    { label: $t('settings.account.username'), value: info.username },
    { label: $t('settings.account.accountStatus'), value: $t(info.status === 'active' ? 'manage.statusActive' : 'manage.statusDisabled') },
    { label: $t('settings.account.createdAt'), value: date(info.created_time) },
    { label: $t('settings.account.lastLogin'), value: date(info.last_login) },
    { label: $t('settings.account.passwordModifiedAt'), value: date(info.passwd_last_modified) },
  ] : []);
  const cleanNickname = $derived(nicknameInput.trim() || null);
  const nicknameCharacterCount = $derived(Array.from(nicknameInput.trim()).length);
  const nicknameTooLong = $derived(nicknameCharacterCount > NICKNAME_MAX_LENGTH);
  const nicknameChanged = $derived.by(() => {
    const username = authStore.username;
    if (!username) return false;
    return (cleanNickname ?? username) !== displayName;
  });
  const canSaveNickname = $derived(
    authStore.isLoggedIn
      && serverStateStore.connected
      && Boolean(authStore.username)
      && nicknameChanged
      && !nicknameTooLong
      && !nicknameBusy,
  );
  $effect(() => {
    const scope = accountScope;
    untrack(() => {
      accountGeneration += 1;
      info = null;
      updatedAt = null;
      loadError = null;
      loading = false;
      showAvatarPicker = false;
      editingNickname = false;
      nicknameInput = '';
      nicknameBusy = false;
    });
    return () => { requestSequence += 1; };
  });

  $effect(() => {
    const scope = accountScope;
    const connected = serverStateStore.connected;
    const ready = !authStore.postLoginPending;
    if (scope && connected && ready) untrack(() => { void refreshProfile(); });
    else untrack(() => { loading = false; showAvatarPicker = false; });
    return () => { requestSequence += 1; };
  });

  function date(value: number | null | undefined) {
    return formatAccountTimestamp(value, $locale ?? 'zh-CN', $t('settings.account.notProvided'));
  }

  async function refreshProfile() {
    const scope = accountScope;
    const userId = authStore.userId;
    if (!scope || !userId || !serverStateStore.connected || authStore.postLoginPending || loading) return;
    const sequence = ++requestSequence;
    const nicknameVersion = nicknameWriteVersion;
    loading = true;
    loadError = null;
    try {
      const result = await getUserInfo({ userId });
      if (sequence !== requestSequence || scope !== accountScope) return;
      if (result.user_id !== userId) throw new Error($t('settings.account.invalidProfile'));
      // A read started before a successful nickname write must not undo that write.
      info = nicknameVersion === nicknameWriteVersion ? result : { ...result, nickname: authStore.nickname };
      updatedAt = Date.now() / 1000;
    } catch (err) {
      if (sequence !== requestSequence || scope !== accountScope) return;
      loadError = serverErrorStatus(err) === 403
        ? $t('settings.account.profileDenied') : formatUserFacingError(err);
    } finally {
      if (sequence === requestSequence && scope === accountScope) loading = false;
    }
  }

  async function copyUserId() {
    if (!info) return;
    try {
      await copyText(info.user_id);
      notificationStore.success($t('settings.account.userIdCopied'));
    } catch {
      notificationStore.error($t('manage.userIdCopyFailed'));
    }
  }

  async function closeAvatarPicker() {
    showAvatarPicker = false;
    await tick();
    avatarButton?.focus({ preventScroll: true });
  }
  $effect(() => {
    if (!status) return;
    notificationStore.success(status, 5000);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  async function beginNicknameEdit() {
    if (!authStore.isLoggedIn || !authStore.username || nicknameBusy) return;
    nicknameInput = displayName;
    editingNickname = true;
    await tick();
    nicknameInputElement?.focus();
    nicknameInputElement?.select();
  }

  function cancelNicknameEdit() {
    if (nicknameBusy) return;
    nicknameInput = '';
    editingNickname = false;
  }

  function handleNicknameKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancelNicknameEdit();
  }

  async function saveNickname() {
    const username = authStore.username;
    if (!canSaveNickname || !username) return;
    const scope = accountScope;
    const generation = accountGeneration;
    const nickname = cleanNickname;
    nicknameBusy = true;
    try {
      const success = await renameUser(authStore.userId!, nickname);
      if (scope !== accountScope || generation !== accountGeneration) return;
      if (!success) throw new Error($t('settings.account.nicknameUpdateFailed'));

      if (authStore.isLoggedIn && authStore.username === username) {
        nicknameWriteVersion += 1;
        authStore.nickname = nickname ?? username;
        if (info) info = { ...info, nickname };
      }
      nicknameInput = '';
      editingNickname = false;
      status = $t('settings.account.nicknameUpdated');
    } catch (err) {
      if (scope === accountScope && generation === accountGeneration) error = formatUserFacingError(err);
    } finally {
      if (scope === accountScope && generation === accountGeneration) nicknameBusy = false;
    }
  }

</script>

{#if authStore.isLoggedIn}
<div class="workspace-page settings-page-shell account-settings-page">
  <SettingsPageHeader
    title={$t('settings.account.title')}
    description={$t('settings.account.description')}
    icon="contactCard"
    onRefresh={refreshProfile}
    refreshDisabled={loading || !serverStateStore.connected || authStore.postLoginPending}
  />

  <div class="account-sections">
  <section
    class="identity-panel account-section"
    aria-label={$t('settings.account.nicknameLabel')}
  >
    <div class="identity-summary">
      {#if canChangeAvatar}
        <button bind:this={avatarButton} type="button" class="identity-avatar identity-avatar--editable"
          title={$t('avatar.change')} aria-label={$t('avatar.change')}
          disabled={!serverStateStore.connected}
          onclick={() => { showAvatarPicker = true; }}>
          <AvatarPreview username={authStore.username ?? ''} size={64} avatarPath={authStore.avatarPath} />
          <span class="avatar-edit" aria-hidden="true"><Icon name="edit" size="14px" /></span>
        </button>
      {:else}
      <div class="identity-avatar">
        <AvatarPreview
          username={authStore.username ?? $t('common.unknownUser')}
          size={64}
          avatarPath={authStore.avatarPath}
        />
      </div>
      {/if}

      <div class="identity-copy">
        <h2>{displayName}</h2>
        {#if authStore.username}
          <p class="identity-username">@{authStore.username}</p>
        {/if}
        {#if !canChangeAvatar}<p class="avatar-hint">{$t('settings.account.avatarReadOnly')}</p>{/if}
      </div>

      {#if !editingNickname}
        <FluentButton data-fluent-owner="routes-home-settings-account-page"
          type="button"
          title={$t('settings.account.editNickname')}
          aria-label={$t('settings.account.editNickname')}
          disabled={!authStore.isLoggedIn || !authStore.username || !serverStateStore.connected}
          onclick={() => void beginNicknameEdit()}
          appearance="subtle"
          class="action-button action-button--secondary identity-edit-button"
        >
          <Icon name="edit" size="18px" />
          <span>{$t('settings.account.editNickname')}</span>
        </FluentButton>
      {/if}
    </div>

    {#if editingNickname}
      <form
        class="nickname-editor"
        aria-label={$t('settings.account.editNickname')}
        onsubmit={(event) => {
          event.preventDefault();
          void saveNickname();
        }}
      >
        <div class="nickname-editor__field">
          <MdOutlinedField inputId="account-nickname-input" label={$t('settings.account.nicknameLabel')} error={nicknameTooLong} disabled={nicknameBusy}>
            <div data-outlined-content class="field-with-count">
              <input
                id="account-nickname-input"
                data-focus-ring="delegated"
                bind:this={nicknameInputElement}
                bind:value={nicknameInput}
                class="cfms-native-field text-field text-field--counted"
                type="text"
                name="nickname"
                autocomplete="off"
                aria-describedby="nickname-help nickname-count"
                aria-invalid={nicknameTooLong}
                disabled={nicknameBusy}
                onkeydown={handleNicknameKeydown}
              />
              <span
                id="nickname-count"
                class="field-count"
                class:field-count--error={nicknameTooLong}
              >
                {nicknameCharacterCount}/{NICKNAME_MAX_LENGTH}
              </span>
            </div>
          </MdOutlinedField>
          <span
            id="nickname-help"
            class="field-help"
            class:field-help--error={nicknameTooLong}
          >
            {$t(nicknameTooLong
              ? 'settings.account.nicknameTooLong'
              : 'settings.account.nicknameHint', {
                values: { max: NICKNAME_MAX_LENGTH },
              })}
          </span>
        </div>

        <div class="nickname-editor__actions">
          <FluentButton data-fluent-owner="routes-home-settings-account-page"
            type="button"
            title={$t('common.cancel')}
            aria-label={$t('common.cancel')}
            disabled={nicknameBusy}
            onclick={cancelNicknameEdit}
            appearance="outline"
            class="action-button action-button--secondary"
          >
            <Icon name="close" size="18px" />
            <span>{$t('common.cancel')}</span>
          </FluentButton>
          <FluentButton data-fluent-owner="routes-home-settings-account-page"
            type="submit"
            title={$t(nicknameBusy ? 'common.saving' : 'common.save')}
            aria-label={$t(nicknameBusy ? 'common.saving' : 'common.save')}
            disabled={!canSaveNickname}
            appearance="primary"
            class="action-button action-button--primary"
          >
            {#if nicknameBusy}
              <ProgressRing size={17} strokeWidth={2.2} label={$t('common.saving')} tone="inherit" />
            {:else}
              <Icon name="check" size="18px" />
            {/if}
            <span>{$t(nicknameBusy ? 'common.saving' : 'common.save')}</span>
          </FluentButton>
        </div>
      </form>
    {/if}
  </section>

  <div class="profile-status" aria-live="polite">
    {#if loading}<p role="status"><span aria-hidden="true"><ProgressRing size={16} label={$t('common.loading')} /></span>{$t('settings.account.loading')}</p>{/if}
    {#if !serverStateStore.connected}<p role="status">{$t('settings.account.offline')}</p>{/if}
    {#if loadError}
      <div class="profile-error" role="alert">
        <div class="cfms-heading-copy"><strong>{$t(info ? 'settings.account.refreshFailed' : 'settings.account.loadFailed')}</strong><p>{loadError}</p></div>
        <FluentButton appearance="outline" disabled={loading || !serverStateStore.connected} onclick={refreshProfile}>{$t('settings.account.retry')}</FluentButton>
      </div>
    {/if}
    {#if updatedAt}<p>{$t('settings.account.lastUpdated', { values: { time: date(updatedAt) } })}</p>{/if}
  </div>

  {#if info}
    <section class="account-section profile-section" aria-labelledby="account-basic-title">
      <h2 id="account-basic-title">{$t('settings.account.basicInfo')}</h2>
      <dl class="profile-fields">
        <div class="profile-id"><dt>{$t('settings.account.userId')}</dt><dd><code>{info.user_id}</code><IconButton icon="contentCopy" label={$t('manage.copyUserId')} onclick={copyUserId} /></dd></div>
        {#each profileFields as field}<div><dt>{field.label}</dt><dd>{field.value}</dd></div>{/each}
      </dl>
      <p class="section-hint">{$t('settings.account.lastLoginHint')}</p>
    </section>
    <section class="account-section profile-section" aria-labelledby="account-groups-title">
      <h2 id="account-groups-title">{$t('settings.account.groups')} <span class="section-count">{info.groups?.length ?? 0}</span></h2>
      {#if info.groups?.length}
        <ul class="group-list">{#each [...info.groups].sort() as group (group)}<li><Icon name="groups" size="18px" /><span>{group}</span></li>{/each}</ul>
      {:else}<p class="section-hint">{$t('settings.account.noGroups')}</p>{/if}
    </section>
    <div class="account-section profile-section"><AccountPermissions {info} /></div>
  {/if}

  <section class="account-section authentication-link">
    <div class="cfms-heading-copy"><h2>{$t('authManagement.title')}</h2><p>{$t('authManagement.description')}</p></div>
    <FluentButton data-fluent-owner="routes-home-settings-account-page"
      type="button"
      onclick={() => goto('/home/settings/authentication')}
      appearance="subtle"
      class="action-button action-button--secondary"
    ><Icon name="passkey" size="18px" />{$t('authManagement.title')}</FluentButton>
  </section>
  </div>
</div>
{#if showAvatarPicker && canChangeAvatar && serverStateStore.connected}
  <UserAvatarPicker onClose={() => { void closeAvatarPicker(); }} />
{/if}
{/if}

<style>
  .account-settings-page { width: min(100%, 960px); gap: 16px; color: var(--colorNeutralForeground1); }
  .account-sections { min-width: 0; border-top: 1px solid var(--colorNeutralStroke2); }
  .account-section { min-width: 0; }
  .profile-section, .authentication-link { border-top: 1px solid var(--colorNeutralStroke2); padding-block: 24px; }
  .profile-section { display: grid; gap: 16px; }
  .profile-section h2 { margin: 0; font: 600 16px/22px var(--fontFamilyBase); }
  .identity-summary { display: grid; min-width: 0; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 16px; padding-block: 24px; }
  .identity-avatar { position: relative; display: grid; border-radius: 50%; padding: 0; }
  .identity-avatar--editable { cursor: pointer; transition: background-color 140ms ease; }
  .identity-avatar--editable:hover { background: var(--colorSubtleBackgroundHover); }
  .identity-avatar--editable:disabled { cursor: not-allowed; opacity: 0.6; }
  .avatar-edit { position: absolute; right: -2px; bottom: -2px; display: grid; width: 22px; height: 22px; place-items: center; border: 2px solid var(--colorNeutralBackground1); border-radius: 50%; background: var(--colorBrandBackground); color: var(--colorNeutralForegroundOnBrand); }
  .identity-copy { min-width: 0; }
  .identity-copy h2, .identity-copy p { margin: 0; overflow-wrap: anywhere; }
  .identity-copy h2 { font: 600 20px/26px var(--fontFamilyBase); }
  .identity-username, .avatar-hint { margin-top: 4px !important; color: var(--colorNeutralForeground3); font: 400 12px/16px var(--fontFamilyBase); }
  .nickname-editor { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; padding-bottom: 24px; }
  .nickname-editor__field { min-width: 0; }
  .field-with-count { position: relative; }
  .text-field--counted { padding-inline-end: 72px; }
  .text-field:disabled { cursor: not-allowed; }
  .field-count { position: absolute; top: 50%; right: 12px; color: var(--colorNeutralForeground3); font: 400 12px/16px var(--fontFamilyMonospace); transform: translateY(-50%); }
  .field-count--error, .field-help.field-help--error { color: var(--colorStatusDangerForeground1); }
  .field-help { display: block; margin-top: 4px; color: var(--colorNeutralForeground3); font: 400 12px/16px var(--fontFamilyBase); }
  .nickname-editor__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  :global(.action-button[data-fluent-owner="routes-home-settings-account-page"]) { flex: none; font: 400 14px/20px var(--fontFamilyBase); }
  .profile-status { display: grid; gap: 8px; padding-bottom: 16px; }
  .profile-status p { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--colorNeutralForeground3); font: 400 12px/16px var(--fontFamilyBase); }
  .profile-error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--colorStatusDangerBorder1); border-radius: 8px; }
  .profile-error .cfms-heading-copy { flex: 1; min-width: min(100%, 240px); }
  .profile-error strong { color: var(--colorStatusDangerForeground1); font: 600 14px/20px var(--fontFamilyBase); }
  .profile-error p { overflow-wrap: anywhere; }
  .profile-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 32px; margin: 0; }
  .profile-fields > div { min-width: 0; }
  .profile-fields dt, .section-hint, .section-count { color: var(--colorNeutralForeground3); font: 400 12px/16px var(--fontFamilyBase); }
  .profile-fields dd { margin: 4px 0 0; overflow-wrap: anywhere; font: 400 14px/20px var(--fontFamilyBase); }
  .profile-fields .profile-id { grid-column: 1 / -1; }
  .profile-id dd { display: flex; align-items: center; gap: 12px; }
  .profile-id code { min-width: 0; font-family: var(--fontFamilyMonospace); overflow-wrap: anywhere; }
  .section-hint { margin: 0; max-width: 70ch; }
  .section-count { margin-inline-start: 8px; font-variant-numeric: tabular-nums; }
  .group-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .group-list li { display: flex; align-items: baseline; gap: 8px; min-width: 0; font: 400 14px/20px var(--fontFamilyBase); }
  .group-list span { overflow-wrap: anywhere; min-width: 0; }
  .authentication-link { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .authentication-link h2 { margin: 0; font: 600 16px/22px var(--fontFamilyBase); }
  .authentication-link p { margin: 0; max-width: 70ch; color: var(--colorNeutralForeground3); font: 400 12px/16px var(--fontFamilyBase); }
  @media (max-width: 640px) {
    .profile-fields, .nickname-editor { grid-template-columns: minmax(0, 1fr); }
    .identity-summary { grid-template-columns: auto minmax(0, 1fr); }
    :global(.identity-edit-button[data-fluent-owner="routes-home-settings-account-page"]) { grid-column: 2; justify-self: start; }
    .authentication-link { flex-wrap: wrap; }
    .profile-section, .authentication-link { padding-block: 20px; }
  }
  @media (prefers-reduced-motion: reduce) { .identity-avatar--editable { transition: none; } }
  @media (forced-colors: active) { .avatar-edit { background: Highlight; color: HighlightText; border-color: Canvas; } }
</style>
