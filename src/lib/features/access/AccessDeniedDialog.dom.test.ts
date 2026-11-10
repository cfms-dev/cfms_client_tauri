import { stubInstantAnimations } from '../../../test/dom-fixtures';
// @vitest-environment jsdom

import '$lib/shared/i18n';
import { cleanup, render, screen } from '@testing-library/svelte';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { formatUtcOffset } from '$lib/shared/format/date-time';
import AccessDeniedDialog from '$lib/features/access/AccessDeniedDialog.svelte';

vi.mock('$lib/shared/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

beforeEach(stubInstantAnimations);

afterEach(cleanup);

describe('AccessDeniedDialog', () => {
  it('shows local access time with an explicit UTC offset', () => {
    const accessedAt = new Date(2026, 6, 14, 20, 0, 0);
    render(AccessDeniedDialog, {
      props: {
        documentName: 'private.pdf',
        documentId: 'document-123',
        accessedAt: accessedAt.getTime(),
        onClose: vi.fn(),
      },
    });

    expect(
      screen.getByText(
        `2026-07-14 20:00:00 UTC${formatUtcOffset(-accessedAt.getTimezoneOffset())}`,
      ),
    ).toBeTruthy();
  });
});
