# Protocol 31 client adaptation

The client accepts protocol 31 only. Upgrade it together with the server; protocol
30 connections are rejected by the existing version check. Application release
versions and local/database storage formats are unchanged.

`view_audit_logs` forwards `filters` and `exclude_filters` to `core.audit.entry.list`.
The server applies inclusion and exclusion before cursor pagination. Both lists
are repeated on every page; changes reset the view to page one. Unknown and
historical actions remain exact values with no aliases or wildcards.

The management workspace uses separate include/exclude drafts in one filter
popover. Initial exclusions are `core.audit.entry.list` and `core.setting.get`.
Defaults are client-only and last for the current management view. Clearing all
filters shows every action; restoring defaults explicitly reinstates exclusions.
Adding an action to either list removes it from the other. Cancelling discards all
drafts, and applying submits both lists together. Active exclusions remain visible.

See the server `docs/PROTOCOL_31_MIGRATION.md` and `docs/AUDIT_LOG_API.md` for the wire
contract. Protocol 30 functionality documented in `protocol-30.md` is retained.
