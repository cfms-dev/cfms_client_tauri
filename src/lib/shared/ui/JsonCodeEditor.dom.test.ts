// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ICONS } from '$lib/shared/ui/icons';
import JsonCodeEditor from '$lib/shared/ui/JsonCodeEditor.svelte';

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
});
