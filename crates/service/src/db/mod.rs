//! Persistent SQLite database layer.
//!
//! Manages the application database — schema migration and user settings
//! key-value storage.  Download task metadata is stored in per-user
//! encrypted JSON files (see [`crate::services::task_persistence`]).

pub mod schema;
pub mod settings;

mod migrate;

pub use migrate::open;
