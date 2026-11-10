

// ---------------------------------------------------------------------------
// Enums (matching Rust repr)
// ---------------------------------------------------------------------------

export type JsonPrimitive = null | boolean | number | string;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ServerResponse<T = JsonValue> {
  code: number;
  message: string;
  data: T;
  timestamp: number;
}

export interface CursorPageMeta {
  page_size: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface CursorPage<T> extends CursorPageMeta {
  items: T[];
}
