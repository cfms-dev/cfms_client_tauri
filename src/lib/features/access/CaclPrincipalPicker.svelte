<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { parseCanonicalUuid } from 'codemirror-lang-cacl';
  import { inlineNotice } from '$lib/shared/motion/transitions';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import type { CaclPrincipalDirectory } from './cacl-editor-extensions';
  import type { CaclPrincipalRef } from './cacl-model';

  interface Props {
    directory: CaclPrincipalDirectory;
    canListUsers?: boolean;
    canListGroups?: boolean;
    disabled?: boolean;
    onAdd: (principal: CaclPrincipalRef) => void;
  }

  let {
    directory,
    canListUsers = false,
    canListGroups = false,
    disabled = false,
    onAdd,
  }: Props = $props();

  let kind = $state<'user' | 'group'>('user');
  let query = $state('');
  let validationError = $state<string | null>(null);
  const inputId = $props.id();

  const canSearchDirectory = $derived(kind === 'user' ? canListUsers : canListGroups);

  const matchingUsers = $derived.by(() => {
    if (kind !== 'user' || !canListUsers) return [];
    const q = query.trim().toLowerCase();
    return directory.users
      .filter((u) =>
        !q
        || u.username.toLowerCase().includes(q)
        || (u.nickname ?? '').toLowerCase().includes(q)
        || u.user_id.toLowerCase().includes(q))
      .slice(0, 6);
  });

  const matchingGroups = $derived.by(() => {
    if (kind !== 'group' || !canListGroups) return [];
    const q = query.trim().toLowerCase();
    return directory.groups
      .filter((g) =>
        !q
        || g.name.toLowerCase().includes(q)
        || (g.display_name ?? '').toLowerCase().includes(q))
      .slice(0, 6);
  });

  function submitManual() {
    if (disabled) return;
    const trimmed = query.trim();
    if (!trimmed) {
      validationError = kind === 'user'
        ? $t('files.cacl.uuidRequired')
        : $t('files.cacl.groupRequired');
      return;
    }

    if (kind === 'user') {
      const canonical = parseCanonicalUuid(trimmed);
      if (canonical) {
        validationError = null;
        onAdd({ kind: 'user', value: canonical });
        query = '';
        return;
      }
      if (canListUsers) {
        const matched = directory.users.find((u) =>
          u.username.toLowerCase() === trimmed.toLowerCase());
        if (matched) {
          validationError = null;
          onAdd({ kind: 'user', value: matched.user_id });
          query = '';
          return;
        }
      }
      validationError = $t('files.cacl.invalidUuid');
      return;
    }

    validationError = null;
    onAdd({ kind: 'group', value: trimmed });
    query = '';
  }

  function pickUser(userId: string) {
    if (disabled) return;
    validationError = null;
    onAdd({ kind: 'user', value: userId });
    query = '';
  }

  function pickGroup(groupName: string) {
    if (disabled) return;
    validationError = null;
    onAdd({ kind: 'group', value: groupName });
    query = '';
  }
</script>

<div class="principal-picker">
  <div class="picker-row">
    <select
      class="cfms-native-field picker-kind"
      bind:value={kind}
      disabled={disabled}
      aria-label={$t('files.cacl.principalKind')}
      onchange={() => { validationError = null; }}
    >
      <option value="user">{$t('files.user')}</option>
      <option value="group">{$t('files.group')}</option>
    </select>

    <div class="picker-field">
      <MdOutlinedField
        inputId={`${inputId}-principal`}
        label={kind === 'user'
          ? $t(canSearchDirectory ? 'files.cacl.searchUserOrUuid' : 'files.cacl.userUuidLabel')
          : $t(canSearchDirectory ? 'files.cacl.searchGroupOrName' : 'files.cacl.groupNameLabel')}
        error={validationError !== null}
        disabled={disabled}
      >
        <input
          id={`${inputId}-principal`}
          class="cfms-native-field picker-input"
          data-focus-ring="delegated"
          bind:value={query}
          disabled={disabled}
          placeholder={kind === 'user'
            ? $t(canSearchDirectory ? 'files.cacl.userSearchPlaceholder' : 'files.cacl.uuidPlaceholder')
            : $t('files.groupNamePlaceholder')}
          oninput={() => { validationError = null; }}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitManual();
            }
          }}
        />
      </MdOutlinedField>
    </div>

    <FluentButton
      data-fluent-owner="cacl-principal-picker"
      type="button"
      appearance="subtle"
      class="cfms-control-action picker-add-btn"
      disabled={disabled}
      onclick={submitManual}
      title={$t('files.addEntry')}
      aria-label={$t('files.addEntry')}
      iconOnly
    >
      <Icon name="add" size="18px" />
    </FluentButton>
  </div>

  {#if validationError}
    <p class="picker-error" role="alert" transition:inlineNotice>{validationError}</p>
  {/if}

  {#if kind === 'user' && matchingUsers.length > 0 && (query.trim().length > 0 || matchingUsers.length <= 6)}
    <div class="picker-suggestions" role="listbox" aria-label={$t('files.cacl.matchingUsers')}>
      {#each matchingUsers as user (user.user_id)}
        <button
          type="button"
          class="suggestion-item"
          disabled={disabled}
          onclick={() => pickUser(user.user_id)}
        >
          <Icon name="manageAccounts" size="15px" />
          <span class="suggestion-primary">
            @{user.username}{#if user.nickname} · {user.nickname}{/if}
          </span>
          <code class="suggestion-id">{user.user_id}</code>
        </button>
      {/each}
    </div>
  {:else if kind === 'group' && matchingGroups.length > 0}
    <div class="picker-suggestions" role="listbox" aria-label={$t('files.cacl.matchingGroups')}>
      {#each matchingGroups as group (group.name)}
        <button
          type="button"
          class="suggestion-item"
          disabled={disabled}
          onclick={() => pickGroup(group.name)}
        >
          <Icon name="groups" size="15px" />
          <span class="suggestion-primary">
            {group.name}{#if group.display_name} · {group.display_name}{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .principal-picker {
    display: grid;
    gap: 8px;
    padding-top: 8px;
  }

  .picker-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .picker-kind {
    min-height: var(--cfms-control-height-medium, 32px);
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium, 4px);
    padding-inline: 8px;
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground1);
    font: 400 13px/20px var(--fontFamilyBase);
  }

  .picker-field {
    min-width: min(100%, 220px);
    flex: 1;
  }

  .picker-input {
    width: 100%;
    min-width: 0;
    font-size: 13px;
  }

  :global(.picker-add-btn[data-fluent-owner="cacl-principal-picker"]) {
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium, 4px);
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground1);
  }

  :global(.picker-add-btn[data-fluent-owner="cacl-principal-picker"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--colorSubtleBackgroundHover);
  }

  .picker-error {
    margin: 0;
    color: var(--colorStatusDangerForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .picker-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    animation: cacl-suggestions-in var(--durationFast, 150ms) var(--curveDecelerateMid, cubic-bezier(0, 0, 0, 1)) both;
  }

  @keyframes cacl-suggestions-in {
    from {
      opacity: 0;
      transform: translate3d(0, 4px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  .suggestion-item {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 4px 8px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusMedium, 4px);
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  .suggestion-item:hover:not(:disabled) {
    background: var(--colorSubtleBackgroundHover);
    border-color: var(--colorNeutralStroke1Hover);
  }

  .suggestion-primary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-id {
    color: var(--colorNeutralForeground3);
    font: 400 11px/14px var(--fontFamilyMonospace);
    max-width: 10ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (pointer: coarse) {
    .picker-kind,
    .suggestion-item {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .picker-suggestions {
      animation: none;
    }

    .suggestion-item {
      transition: none;
    }
  }
</style>
