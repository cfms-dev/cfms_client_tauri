<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    downloadAvatar,
    getUserAvatar,
    setUserAvatar,
    type ServerDocumentEntry,
  } from '$lib/api';
  import { serverErrorMessage, serverErrorStatus } from '$lib/api/server-errors';
  import { canSetAvatarFor, canSetOtherUserAvatar } from '$lib/features/authentication/avatar-permissions';
  import { isImageDocumentName } from '$lib/features/files/image-documents';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
  import ServerDocumentPicker from '$lib/features/files/ServerDocumentPicker.svelte';

  let {
    username = authStore.username ?? '',
    userId = authStore.userId ?? '',
    requireSuperPermission = false,
    onClose,
  }: {
    username?: string;
    userId?: string;
    requireSuperPermission?: boolean;
    onClose: () => void;
  } = $props();

  let saving = $state(false);
  const owner = untrack(() => ({
    userId: authStore.userId,
    username: authStore.username,
    server: serverStateStore.remoteAddress,
  }));
  let closed = false;
  onDestroy(() => { closed = true; });

  function sessionIsCurrent() {
    return !closed && authStore.isLoggedIn && serverStateStore.connected
      && authStore.userId === owner.userId && authStore.username === owner.username
      && serverStateStore.remoteAddress === owner.server;
  }

  function close() {
    if (closed) return;
    closed = true;
    onClose();
  }
  const isCurrentUser = $derived(userId === authStore.userId);
  const hasPermission = $derived(
    requireSuperPermission
      ? canSetOtherUserAvatar(authStore.permissions)
      : canSetAvatarFor(authStore.permissions, authStore.userId, userId),
  );
  const title = $derived(
    isCurrentUser
      ? $t('avatar.selectTitle')
      : $t('avatar.selectTitleFor', { values: { username } }),
  );
  const description = $derived(
    isCurrentUser
      ? undefined
      : $t('avatar.targetAccessHint', { values: { username } }),
  );

  $effect(() => {
    if (!hasPermission || !sessionIsCurrent()) close();
  });

  async function selectAvatar(document: ServerDocumentEntry) {
    if (!userId || saving || !sessionIsCurrent()) return;
    if (!hasPermission) {
      close();
      return;
    }
    saving = true;
    const targetUserId = userId;
    const targetUsername = username;
    const updatingSelf = isCurrentUser;

    try {
      const success = await setUserAvatar(targetUserId, document.id);
      if (!sessionIsCurrent()) return;
      if (!success) throw new Error($t('avatar.setFailed'));

      if (updatingSelf) {
        const taskData = await getUserAvatar(targetUserId);
        if (!sessionIsCurrent()) return;
        if (!taskData) throw new Error($t('avatar.previewRefreshFailed'));
        const path = await downloadAvatar(taskData, targetUsername, true);
        if (!sessionIsCurrent()) return;
        if (!path) throw new Error($t('avatar.previewRefreshFailed'));
        authStore.avatarPath = path;
      }

      notificationStore.success(
        updatingSelf
          ? $t('avatar.updated')
          : $t('avatar.updatedFor', { values: { username: targetUsername } }),
      );
      close();
    } catch (error) {
      if (!sessionIsCurrent()) return;
      notificationStore.error(
        serverErrorStatus(error) === 403
          ? $t('avatar.accessOrPermissionDenied', { values: { username: targetUsername } })
          : serverErrorMessage(error) || $t('avatar.setFailed'),
      );
    } finally {
      saving = false;
    }
  }
</script>

<ServerDocumentPicker
  {title}
  {description}
  selectionBusy={saving}
  documentFilter={(document) => isImageDocumentName(document.title)}
  onSelect={selectAvatar}
  onCancel={() => {
    if (!saving) close();
  }}
/>
