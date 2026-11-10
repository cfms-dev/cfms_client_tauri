<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import AccessDeniedNotice from '$lib/features/access/AccessDeniedNotice.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import { formatLocalDateTimeWithUtcOffset } from '$lib/shared/format/date-time';

  let {
    documentName,
    documentId,
    accessedAt,
    onClose,
  }: {
    documentName: string;
    documentId: string;
    accessedAt: number;
    onClose: () => void;
  } = $props();

  const accessDetails = $derived([
    { label: $t('files.documentId'), value: documentId },
    { label: $t('files.accessDeniedAt'), value: formatLocalDateTimeWithUtcOffset(accessedAt) },
  ]);
</script>

<ModalFrame
  title={$t('files.documentAccessDeniedDialogTitle')}
  maxWidth="max-w-md"
  closeLabel={$t('common.close')}
  {onClose}
>
  <AccessDeniedNotice
    presentation="dialog"
    title={$t('files.documentAccessDeniedTitle')}
    description={$t('files.documentAccessDeniedDescription')}
    subject={documentName}
    details={accessDetails}
    actionLabel={$t('common.close')}
    onAction={onClose}
  />
</ModalFrame>
