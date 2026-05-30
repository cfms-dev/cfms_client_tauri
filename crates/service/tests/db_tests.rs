//! Integration tests for the persistent database layer.
//!
//! Each test uses a temporary in-memory database so tests are isolated
//! and fast.

use cfms_core::{DownloadTaskDto, DownloadTaskStatus};
use cfms_service::db::tasks::TaskStore;
use rusqlite::Connection;

fn new_store() -> TaskStore {
    let db = Connection::open_in_memory().expect("open in-memory db");
    db.execute_batch(cfms_service::db::schema::SCHEMA_V1)
        .expect("run schema v1");
    TaskStore::new(db)
}

fn make_task(id: &str, status: DownloadTaskStatus) -> DownloadTaskDto {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    DownloadTaskDto {
        task_id: id.into(),
        file_id: format!("file_{id}"),
        filename: format!("{id}.bin"),
        file_path: format!("/downloads/{id}.bin"),
        status,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 1024 * 1024,
        error: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
    }
}

// ---------------------------------------------------------------------------
// CRUD tests
// ---------------------------------------------------------------------------

#[test]
fn insert_and_get_task() {
    let store = new_store();
    let task = make_task("task-001", DownloadTaskStatus::Pending);
    store.insert(&task).expect("insert");
    let got = store.get("task-001").expect("get").expect("exists");
    assert_eq!(got.task_id, "task-001");
    assert_eq!(got.status, DownloadTaskStatus::Pending);
    assert_eq!(got.filename, "task-001.bin");
}

#[test]
fn get_nonexistent_task() {
    let store = new_store();
    let got = store.get("no-such-task").expect("get");
    assert!(got.is_none());
}

#[test]
fn list_tasks_by_status() {
    let store = new_store();
    store.insert(&make_task("t1", DownloadTaskStatus::Pending)).unwrap();
    store.insert(&make_task("t2", DownloadTaskStatus::Completed)).unwrap();
    store.insert(&make_task("t3", DownloadTaskStatus::Failed)).unwrap();
    store.insert(&make_task("t4", DownloadTaskStatus::Pending)).unwrap();

    let pending = store.list_by_status(DownloadTaskStatus::Pending).unwrap();
    assert_eq!(pending.len(), 2);

    let completed = store.list_by_status(DownloadTaskStatus::Completed).unwrap();
    assert_eq!(completed.len(), 1);

    let all = store.list(None).unwrap();
    assert_eq!(all.len(), 4);
}

#[test]
fn update_status() {
    let store = new_store();
    store.insert(&make_task("task-001", DownloadTaskStatus::Pending)).unwrap();

    store.update_status("task-001", DownloadTaskStatus::Downloading).unwrap();
    let task = store.get("task-001").unwrap().unwrap();
    assert_eq!(task.status, DownloadTaskStatus::Downloading);

    store.update_status("task-001", DownloadTaskStatus::Completed).unwrap();
    let task = store.get("task-001").unwrap().unwrap();
    assert_eq!(task.status, DownloadTaskStatus::Completed);
}

#[test]
fn mark_started_and_completed() {
    let store = new_store();
    store.insert(&make_task("task-001", DownloadTaskStatus::Pending)).unwrap();

    store.mark_started("task-001").unwrap();
    let task = store.get("task-001").unwrap().unwrap();
    assert_eq!(task.status, DownloadTaskStatus::Downloading);
    assert!(task.started_at.is_some());

    store.mark_completed("task-001", 1024 * 1024).unwrap();
    let task = store.get("task-001").unwrap().unwrap();
    assert_eq!(task.status, DownloadTaskStatus::Completed);
    assert!(task.completed_at.is_some());
    assert_eq!(task.progress, 1.0);
    assert_eq!(task.current_bytes, 1024 * 1024);
}

#[test]
fn mark_failed() {
    let store = new_store();
    store.insert(&make_task("task-001", DownloadTaskStatus::Downloading)).unwrap();

    store.mark_failed("task-001", "connection reset").unwrap();
    let task = store.get("task-001").unwrap().unwrap();
    assert_eq!(task.status, DownloadTaskStatus::Failed);
    assert_eq!(task.error.as_deref(), Some("connection reset"));
    assert!(task.completed_at.is_some());
}

#[test]
fn delete_task() {
    let store = new_store();
    store.insert(&make_task("task-001", DownloadTaskStatus::Failed)).unwrap();
    assert!(store.get("task-001").unwrap().is_some());

    store.delete("task-001").unwrap();
    assert!(store.get("task-001").unwrap().is_none());
}

// ---------------------------------------------------------------------------
// State machine tests
// ---------------------------------------------------------------------------

#[test]
fn retry_or_fail_retries() {
    let store = new_store();
    let mut task = make_task("task-001", DownloadTaskStatus::Downloading);
    task.retry_count = 0;
    task.max_retries = 3;
    store.insert(&task).unwrap();

    // First retry: should go back to Pending.
    let status = store.retry_or_fail("task-001", "timeout").unwrap();
    assert_eq!(status, DownloadTaskStatus::Pending);

    let t = store.get("task-001").unwrap().unwrap();
    assert_eq!(t.retry_count, 1);
    assert_eq!(t.status, DownloadTaskStatus::Pending);
}

#[test]
fn retry_or_fail_exhausted() {
    let store = new_store();
    let mut task = make_task("task-001", DownloadTaskStatus::Downloading);
    task.retry_count = 3; // already at max
    task.max_retries = 3;
    store.insert(&task).unwrap();

    let status = store.retry_or_fail("task-001", "timeout").unwrap();
    assert_eq!(status, DownloadTaskStatus::Failed);

    let t = store.get("task-001").unwrap().unwrap();
    assert_eq!(t.retry_count, 4);
    assert_eq!(t.status, DownloadTaskStatus::Failed);
}

#[test]
fn reset_in_flight_recovery() {
    let store = new_store();
    store.insert(&make_task("t1", DownloadTaskStatus::Downloading)).unwrap();
    store.insert(&make_task("t2", DownloadTaskStatus::Decrypting)).unwrap();
    store.insert(&make_task("t3", DownloadTaskStatus::Verifying)).unwrap();
    store.insert(&make_task("t4", DownloadTaskStatus::Completed)).unwrap();
    store.insert(&make_task("t5", DownloadTaskStatus::Pending)).unwrap();

    let reset = store.reset_in_flight().unwrap();
    assert_eq!(reset, 3); // t1, t2, t3 reset

    // In-flight tasks now pending.
    for id in &["t1", "t2", "t3"] {
        let t = store.get(id).unwrap().unwrap();
        assert_eq!(t.status, DownloadTaskStatus::Pending);
    }

    // Non-in-flight tasks unchanged.
    let t4 = store.get("t4").unwrap().unwrap();
    assert_eq!(t4.status, DownloadTaskStatus::Completed);
    let t5 = store.get("t5").unwrap().unwrap();
    assert_eq!(t5.status, DownloadTaskStatus::Pending);
}

// ---------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------

#[test]
fn promote_scheduled_tasks() {
    let store = new_store();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut past = make_task("t1", DownloadTaskStatus::Scheduled);
    past.scheduled_time = Some(now - 60); // 60s ago
    store.insert(&past).unwrap();

    let mut future = make_task("t2", DownloadTaskStatus::Scheduled);
    future.scheduled_time = Some(now + 3600); // 1h from now
    store.insert(&future).unwrap();

    let promoted = store.promote_scheduled().unwrap();
    assert_eq!(promoted, 1); // only t1

    let t1 = store.get("t1").unwrap().unwrap();
    assert_eq!(t1.status, DownloadTaskStatus::Pending);

    let t2 = store.get("t2").unwrap().unwrap();
    assert_eq!(t2.status, DownloadTaskStatus::Scheduled); // still scheduled
}

// ---------------------------------------------------------------------------
// Clear operations
// ---------------------------------------------------------------------------

#[test]
fn clear_completed_and_failed() {
    let store = new_store();
    store.insert(&make_task("t1", DownloadTaskStatus::Completed)).unwrap();
    store.insert(&make_task("t2", DownloadTaskStatus::Cancelled)).unwrap();
    store.insert(&make_task("t3", DownloadTaskStatus::Failed)).unwrap();
    store.insert(&make_task("t4", DownloadTaskStatus::Pending)).unwrap();

    let cleared = store.clear_completed().unwrap();
    assert_eq!(cleared, 2); // t1, t2
    assert!(store.get("t1").unwrap().is_none());
    assert!(store.get("t2").unwrap().is_none());
    assert!(store.get("t3").unwrap().is_some()); // still there
    assert!(store.get("t4").unwrap().is_some()); // still there

    let cleared = store.clear_failed().unwrap();
    assert_eq!(cleared, 1); // t3
    assert!(store.get("t3").unwrap().is_none());
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[test]
fn settings_roundtrip() {
    let store = new_store();
    assert!(store.get_setting("theme").unwrap().is_none());

    store.set_setting("theme", "dark").unwrap();
    assert_eq!(store.get_setting("theme").unwrap().as_deref(), Some("dark"));

    store.set_setting("theme", "light").unwrap();
    assert_eq!(store.get_setting("theme").unwrap().as_deref(), Some("light"));
}

#[test]
fn settings_multiple_keys() {
    let store = new_store();
    store.set_setting("lang", r#""zh_CN""#).unwrap();
    store.set_setting("proxy", r#"{"host":"localhost","port":1080}"#).unwrap();

    assert_eq!(store.get_setting("lang").unwrap().as_deref(), Some(r#""zh_CN""#));
    assert_eq!(
        store.get_setting("proxy").unwrap().as_deref(),
        Some(r#"{"host":"localhost","port":1080}"#)
    );
}
