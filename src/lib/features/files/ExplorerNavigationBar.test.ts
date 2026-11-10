import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '$lib/shared/i18n';
import ExplorerNavigationBar from '$lib/features/files/ExplorerNavigationBar.svelte';

beforeEach(() => locale.set('en'));
afterEach(cleanup);

const address = createRawSnippet(() => ({ render: () => '<span>Workspace / Reports</span>' }));
const search = createRawSnippet(() => ({ render: () => '<input aria-label="Search files" />' }));
function navigationProps() {
  return {
    address, search, canGoBack: true, canGoForward: true, canGoToParent: true, busy: false,
    onBack: vi.fn(), onForward: vi.fn(), onParent: vi.fn(), onRefresh: vi.fn(),
  };
}

it('orders navigation before the address and keeps Refresh after search', async () => {
  const props = navigationProps();
  const { container } = render(ExplorerNavigationBar, props);
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label')))
    .toEqual(['Back', 'Forward', 'Up one level', 'Refresh']);
  const searchField = screen.getByRole('textbox');
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  expect(searchField.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  await fireEvent.click(refresh);
  expect(props.onBack).toHaveBeenCalledOnce();
  expect(props.onForward).toHaveBeenCalledOnce();
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(container.querySelector('.explorer-navigation-address')?.textContent).toContain('Reports');
});

it('disables unavailable history, and all navigation while a destination is loading', async () => {
  const props = navigationProps();
  const view = render(ExplorerNavigationBar, { ...props, canGoBack: false, canGoForward: false });
  expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Forward' }).hasAttribute('disabled')).toBe(true);
  await view.rerender({ ...props, busy: true });
  expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true);
});

it('has no empty search column when the account cannot search', () => {
  const { container } = render(ExplorerNavigationBar, { ...navigationProps(), search: undefined });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(container.querySelector('.explorer-navigation-bar--without-search')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
});
