//! Persistent SQLite database layer.
//!
//! Manages the application database — schema migration, download task CRUD,
//! and user settings key-value storage.

pub mod schema;
pub mod tasks;

mod migrate;

pub use migrate::open;
