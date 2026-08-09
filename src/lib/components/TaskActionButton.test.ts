import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import TaskActionButton from './TaskActionButton.svelte';

describe('TaskActionButton', () => {
  it('uses an accessible tooltip label for compact icon actions', async () => {
    const onclick = vi.fn();
    render(TaskActionButton, { icon: 'pause', label: 'Pause', onclick });

    const button = screen.getByRole('button', { name: 'Pause' });
    expect(button.getAttribute('title')).toBe('Pause');
    expect(button.textContent).not.toContain('Pause');
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('shows both icon and text for labelled actions', () => {
    render(TaskActionButton, {
      icon: 'delete', label: 'Delete file', presentation: 'labelled', tone: 'danger',
    });

    expect(screen.getByRole('button', { name: 'Delete file' })).toBeTruthy();
    expect(screen.getByText('Delete file')).toBeTruthy();
  });
});
