// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Icon from '$lib/shared/ui/Icon.svelte';

afterEach(cleanup);

const subjects = [
  ['createNewFolder', 'folder body', 0],
  ['folderUpload', 'folder body', 0],
  ['driveFileMove', 'folder body', 0],
  ['adminPanelSettings', 'shield body', 0],
  ['passwordReset', 'password panel', 0],
  ['contentCopy', 'front copy sheet', 1],
  ['accountCircle', 'person inside ring', 1],
] as const;

describe.each([20, 24])('duotone subjects at %spx', (size) => {
  it.each(subjects)('%s identifies the %s as primary', async (name, _subject, primaryIndex) => {
    const { container, rerender } = render(Icon, { name, size, duotone: true });
    const icon = container.querySelector('.cfms-icon')!;
    const paths = icon.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(paths[primaryIndex].getAttribute('fill')).toBe('var(--cfms-icon-primary, currentColor)');
    expect(paths[1 - primaryIndex].getAttribute('fill')).toBe('var(--cfms-icon-secondary, currentColor)');
    expect(icon.classList.contains('primary-brand')).toBe(primaryIndex === 1);
    const geometry = Array.from(paths, (path) => path.getAttribute('d'));
    await rerender({ tone: 'warning' });
    expect(icon.classList.contains('warning')).toBe(true);
    expect(Array.from(icon.querySelectorAll('path'), (path) => path.getAttribute('d'))).toEqual(geometry);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});

it.each([false, true])('applies warning tone to monochrome artwork, filled=%s', (filled) => {
  const { container } = render(Icon, { name: 'info', size: 20, filled, duotone: true, tone: 'warning' });
  const icon = container.querySelector('.cfms-icon')!;
  expect(icon.classList.contains('warning')).toBe(true);
  expect(icon.classList.contains('duotone')).toBe(false);
  expect(icon.querySelector('svg')).not.toBeNull();
  expect(icon.innerHTML).not.toContain('--cfms-icon-primary');
});
