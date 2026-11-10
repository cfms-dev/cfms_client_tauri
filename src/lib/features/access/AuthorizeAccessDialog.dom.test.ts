// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import AuthorizeAccessDialog from '$lib/features/access/AuthorizeAccessDialog.svelte';

const mocks = vi.hoisted(() => ({ users: vi.fn() }));
vi.mock('$lib/api', () => ({ listUsers: mocks.users, listGroups: vi.fn() }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (t: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));
afterEach(cleanup);

it('displays a username while submitting its immutable ID for a direct grant', async () => {
  const userId = 'aabbccdd-0000-4000-8000-000000000001';
  mocks.users.mockResolvedValue([{ user_id: userId, username: 'alice', nickname: 'Alice' }]);
  const submit = vi.fn();
  render(AuthorizeAccessDialog, { targetName: 'Document', targetType: 'document', canListUsers: true, canListGroups: false, onSubmit: submit, onCancel: vi.fn() });
  await fireEvent.input(screen.getByPlaceholderText('files.usernamePlaceholder'), { target: { value: 'alice' } });
  await fireEvent.click(screen.getByRole('button', { name: /files.searchEntity/ }));
  await fireEvent.click(await screen.findByRole('button', { name: /alice Alice/ }));
  await fireEvent.click(screen.getByRole('button', { name: /files.grantAccessAction/ }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'user', entityIdentifier: userId }));
});

it('accepts an explicit user ID when list permission is unavailable', async () => {
  const userId = 'aabbccdd-0000-4000-8000-000000000001';
  const submit = vi.fn();
  render(AuthorizeAccessDialog, { targetName: 'Document', targetType: 'document', canListUsers: false, canListGroups: false, onSubmit: submit, onCancel: vi.fn() });
  await fireEvent.input(screen.getByPlaceholderText('manage.userId'), { target: { value: userId } });
  await fireEvent.click(screen.getByRole('button', { name: /files.grantAccessAction/ }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'user', entityIdentifier: userId }));
});

it('changes the selected search result and submits that result’s immutable ID', async () => {
  const users = [
    { user_id: 'user-alice', username: 'alice', nickname: 'Alice' },
    { user_id: 'user-bob', username: 'bob', nickname: 'Bob' },
  ];
  mocks.users.mockResolvedValue(users);
  const submit = vi.fn();
  render(AuthorizeAccessDialog, { targetName: 'Document', targetType: 'document', canListUsers: true, canListGroups: false, onSubmit: submit, onCancel: vi.fn() });
  await fireEvent.input(screen.getByPlaceholderText('files.usernamePlaceholder'), { target: { value: 'user' } });
  await fireEvent.click(screen.getByRole('button', { name: /files.searchEntity/ }));
  await fireEvent.click(await screen.findByRole('button', { name: /alice Alice/ }));
  const bob = screen.getByRole('button', { name: /bob Bob/ });
  await fireEvent.click(bob);
  await fireEvent.click(screen.getByRole('button', { name: /files.grantAccessAction/ }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'user', entityIdentifier: 'user-bob' }));
});
