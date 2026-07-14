// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccessDeniedNotice from './AccessDeniedNotice.svelte';

afterEach(cleanup);

describe('AccessDeniedNotice', () => {
  it('presents the shared message and invokes its recovery action', async () => {
    const onAction = vi.fn();
    render(AccessDeniedNotice, {
      props: {
        title: 'Access denied',
        description: 'You cannot view this content.',
        subject: 'private.pdf',
        details: [
          { label: 'Document ID', value: 'document-123' },
          { label: 'Access time', value: '7/14/2026, 8:00:00 PM' },
        ],
        actionLabel: 'Go back',
        onAction,
      },
    });

    expect(screen.getByRole('region', { name: 'Access denied' })).toBeTruthy();
    expect(screen.getByText('private.pdf')).toBeTruthy();
    expect(screen.getByText('document-123')).toBeTruthy();
    expect(screen.getByText('7/14/2026, 8:00:00 PM')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
