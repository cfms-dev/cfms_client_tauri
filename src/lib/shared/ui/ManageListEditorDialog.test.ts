import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ManageListEditorDialog from '$lib/shared/ui/ManageListEditorDialog.svelte';

vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (t: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => ({ cancel: vi.fn(), currentTime: 0, effect: {}, onfinish: null, playState: 'finished' }),
});
afterEach(cleanup);

const items = [{ id: 'sysop' }, { id: 'user' }, { id: 'auditor' }];

it('retains selection through filtering and saves sorted IDs', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(ManageListEditorDialog, { title: 'Groups', description: 'Choose groups', items, selected: ['sysop'], onSave: save, onClose: vi.fn() });
  const sysop = screen.getByRole('button', { name: 'sysop' });
  const user = screen.getByRole('button', { name: 'user' });
  expect(sysop.getAttribute('aria-pressed')).toBe('true');
  expect(user.getAttribute('aria-pressed')).toBe('false');
  await fireEvent.click(user);
  expect(user.getAttribute('aria-pressed')).toBe('true');
  const search = screen.getByPlaceholderText('manage.searchItems');
  await fireEvent.input(search, { target: { value: 'auditor' } });
  expect(screen.queryByRole('button', { name: 'sysop' })).toBeNull();
  const auditor = screen.getByRole('button', { name: 'auditor' });
  await fireEvent.click(auditor);
  expect(auditor.getAttribute('aria-pressed')).toBe('true');
  await fireEvent.input(search, { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'sysop' }).getAttribute('aria-pressed')).toBe('true');
  await fireEvent.click(screen.getByRole('button', { name: 'user' }));
  await fireEvent.click(screen.getByRole('button', { name: /common.save/ }));
  expect(save).toHaveBeenCalledExactlyOnceWith(['auditor', 'sysop']);
});

it('loads memberships from refresh and prevents edits while saving', async () => {
  let finishSave!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
  const refresh = vi.fn().mockResolvedValue({ items, selected: ['user'] });
  render(ManageListEditorDialog, { title: 'Groups', description: 'Choose groups', onRefresh: refresh, onSave: save, onClose: vi.fn() });
  const user = await screen.findByRole('button', { name: 'user' });
  expect(refresh).toHaveBeenCalledOnce();
  expect(user.getAttribute('aria-pressed')).toBe('true');
  await fireEvent.click(screen.getByRole('button', { name: /common.save/ }));
  expect(user.hasAttribute('disabled')).toBe(true);
  await fireEvent.click(user);
  expect(user.getAttribute('aria-pressed')).toBe('true');
  expect(save).toHaveBeenCalledExactlyOnceWith(['user']);
  finishSave();
  await waitFor(() => expect(user.hasAttribute('disabled')).toBe(false));
});
