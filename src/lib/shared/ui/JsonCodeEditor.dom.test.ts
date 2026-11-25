// @vitest-environment jsdom

import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JsonCodeEditor from '$lib/shared/ui/JsonCodeEditor.svelte';
import { stubInstantAnimations } from '../../../test/dom-fixtures';

beforeEach(() => {
  stubInstantAnimations();
  locale.set('en');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = 'light';
});

describe('JsonCodeEditor', () => {
  it('loads CodeMirror with the current JSON and a delegated focus ring', async () => {
    const onChange = vi.fn();
    const props = {
      value: '{"duration_seconds": 60}',
      diagnostics: [],
      disabled: false,
      ariaLabel: 'Payload JSON',
      loadingLabel: 'Loading JSON editor…',
      onChange,
    };
    const view = render(JsonCodeEditor, { props });

    const editor = await screen.findByLabelText('Payload JSON');
    expect(editor.getAttribute('data-focus-ring')).toBe('delegated');
    expect(editor.textContent).toContain('duration_seconds');

    await view.rerender({ ...props, value: '{"duration_seconds": 120}' });
    await waitFor(() => expect(editor.textContent).toContain('120'));
  });

  it('reconfigures CodeMirror when the application color scheme changes', async () => {
    document.documentElement.dataset.theme = 'dark';
    render(JsonCodeEditor, {
      props: {
        value: '{"enabled": true, "retries": 3}',
        diagnostics: [],
        disabled: false,
        ariaLabel: 'Themed payload JSON',
        loadingLabel: 'Loading JSON editor…',
        onChange: vi.fn(),
      },
    });

    const content = await screen.findByLabelText('Themed payload JSON');
    const editor = content.closest('.cm-editor');
    expect(editor).not.toBeNull();
    const darkThemeClasses = editor?.className;

    document.documentElement.dataset.theme = 'light';

    await waitFor(() => expect(editor?.className).not.toBe(darkThemeClasses));
  });

  it('uses local Fluent SVG icons for foldable JSON lines', async () => {
    const { container } = render(JsonCodeEditor, {
      props: {
        value: '{\n  "duration_seconds": 30,\n  "reason": "test"\n}',
        diagnostics: [],
        disabled: false,
        ariaLabel: 'Foldable payload JSON',
        loadingLabel: 'Loading JSON editor…',
        onChange: vi.fn(),
      },
    });

    await screen.findByLabelText('Foldable payload JSON');
    await waitFor(() => {
      const marker = container.querySelector('.cm-foldGutter span[title="Fold line"]');
      expect(marker?.querySelector('svg')).not.toBeNull();
      expect(marker?.innerHTML).toContain('viewBox="0 0 24 24"');
      expect(marker?.getAttribute('title')).toBe('Fold line');
    });
  });

  it('opens a context menu without Format by default and shows Format when onFormat is supplied', async () => {
    const onFormat = vi.fn();
    const props = {
      value: '{"enabled": true}',
      diagnostics: [],
      disabled: false,
      ariaLabel: 'Context menu JSON',
      loadingLabel: 'Loading JSON editor…',
      onChange: vi.fn(),
    };
    const view = render(JsonCodeEditor, { props });

    const content = await screen.findByLabelText('Context menu JSON');
    await fireEvent.contextMenu(content, { clientX: 30, clientY: 30 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Select all/ })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /Format/ })).toBeNull();

    await fireEvent.keyDown(menu, { key: 'Escape' });
    await view.rerender({ ...props, onFormat });
    await fireEvent.contextMenu(content, { clientX: 30, clientY: 30 });
    const formatItem = await screen.findByRole('menuitem', { name: /Format/ });
    await fireEvent.click(formatItem);
    expect(onFormat).toHaveBeenCalledTimes(1);

    await fireEvent.keyDown(content, { key: 'F', shiftKey: true, altKey: true });
    expect(onFormat).toHaveBeenCalledTimes(2);
  });
});
