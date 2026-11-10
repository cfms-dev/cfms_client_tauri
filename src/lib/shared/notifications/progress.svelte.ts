
export interface FloatingProgressEntry {
  id: string;
  title: string;
  text: string;
  current: number;
  total: number;
  createdAt: number;
}

class FloatingProgressStoreImpl {
  entries = $state<FloatingProgressEntry[]>([]);

  upsert(id: string, title: string, text: string, current: number, total: number) {
    const existing = this.entries.find((entry) => entry.id === id);
    const next: FloatingProgressEntry = {
      id,
      title,
      text,
      current,
      total,
      createdAt: existing?.createdAt ?? Date.now(),
    };

    this.entries = [
      next,
      ...this.entries.filter((entry) => entry.id !== id),
    ];
  }

  remove(id: string) {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  clear() {
    this.entries = [];
  }
}

export const floatingProgressStore = new FloatingProgressStoreImpl();
