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
  inputType?: string;
  selectOnOpen?: boolean;
}

type DialogKind = "confirm" | "prompt";

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
  inputType: string;
  selectOnOpen: boolean;
  resolve: (value: boolean | string | null) => void;
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
        inputType: "text",
        selectOnOpen: false,
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
        inputType: normalized.inputType ?? "text",
        selectOnOpen: normalized.selectOnOpen ?? false,
        resolve: (value) => resolve(typeof value === "string" ? value : null),
      });
    });
  }

  resolve(value: boolean | string | null) {
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
