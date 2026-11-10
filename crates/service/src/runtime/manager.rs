//! Service manager — manages the lifecycle of background Tokio tasks
//! (services).
//!
//! # Design
//!
//! Each service is an async function that receives a
//! [`tokio::sync::watch::Receiver<bool>`] for shutdown notification.  The
//! manager holds a [`tokio::sync::watch::Sender<bool>`] — when dropped or
//! explicitly sent, all receivers are notified and services stop cleanly.
//!
//! Services are registered in two phases:
//!
//! 1. **Register** — call [`ServiceManager::register`] with a factory
//!    closure.  No Tokio context is needed at this stage.
//! 2. **Activate** — call [`ServiceManager::activate`] from within an async
//!    Tokio context.  This spawns all registered services as Tokio tasks.
//!
//! This split exists because Tauri's `setup()` callback runs synchronously
//! outside the Tokio runtime.  Activation is deferred until the runtime
//! is available.
//!
//! ```text
//! ServiceManager
//!  ├── shutdown_tx ──► rx_1 ──► TokenRefreshService (owns its loop)
//!  │                   rx_2 ──► FavoritesValidation (owns its loop)
//!  │                   rx_3 ──► ServerPushService (owns its loop)
//!  │                   rx_4 ──► DownloadQueue (owns its loop)
//!  └── handles: Vec<JoinHandle<()>>
//! ```

use std::future::Future;
use std::time::Duration;

use tokio::sync::watch;
use tokio::task::JoinHandle;

/// A boxed factory that, when called, spawns a service task and returns
/// its join handle.
type ServiceFactory = Box<dyn FnOnce() -> JoinHandle<()> + Send>;

/// Manages a collection of background services.
pub struct ServiceManager {
    /// The sending half — drop this to signal shutdown to all services.
    shutdown_tx: watch::Sender<bool>,
    /// Factories for services that have been registered but not yet activated.
    pending: Vec<ServiceFactory>,
    /// Join handles for activated services.
    handles: Vec<JoinHandle<()>>,
}

impl ServiceManager {
    /// Create a new service manager with no registered services.
    pub fn new() -> Self {
        let (shutdown_tx, _) = watch::channel(false);
        Self {
            shutdown_tx,
            pending: Vec::new(),
            handles: Vec::new(),
        }
    }

    /// Register a service (without spawning it yet).
    ///
    /// The closure `f` receives a [`watch::Receiver<bool>`] for shutdown
    /// notification and should run its own internal loop until the receiver
    /// signals shutdown.
    ///
    /// This method **does not** require a Tokio runtime context.  Call
    /// [`activate`](Self::activate) afterwards to spawn all registered
    /// services.
    pub fn register<F, Fut>(&mut self, _name: &str, f: F)
    where
        F: FnOnce(watch::Receiver<bool>) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let rx = self.shutdown_tx.subscribe();
        // Box the factory — it will be called inside activate().
        self.pending.push(Box::new(move || {
            tokio::spawn(async move {
                f(rx).await;
            })
        }));
    }

    /// Returns `true` if all registered services have been activated (i.e.
    /// [`activate`](Self::activate) has already been called and the pending
    /// queue is empty).
    pub fn is_active(&self) -> bool {
        self.pending.is_empty()
    }

    /// Spawn all previously registered services.
    ///
    /// **Must be called from within a Tokio runtime context** (e.g. inside
    /// `tauri::async_runtime::spawn()` or `tokio::spawn()`).
    ///
    /// Calling this a second time after all services are already activated is
    /// a safe no-op (the pending queue is empty at that point).
    pub fn activate(&mut self) {
        for factory in self.pending.drain(..) {
            self.handles.push(factory());
        }
    }

    /// Signal all services to shut down and wait for them to finish.
    ///
    /// Gives each service up to `timeout` to clean up.  Returns `true` if
    /// all services exited within the timeout.
    pub async fn shutdown(self, timeout: Duration) -> bool {
        // Signal all services by dropping the sender.
        drop(self.shutdown_tx);

        let mut all_ok = true;
        for handle in self.handles {
            match tokio::time::timeout(timeout, handle).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    tracing::error!("Service task panicked: {e}");
                    all_ok = false;
                }
                Err(_) => {
                    tracing::warn!("Service did not shut down within {:?}", timeout);
                    all_ok = false;
                }
            }
        }
        all_ok
    }
}

impl Default for ServiceManager {
    fn default() -> Self {
        Self::new()
    }
}
