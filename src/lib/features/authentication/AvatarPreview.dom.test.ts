import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import AvatarPreview from '$lib/features/authentication/AvatarPreview.svelte';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://localhost/${path}` }));
afterEach(cleanup);

it('keeps initials until the image loads and resets for another user', async () => {
  const view = render(AvatarPreview, { username: 'alice', avatarPath: 'alice.png' });
  expect(screen.getByText('A')).toBeTruthy();
  expect((screen.getByRole('img') as HTMLImageElement).style.opacity).toBe('0');
  await fireEvent.load(screen.getByRole('img'));
  expect(screen.queryByText('A')).toBeNull();
  await view.rerender({ username: 'bob', avatarPath: 'bob.png' });
  expect(screen.getByText('B')).toBeTruthy();
  expect((screen.getByRole('img') as HTMLImageElement).style.opacity).toBe('0');
  await fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText('B')).toBeTruthy();
});
