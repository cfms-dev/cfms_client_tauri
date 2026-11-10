//! IPC adapters grouped by business capability.
//!
//! Commands declare their dependencies explicitly. Business rules that do not
//! need Tauri live in `cfms-service`; platform effects stay in this crate.

pub(crate) mod admin;
pub(crate) mod auth_connection;
pub(crate) mod authentication;
pub(crate) mod avatars;
pub(crate) mod browsing;
pub(crate) mod connection_config;
pub(crate) mod connection_types;
pub(crate) mod developer;
pub(crate) mod documents;
pub(crate) mod downloads;
mod github_api;
pub(crate) mod github_credentials;
pub(crate) mod health;
pub(crate) mod local_data_reset;
pub(crate) mod mobile;
pub(crate) mod mobile_types;
pub(crate) mod passkeys;
pub(crate) mod preference_keys;
pub(crate) mod preferences;
pub(crate) mod public_key_auth;
pub(crate) mod schedules;
pub(crate) mod settings;
mod shared_helpers;
pub(crate) mod task_reload;
mod transfer_helpers;
pub(crate) mod transfer_types;
pub(crate) mod update_types;
pub(crate) mod updates;
pub(crate) mod upload_tasks;

pub(crate) mod registry;

mod server_actions;
mod session;
