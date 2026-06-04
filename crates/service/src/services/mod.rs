//! Background service implementations.
//!
//! Each module exports a `run_*` async function that receives shared state and
//! a shutdown signal, and runs its periodic loop until shutdown.

pub mod download_queue;
pub mod favorites;
pub mod lockdown;
pub mod task_persistence;
pub mod token_refresh;
