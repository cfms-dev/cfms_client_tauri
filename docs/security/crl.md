# CFMS certificate revocation checking

CFMS server connections check CA-signed certificate revocation lists (CRLs)
after authenticated TLS and before the WebSocket upgrade. The main connection,
automatic reconnects and dedicated upload/download connections use the same gate.
No account token or file request is sent before this check. An mTLS certificate
exchange, when configured, is part of the preceding TLS handshake.

The policy is **best effort**. Authenticated, applicable revocation evidence
blocks a connection. Missing distribution points, unsupported CRLs, download
failures and expired evidence allow the connection with a persistent warning.
They never produce a “checked” result. Ordinary chain, hostname and certificate
validity failures still block TLS. Disabling certificate verification, existing
loopback exemptions and plaintext connections show “skipped”.

Current CRLs must cover the selected path's leaf and intermediates to produce a
checked result. Trust anchors remain managed by the CA store. The checker
validates issuer signatures, signing permissions, distribution scope, issue and
expiry times. It supports complete direct CRLs and supported distribution-point
partitions; delta, indirect and reason-partitioned CRLs are unsupported. Invalid
lists cannot hide another valid list's positive revocation evidence.

The shared service caches raw signed CRLs and metadata in the app cache's `crl`
directory. Evidence is revalidated when used. Per-issuer-key/scope high-water
marks reject previously observed version rollback, including across restarts.
Downloads for the same issuer and URL are coalesced. Memory and disk CRL caches
are each bounded at 128 MiB with least-recently-used eviction. Cached CRLs are
refetched at most 15 minutes after acquisition or at expiry if earlier. Active
connections are reviewed at least once per minute while the process runs;
foreground restoration wakes the monitors. Failed retrievals back off for five
minutes while retaining any still-valid cached evidence. Positive revocation
evidence stays blocking for that leaf until certificate expiry, even after a
later network failure. Long connections then close and stop business traffic.

CRL retrieval uses HTTP/1.1 with a 5-second request timeout, a 10-second check
budget, a 32 MiB response limit and four concurrent requests. Redirects and
content encodings are refused. No application token, GitHub credential or
client mTLS identity is sent to distribution points. HTTP(S) and SOCKS proxies
are supported without fallback to a direct connection. DNS answers are checked
and the tunnel targets the vetted IP; HTTP Host and HTTPS SNI retain the
certificate's distribution host. HTTPS checks use public roots plus configured
CFMS roots without recursively fetching CRLs.

Private, loopback, link-local and other special addresses are blocked by
default. **Connection → Allowed private CRL hosts** authorizes exact hostnames or
IP addresses only; it does not authorize wildcard domains, arbitrary URLs or
ports. Changing the list wakes active monitors and resets failed-fetch backoff.
Only allow CA distribution hosts whose access to the local network you trust.

The connection screen explains that revocation checking will be skipped when
SSL verification is disabled with the switch. The login screen and account
menu continue to warn when revocation status is unknown, but do not repeat
skipped-check warnings. Connection settings retain the full actual status,
including skipped checks, check time and CRL expiry. Events carry a connection
ID so an old connection cannot overwrite a new connection's security status.

Best effort checks can be bypassed by blocking CRL availability, and newly
published revocations are subject to CA/CDN publication schedules and device
suspension. This is not real-time revocation protection. OCSP, CRLite, update
services and the outer TLS connection to an HTTPS proxy are outside this
feature's scope. The TLS handshake gate does not replace CA-store updates.

Deterministic coverage is in `crates/transport/src/crl_tests.rs` and the CRL
fetcher tests. They use generated local CAs and loopback HTTP/TLS/proxy fixtures;
they require no public revocation-testing site. Frontend component and event
tests cover translated warnings and stale connection updates.
