export interface FilterOptionLabels {
  search: string;
  searchPlaceholder: string;
  clearSearch: string;
  options: string;
  noMatches: string;
  noSuggestions: string;
  addCustom?: string;
}

export interface FilterLabels extends FilterOptionLabels {
  label: string;
  button: string;
  title: string;
  help: string;
  selected: (count: number) => string;
  apply: string;
}

export function normalizeFilterOptions(options: readonly string[]): string[] {
  return [...new Set(options.map((option) => option.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
