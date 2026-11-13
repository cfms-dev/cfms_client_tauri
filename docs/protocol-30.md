# Protocol 30 client adaptation

The client accepts protocol 30 only. The reference contract is the local
`cfms_on_websocket` implementation investigated at commit `1262924`.

## Account names and permissions

- Nickname writes use `core.user.nickname.set`; the removed `core.user.rename`
  action has no fallback. Existing nickname trimming and clearing behavior stays.
- Username writes use `core.user.username.set` with a UUID selector and an elevated
  token. Usernames contain 1–64 Unicode characters, with whitespace and case
  preserved through editing and both password and public-key login.
- Self-service requires `set_username` or `set_nickname`; the corresponding
  `super_` permissions authorize other accounts and the caller's account.
- `manage_system` grants no client capability. Settings discovery/reads require
  `view_settings`, while writes independently require `manage_settings`.

Successful self-renaming keeps tokens, DEK, account UUID and active transfers.
Authenticated profile refreshes synchronize names changed on other devices.
Session identity guards and local storage scopes use server plus UUID, so a
rename does not become an account switch.

## Local data import

Encrypted preferences and upload/download records now live below
`{kind}/accounts/{server_hash}/{user_id_hash}.json`. After authentication and DEK
unlock, the client validates the known username's old files before importing them
with atomic, non-overwriting writes. Existing UUID files win. Original files are
removed only after their replacements are published. An import marker prevents
later username changes from importing another account's old files.

Failed imports retain their sources and use the existing local-data recovery
flow. Explicitly starting fresh prevents further imports for that UUID while
leaving unowned historical sources untouched. Unknown old usernames are not
searched or inferred. Older plaintext, username-scoped recent-visit caches are
left untouched; current encrypted recent visits migrate with preferences.

Avatar images use UUID cache locations. Username indexes exist only for login
previews; known renames remove the old index without removing the account image.

## Server settings

The management workspace exposes the server's setting metadata and JSON Schemas,
with scalar form controls and JSON editing for composite or unsupported forms.
The client saves only edited keys in one namespace with their read revisions.
Defaults are staged like other edits. Server aggregate validation remains
authoritative.

Writes are sent once. A lost response is unconfirmed and requires a fresh read.
Revision conflicts preserve the draft and require review of current values;
refreshing or leaving with edits requires confirmation. Settings are not cached
across account or server changes.
