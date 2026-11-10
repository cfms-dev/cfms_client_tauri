import type { ListDirectoryPageResponse } from '$lib/api';

/** Fresh wire-shaped data; each scenario supplies only its relevant fields. */
export function directoryPage(overrides: Partial<ListDirectoryPageResponse> = {}): ListDirectoryPageResponse {
  return {
    folders: [], documents: [], parent_id: null, page_size: 128,
    next_cursor: null, has_more: false, ...overrides,
  };
}
