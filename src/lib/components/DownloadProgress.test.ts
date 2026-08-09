import { render, screen } from '@testing-library/svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMessages, init } from 'svelte-i18n';
import DownloadProgress from './DownloadProgress.svelte';

beforeAll(() => {
  addMessages('en', {
    tasks: {
      progress: 'Transfer progress', progressUnknown: 'Unknown total', waitingToStart: 'Waiting',
      complete: 'Complete', failed: 'Failed', cancelled: 'Cancelled', fileDeleted: 'Deleted',
      paused: 'Paused', downloadCompleted: 'Downloaded',
    },
  });
  init({ fallbackLocale: 'en', initialLocale: 'en' });
});

describe('DownloadProgress accessibility', () => {
  it('exposes a numeric value for determinate progress', () => {
    render(DownloadProgress, {
      progress: 0.42, currentBytes: 42, totalBytes: 100,
      status: 'downloading', ariaLabel: 'Report transfer',
    });
    const bar = screen.getByRole('progressbar', { name: 'Report transfer' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuetext')).toBe('42%');
  });

  it('omits numeric ARIA state when the total is unknown', () => {
    render(DownloadProgress, {
      progress: 0, currentBytes: 0, totalBytes: 0,
      status: 'downloading', ariaLabel: 'Streaming upload',
    });
    const bar = screen.getByRole('progressbar', { name: 'Streaming upload' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('aria-valuetext')).toBe('Unknown total');
  });
});
