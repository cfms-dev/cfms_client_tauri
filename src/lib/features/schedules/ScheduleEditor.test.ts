// @vitest-environment jsdom

import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue, ScheduledTaskType } from '$lib/api';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
import ScheduleEditor from '$lib/features/schedules/ScheduleEditor.svelte';

const lockdownSchema: Record<string, JsonValue> = {
  additionalProperties: false,
  properties: {
    duration_seconds: {
      exclusiveMinimum: 0,
      title: 'Duration Seconds',
      type: 'integer',
    },
    reason: {
      anyOf: [{ minLength: 1, type: 'string' }, { type: 'null' }],
      default: null,
      title: 'Reason',
    },
  },
  required: ['duration_seconds'],
  type: 'object',
};

function taskType(
  name: string,
  payloadSchema: Record<string, JsonValue> = lockdownSchema,
): ScheduledTaskType {
  return {
    name,
    contract_version: 1,
    required_permission: 'manage_system',
    payload_schema: payloadSchema,
    max_attempts: 3,
  };
}

beforeEach(() => {
  locale.set('en');
  if (dialogStore.current) dialogStore.resolve(false);
});

afterEach(() => {
  if (dialogStore.current) dialogStore.resolve(false);
  cleanup();
  vi.clearAllMocks();
});

describe('ScheduleEditor payload modes', () => {
  it('keeps focus when the first character initializes a required payload field', async () => {
    render(ScheduleEditor, {
      props: {
        taskTypes: [taskType('scheduled_lockdown.window')],
        onSave: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    const input = screen.getByLabelText(/Duration Seconds/) as HTMLInputElement;
    input.focus();

    await fireEvent.input(input, { target: { value: '6' } });

    expect(document.activeElement).toBe(input);
    expect(screen.getByLabelText(/Duration Seconds/)).toBe(input);
    expect(input.value).toBe('6');
  });

  it('creates a schema-valid payload through the guided form', async () => {
    const onSave = vi.fn();
    render(ScheduleEditor, {
      props: {
        taskTypes: [taskType('scheduled_lockdown.window')],
        onSave,
        onCancel: vi.fn(),
      },
    });

    expect(screen.queryByText('Contract v1')).toBeNull();
    expect(screen.queryByText('3 max attempts')).toBeNull();
    expect(screen.queryByText('manage_system')).toBeNull();
    expect(screen.queryByText(/Full client-side contract validation/)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Form' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('This field is explicitly set to null.')).toBeTruthy();
    await fireEvent.keyDown(screen.getByRole('tab', { name: 'Form' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'JSON' }).getAttribute('aria-selected')).toBe('true');
    await fireEvent.keyDown(screen.getByRole('tab', { name: 'JSON' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Form' }).getAttribute('aria-selected')).toBe('true');
    await fireEvent.input(screen.getByLabelText(/Duration Seconds/), { target: { value: '3600' } });

    const submit = screen.getByRole('button', { name: 'New schedule' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await fireEvent.click(submit);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      taskName: 'scheduled_lockdown.window',
      payload: { duration_seconds: 3600, reason: null },
    })));
  });

  it('switches a nullable field with a null default to an editable value', async () => {
    render(ScheduleEditor, {
      props: {
        taskTypes: [taskType('scheduled_lockdown.window')],
        onSave: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Use a value' }));

    const reason = screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
    expect(reason.value).toBe('');
    expect(screen.queryByText('This field is explicitly set to null.')).toBeNull();
  });

  it('uses JSON mode when the schema cannot be represented without loss', async () => {
    render(ScheduleEditor, {
      props: {
        taskTypes: [taskType('extension.choice', {
          properties: {
            destination: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          },
          type: 'object',
        })],
        onSave: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await waitFor(() => expect(screen.getByRole('tab', { name: 'JSON' }).getAttribute('aria-selected')).toBe('true'));
    expect((screen.getByRole('tab', { name: 'Form' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not available in the guided form/)).toBeTruthy();
  });

  it('confirms before discarding a changed payload on task switch', async () => {
    render(ScheduleEditor, {
      props: {
        taskTypes: [
          taskType('scheduled_lockdown.window'),
          taskType('extension.empty', { additionalProperties: false, properties: {}, type: 'object' }),
        ],
        onSave: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await fireEvent.input(screen.getByLabelText(/Duration Seconds/), { target: { value: '60' } });
    const select = screen.getByLabelText('Task type') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'extension.empty' } });

    await waitFor(() => expect(dialogStore.current?.title).toBe('Change task type?'));
    dialogStore.resolve(false);
    await waitFor(() => expect(select.value).toBe('scheduled_lockdown.window'));

    await fireEvent.change(select, { target: { value: 'extension.empty' } });
    await waitFor(() => expect(dialogStore.current?.title).toBe('Change task type?'));
    dialogStore.resolve(true);
    await waitFor(() => expect(select.value).toBe('extension.empty'));
    expect(screen.getByText('This task has no configurable payload fields.')).toBeTruthy();
  });
});
