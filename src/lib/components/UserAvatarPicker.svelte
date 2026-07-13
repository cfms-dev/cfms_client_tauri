<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import {
    downloadAvatar,
    getUserAvatar,
    setUserAvatar,
    type ServerDocumentEntry,
  } from '$lib/api';
  import { isImageDocumentName } from '$lib/image-documents';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ServerDocumentPicker from '$lib/components/ServerDocumentPicker.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let saving = $state(false);

  async function selectAvatar(document: ServerDocumentEntry) {
    const username = authStore.username;
    if (!username || saving) return;
    saving = true;

    try {
      const success = await setUserAvatar(username, document.id);
      if (!success) throw new Error($t('avatar.setFailed'));

      const taskData = await getUserAvatar(username);
      if (taskData) {
        const path = await downloadAvatar(taskData, username, true);
        if (path) authStore.avatarPath = path;
      }

      notificationStore.success($t('avatar.updated'));
      onClose();
    } catch (error) {
      notificationStore.error(error instanceof Error ? error.message : String(error));
    } finally {
      saving = false;
    }
  }
</script>

<ServerDocumentPicker
  title={$t('avatar.selectTitle')}
  documentFilter={(document) => isImageDocumentName(document.title)}
  onSelect={selectAvatar}
  onCancel={() => {
    if (!saving) onClose();
  }}
/>
