import type { AccessEntry } from '$lib/api';

export interface AccessPrincipal {
  type: string;
  name: string;
}

function splitPrincipal(type: string | null | undefined, identifier: string | null | undefined): AccessPrincipal {
  const rawType = String(type ?? '').trim();
  const rawIdentifier = String(identifier ?? '').trim();

  const separatorIndex = rawType.indexOf(':');
  if (separatorIndex >= 0) {
    return {
      type: rawType.slice(0, separatorIndex).trim(),
      name: rawIdentifier || rawType.slice(separatorIndex + 1).trim(),
    };
  }

  if (rawIdentifier) {
    return {
      type: rawType,
      name: rawIdentifier,
    };
  }

  return {
    type: rawType,
    name: rawIdentifier,
  };
}

export function accessEntrySubject(entry: AccessEntry): AccessPrincipal {
  return splitPrincipal(entry.entity_type, entry.entity_identifier);
}
