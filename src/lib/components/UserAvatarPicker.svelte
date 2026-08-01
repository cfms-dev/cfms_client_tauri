<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import {
    downloadAvatar,
    getUserAvatar,
    setUserAvatar,
    type ServerDocumentEntry,
  } from '$lib/api';
  import { serverErrorMessage, serverErrorStatus } from '$lib/api/server-errors';
  import { canSetAvatarFor, canSetOtherUserAvatar } from '$lib/avatar-permissions';
  import { isImageDocumentName } from '$lib/image-documents';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ServerDocumentPicker from '$lib/components/ServerDocumentPicker.svelte';

  let {
    username = authStore.username ?? '',
    requireSuperPermission = false,
    onClose,
  }: {
    username?: string;
    requireSuperPermission?: boolean;
    onClose: () => void;
  } = $props();

  let saving = $state(false);
  const isCurrentUser = $derived(username === authStore.username);
  const hasPermission = $derived(
    requireSuperPermission
      ? canSetOtherUserAvatar(authStore.permissions)
      : canSetAvatarFor(authStore.permissions, authStore.username, username),
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
    if (!hasPermission) onClose();
  });

  async function selectAvatar(document: ServerDocumentEntry) {
    if (!username || saving) return;
    if (!hasPermission) {
      onClose();
      return;
    }
    saving = true;

    try {
      const success = await setUserAvatar(username, document.id);
      if (!success) throw new Error($t('avatar.setFailed'));

      if (isCurrentUser) {
        const taskData = await getUserAvatar(username);
        if (taskData) {
          const path = await downloadAvatar(taskData, username, true);
          if (path) authStore.avatarPath = path;
        }
      }

      notificationStore.success(
        isCurrentUser
          ? $t('avatar.updated')
          : $t('avatar.updatedFor', { values: { username } }),
      );
      onClose();
    } catch (error) {
      notificationStore.error(
        serverErrorStatus(error) === 403
          ? $t('avatar.accessOrPermissionDenied', { values: { username } })
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
  documentFilter={(document) => isImageDocumentName(document.title)}
  onSelect={selectAvatar}
  onCancel={() => {
    if (!saving) onClose();
  }}
/>
