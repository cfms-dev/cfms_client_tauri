import type { IconName } from "$lib/icons";

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptDialogOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  maxLength?: number;
  inputType?: string;
  selectOnOpen?: boolean;
}

export interface ChoiceDialogOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  intent?: "primary" | "neutral" | "danger";
}

export interface ChoiceDialogDetail {
  label: string;
  meta?: string;
  badge?: string;
  kind?: "file" | "directory";
}

export interface ChoiceDialogOptions<T extends string = string> {
  title?: string;
  message: string;
  choices: ChoiceDialogOption<T>[];
  details?: ChoiceDialogDetail[];
  detailLabel?: string;
  applyToAllLabel?: string;
  cancelLabel?: string;
}

export interface ChoiceDialogResult<T extends string = string> {
  value: T;
  applyToAll: boolean;
}

type DialogKind = "confirm" | "prompt" | "choice";

export interface DialogRequest {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  defaultValue: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  multiline: boolean;
  maxLength?: number;
  inputType: string;
  selectOnOpen: boolean;
  choices: ChoiceDialogOption[];
  details: ChoiceDialogDetail[];
  detailLabel: string;
  applyToAllLabel: string;
  resolve: (value: boolean | string | ChoiceDialogResult | null) => void;
}

class DialogStoreImpl {
  current = $state<DialogRequest | null>(null);
  private queue: DialogRequest[] = [];
  private nextId = 1;

  confirm(options: ConfirmDialogOptions | string): Promise<boolean> {
    const normalized: ConfirmDialogOptions =
      typeof options === "string" ? { message: options } : options;

    return new Promise((resolve) => {
      this.enqueue({
        id: this.nextId++,
        kind: "confirm",
        title: normalized.title ?? "Confirm",
        message: normalized.message,
        defaultValue: "",
        placeholder: "",
        confirmLabel: normalized.confirmLabel ?? "OK",
        cancelLabel: normalized.cancelLabel ?? "Cancel",
        danger: normalized.danger ?? false,
        multiline: false,
        maxLength: undefined,
        inputType: "text",
        selectOnOpen: false,
        choices: [],
        details: [],
        detailLabel: "",
        applyToAllLabel: "",
        resolve: (value) => resolve(value === true),
      });
    });
  }

  prompt(options: PromptDialogOptions | string, defaultValue = ""): Promise<string | null> {
    const normalized: PromptDialogOptions =
      typeof options === "string" ? { message: options, defaultValue } : options;

    return new Promise((resolve) => {
      this.enqueue({
        id: this.nextId++,
        kind: "prompt",
        title: normalized.title ?? "Input",
        message: normalized.message,
        defaultValue: normalized.defaultValue ?? defaultValue,
        placeholder: normalized.placeholder ?? "",
        confirmLabel: normalized.confirmLabel ?? "OK",
        cancelLabel: normalized.cancelLabel ?? "Cancel",
        danger: false,
        multiline: normalized.multiline ?? false,
        maxLength: normalized.maxLength,
        inputType: normalized.inputType ?? "text",
        selectOnOpen: normalized.selectOnOpen ?? false,
        choices: [],
        details: [],
        detailLabel: "",
        applyToAllLabel: "",
        resolve: (value) => resolve(typeof value === "string" ? value : null),
      });
    });
  }

  choose<T extends string>(options: ChoiceDialogOptions<T>): Promise<ChoiceDialogResult<T> | null> {
    return new Promise((resolve) => {
      this.enqueue({
        id: this.nextId++,
        kind: "choice",
        title: options.title ?? "Choose an action",
        message: options.message,
        defaultValue: "",
        placeholder: "",
        confirmLabel: "",
        cancelLabel: options.cancelLabel ?? "Cancel",
        danger: false,
        multiline: false,
        maxLength: undefined,
        inputType: "text",
        selectOnOpen: false,
        choices: options.choices,
        details: options.details ?? [],
        detailLabel: options.detailLabel ?? "",
        applyToAllLabel: options.applyToAllLabel ?? "",
        resolve: (value) => resolve(
          value && typeof value === "object"
            ? value as ChoiceDialogResult<T>
            : null,
        ),
      });
    });
  }

  resolve(value: boolean | string | ChoiceDialogResult | null) {
    const request = this.current;
    if (!request) return;
    this.current = null;
    request.resolve(value);
    this.showNext();
  }

  private enqueue(request: DialogRequest) {
    this.queue.push(request);
    if (!this.current) this.showNext();
  }

  private showNext() {
    if (this.current || this.queue.length === 0) return;
    this.current = this.queue.shift() ?? null;
  }
}

export const dialogStore = new DialogStoreImpl();
