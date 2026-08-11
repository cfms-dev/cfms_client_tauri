// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Breadcrumb from './Breadcrumb.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

afterEach(cleanup);

describe('Breadcrumb navigation updates', () => {
  it('removes stale path segments in the same render', async () => {
    const onNavigate = vi.fn();
    const { rerender } = render(Breadcrumb, {
      segments: [
        { label: 'Projects', path: 'projects' },
        { label: 'Archive', path: 'archive' },
      ],
      onNavigate,
    });

    expect(screen.getByText('Archive')).toBeTruthy();

    await rerender({
      segments: [{ label: 'Reports', path: 'reports' }],
      onNavigate,
    });

    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.getByText('Reports')).toBeTruthy();
  });
});
