
export type NotificationType = "info" | "success" | "warning" | "error";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationEntry {
  id: number;
  type: NotificationType;
  text: string;
  createdAt: number;
  timeoutMs: number | null;
  groupKey?: string;
  groupTitle?: string;
  action?: NotificationAction;
  items: Array<{ text: string; createdAt: number }>;
}

export interface NotificationOptions {
  groupKey?: string;
  groupTitle?: string;
  action?: NotificationAction;
  itemText?: string;
  summaryText?: (count: number, latestText: string) => string;
}

class NotificationStoreImpl {
  entries = $state<NotificationEntry[]>([]);
  private nextId = 1;

  push(
    type: NotificationType,
    text: string,
    timeoutMs = 7000,
    options: NotificationOptions = {},
  ) {
    if (options.groupKey) {
      const existing = this.entries.find(
        (entry) => entry.groupKey === options.groupKey && entry.type === type,
      );
      if (existing) {
        const now = Date.now();
        const itemText = options.itemText ?? text;
        const items = [...existing.items, { text: itemText, createdAt: now }].slice(-20);
        const next: NotificationEntry = {
          ...existing,
          text: options.summaryText?.(items.length, itemText) ?? text,
          groupTitle: options.groupTitle ?? existing.groupTitle,
          action: options.action ?? existing.action,
          items,
          createdAt: now,
          timeoutMs: timeoutMs > 0 ? timeoutMs : null,
        };
        this.entries = [next, ...this.entries.filter((entry) => entry.id !== existing.id)];
        return existing.id;
      }
    }

    const entry: NotificationEntry = {
      id: this.nextId++,
      type,
      text,
      createdAt: Date.now(),
      timeoutMs: timeoutMs > 0 ? timeoutMs : null,
      groupKey: options.groupKey,
      groupTitle: options.groupTitle,
      action: options.action,
      items: [{ text: options.itemText ?? text, createdAt: Date.now() }],
    };
    this.entries = [entry, ...this.entries].slice(0, 5);
    return entry.id;
  }

  info(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("info", text, timeoutMs, options);
  }

  success(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("success", text, timeoutMs, options);
  }

  warning(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("warning", text, timeoutMs, options);
  }

  error(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("error", text, timeoutMs, options);
  }

  remove(id: number) {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  clear() {
    this.entries = [];
  }
}

export const notificationStore = new NotificationStoreImpl();
