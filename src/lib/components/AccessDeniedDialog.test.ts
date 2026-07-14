// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatUtcOffset } from '$lib/date-time';
import AccessDeniedDialog from './AccessDeniedDialog.svelte';

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => ({
    cancel: vi.fn(),
    currentTime: 0,
    effect: {},
    onfinish: null,
    playState: 'finished',
  }),
});

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
