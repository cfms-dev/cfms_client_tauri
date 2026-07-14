export interface ParsedServerAddress {
  /** Trimmed host-and-port authority, ready to be prefixed with `wss://`. */
  address: string;
  /** Host without IPv6 square brackets, serialized using URL/IDNA rules. */
  host: string;
  port: number;
}

const DECIMAL_PORT = /^\d+$/;
const DECIMAL_IPV4_CANDIDATE = /^[\d.]+$/;
const IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function parseIpv4(host: string): boolean {
  const octets = host.split('.');
  return octets.length === 4
    && octets.every((octet) => (
      IPV4_OCTET.test(octet) && Number(octet) <= 255
    ));
}

function parseHostAndPort(address: string): { rawHost: string; port: number } | null {
  let rawHost: string;
  let rawPort: string;

  if (address.startsWith('[')) {
    const closingBracket = address.indexOf(']');
    if (closingBracket <= 1 || address[closingBracket + 1] !== ':') return null;
    if (address.indexOf('[', 1) !== -1 || address.indexOf(']', closingBracket + 1) !== -1) return null;

    rawHost = address.slice(0, closingBracket + 1);
    rawPort = address.slice(closingBracket + 2);
  } else {
    const separator = address.lastIndexOf(':');
    if (separator <= 0 || address.indexOf(':') !== separator) return null;

    rawHost = address.slice(0, separator);
    rawPort = address.slice(separator + 1);
  }

  if (!DECIMAL_PORT.test(rawPort)) return null;
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;

  return { rawHost, port };
}

/**
 * Parse the server field's strict `host:port` format.
 *
 * The host may be a DNS/IDNA name, a single-label local hostname, an IPv4
 * address, or a bracketed IPv6 address. Schemes, credentials, paths, queries,
 * fragments, empty ports, and URL-parser-specific legacy IPv4 forms are not
 * accepted because the connect screen supplies the WebSocket scheme itself.
 */
export function parseServerAddress(value: string): ParsedServerAddress | null {
  const address = value.trim();
  if (!address || /[\s/@?#\\]/u.test(address)) return null;

  const authority = parseHostAndPort(address);
  if (!authority) return null;

  let url: URL;
  try {
    url = new URL(`wss://${address}/`);
  } catch {
    return null;
  }

  let serializedHost = url.hostname;
  const isBracketedIpv6 = authority.rawHost.startsWith('[');
  if (isBracketedIpv6) {
    if (!serializedHost.startsWith('[') || !serializedHost.endsWith(']')) return null;
    serializedHost = serializedHost.slice(1, -1);
  } else {
    if (serializedHost.startsWith('[') || serializedHost.endsWith(']')) return null;

    if (DECIMAL_IPV4_CANDIDATE.test(authority.rawHost)) {
      // Reject shorthand, integer, octal, hexadecimal, and leading-zero IPv4
      // variants even though some WHATWG URL parsers normalize them.
      if (!parseIpv4(authority.rawHost)) return null;
    } else if (parseIpv4(serializedHost)) {
      // Unicode/full-width input must not silently turn into an IP address.
      return null;
    } else {
      const hostname = serializedHost.endsWith('.')
        ? serializedHost.slice(0, -1)
        : serializedHost;
      if (!hostname || hostname.length > 253) return null;
      if (!hostname.split('.').every((label) => HOST_LABEL.test(label))) return null;
    }
  }

  return {
    address,
    host: serializedHost,
    port: authority.port,
  };
}

export function isServerAddressValid(value: string): boolean {
  return parseServerAddress(value) !== null;
}
