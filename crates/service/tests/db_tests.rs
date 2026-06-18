//! Integration tests for the download task persistence layer.
//!
//! Tests the JSON file-based encrypted storage used by
//! `cfms_service::services::task_persistence`.

use std::collections::HashMap;

use cfms_core::{DownloadTaskDto, DownloadTaskStatus};
use cfms_crypto::{decrypt_config, generate_dek, is_encrypted};
use cfms_service::services::{download_queue, task_persistence};

// Type alias matching the JSON shape.
type TasksJson = HashMap<String, serde_json::Value>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn new_dek() -> [u8; 32] {
    *generate_dek()
}

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("create temp dir")
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
        message: None,
        error: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
        stage: 0,
        bandwidth_limit: None,
        pause_position: None,
        supports_resume: false,
        batch_id: None,
        batch_name: None,
        batch_root_id: None,
        batch_created_at: None,
        batch_estimated_total: None,
    }
}

// ---------------------------------------------------------------------------
// Basic round-trip
// ---------------------------------------------------------------------------

#[test]
fn save_and_load_empty() {
    let dir = temp_dir();
    let dek = new_dek();
    let tasks: Vec<DownloadTaskDto> = vec![];

    // Save empty list.
    task_persistence::save(dir.path(), "abc123", "testuser", Some(&dek), &tasks)
        .expect("save empty");

    // Load back.
    let loaded =
        task_persistence::load(dir.path(), "abc123", "testuser", Some(&dek)).expect("load empty");
    assert!(loaded.is_empty());
}

#[test]
fn save_and_load_tasks() {
    let dir = temp_dir();
    let dek = new_dek();

    let tasks = vec![
        make_task("task-001", DownloadTaskStatus::Pending),
        make_task("task-002", DownloadTaskStatus::Completed),
        make_task("task-003", DownloadTaskStatus::Failed),
    ];

    task_persistence::save(dir.path(), "abc123", "testuser", Some(&dek), &tasks).expect("save");

    let loaded =
        task_persistence::load(dir.path(), "abc123", "testuser", Some(&dek)).expect("load");

    assert_eq!(loaded.len(), 3);

    // Verify task data consistency.
    let by_id: HashMap<&str, &DownloadTaskDto> =
        loaded.iter().map(|t| (t.task_id.as_str(), t)).collect();

    assert_eq!(by_id["task-001"].status, DownloadTaskStatus::Pending);
    assert_eq!(by_id["task-002"].status, DownloadTaskStatus::Completed);
    assert_eq!(by_id["task-003"].status, DownloadTaskStatus::Failed);
    assert_eq!(by_id["task-001"].filename, "task-001.bin");
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

#[test]
fn output_is_encrypted() {
    let dir = temp_dir();
    let dek = new_dek();
    let tasks = vec![make_task("t1", DownloadTaskStatus::Pending)];

    task_persistence::save(dir.path(), "abc123", "testuser", Some(&dek), &tasks).expect("save");

    let path = task_persistence::file_path(dir.path(), "abc123", "testuser");
    let raw = std::fs::read(&path).expect("read file");

    assert!(is_encrypted(&raw), "persisted file should be encrypted");
}

#[test]
fn encrypted_file_can_be_decrypted_independently() {
    let dir = temp_dir();
    let dek = new_dek();
    let tasks = vec![
        make_task("t1", DownloadTaskStatus::Pending),
        make_task("t2", DownloadTaskStatus::Completed),
    ];

    task_persistence::save(dir.path(), "abc123", "testuser", Some(&dek), &tasks).expect("save");

    let path = task_persistence::file_path(dir.path(), "abc123", "testuser");
    let raw = std::fs::read(&path).expect("read file");

    // Decrypt manually.
    let plaintext = decrypt_config(&raw, &dek).expect("decrypt");
    let parsed: TasksJson = serde_json::from_slice(&plaintext).expect("parse json");

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed["t1"]["filename"].as_str().unwrap(), "t1.bin");
    assert_eq!(parsed["t2"]["status"].as_str().unwrap(), "completed");
}

// ---------------------------------------------------------------------------
// DEK not available
// ---------------------------------------------------------------------------

#[test]
fn load_returns_empty_when_dek_is_none() {
    let dir = temp_dir();
    let dek = new_dek();
    let tasks = vec![make_task("t1", DownloadTaskStatus::Pending)];

    // Save encrypted.
    task_persistence::save(dir.path(), "abc123", "testuser", Some(&dek), &tasks).expect("save");

    // Load without DEK → empty list (file exists but can't decrypt).
    let loaded =
        task_persistence::load(dir.path(), "abc123", "testuser", None).expect("load without dek");
    assert!(loaded.is_empty());
}

#[test]
fn load_returns_empty_when_file_missing() {
    let dir = temp_dir();
    let loaded =
        task_persistence::load(dir.path(), "abc123", "testuser", None).expect("load missing file");
    assert!(loaded.is_empty());
}

#[test]
fn save_without_dek_returns_error() {
    let dir = temp_dir();
    let tasks = vec![make_task("t1", DownloadTaskStatus::Pending)];

    let result = task_persistence::save(dir.path(), "abc123", "testuser", None, &tasks);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// Crash recovery (in-flight → pending)
// ---------------------------------------------------------------------------

#[test]
fn load_resets_downloading_to_pending() {
    let dir = temp_dir();
    let dek = new_dek();

    // Simulate a task that was mid-download when the app crashed.
    let tasks = vec![
        make_task("t1", DownloadTaskStatus::Downloading),
        make_task("t2", DownloadTaskStatus::Decrypting),
        make_task("t3", DownloadTaskStatus::Pending),
        make_task("t4", DownloadTaskStatus::Completed),
    ];

    task_persistence::save(dir.path(), "abc123", "testuser", Some(&dek), &tasks).expect("save");

    let loaded =
        task_persistence::load(dir.path(), "abc123", "testuser", Some(&dek)).expect("load");

    let by_id: HashMap<&str, &DownloadTaskDto> =
        loaded.iter().map(|t| (t.task_id.as_str(), t)).collect();

    // In-flight tasks reset to pending.
    assert_eq!(by_id["t1"].status, DownloadTaskStatus::Pending);
    assert_eq!(by_id["t2"].status, DownloadTaskStatus::Pending);

    // Non-in-flight tasks unchanged.
    assert_eq!(by_id["t3"].status, DownloadTaskStatus::Pending);
    assert_eq!(by_id["t4"].status, DownloadTaskStatus::Completed);

    // Started_at cleared for reset tasks.
    assert!(by_id["t1"].started_at.is_none());
}

// ---------------------------------------------------------------------------
// Per-user isolation
// ---------------------------------------------------------------------------

#[test]
fn different_users_have_separate_files() {
    let dir = temp_dir();
    let dek = new_dek();

    let tasks_alice = vec![make_task("a1", DownloadTaskStatus::Pending)];
    let tasks_bob = vec![make_task("b1", DownloadTaskStatus::Completed)];

    task_persistence::save(dir.path(), "abc123", "alice", Some(&dek), &tasks_alice)
        .expect("save alice");
    task_persistence::save(dir.path(), "abc123", "bob", Some(&dek), &tasks_bob).expect("save bob");

    let alice_loaded =
        task_persistence::load(dir.path(), "abc123", "alice", Some(&dek)).expect("load alice");
    let bob_loaded =
        task_persistence::load(dir.path(), "abc123", "bob", Some(&dek)).expect("load bob");

    assert_eq!(alice_loaded.len(), 1);
    assert_eq!(alice_loaded[0].task_id, "a1");

    assert_eq!(bob_loaded.len(), 1);
    assert_eq!(bob_loaded[0].task_id, "b1");
}

// ---------------------------------------------------------------------------
// Different servers are isolated
// ---------------------------------------------------------------------------

#[test]
fn different_servers_have_separate_files() {
    let dir = temp_dir();
    let dek = new_dek();

    let tasks_s1 = vec![make_task("s1-task", DownloadTaskStatus::Pending)];
    let tasks_s2 = vec![make_task("s2-task", DownloadTaskStatus::Completed)];

    task_persistence::save(dir.path(), "serverA", "user", Some(&dek), &tasks_s1).expect("save s1");
    task_persistence::save(dir.path(), "serverB", "user", Some(&dek), &tasks_s2).expect("save s2");

    let s1 = task_persistence::load(dir.path(), "serverA", "user", Some(&dek)).expect("load s1");
    let s2 = task_persistence::load(dir.path(), "serverB", "user", Some(&dek)).expect("load s2");

    assert_eq!(s1.len(), 1);
    assert_eq!(s1[0].task_id, "s1-task");
    assert_eq!(s2.len(), 1);
    assert_eq!(s2[0].task_id, "s2-task");
}

// ---------------------------------------------------------------------------
// Wrong DEK fails to decrypt
// ---------------------------------------------------------------------------

#[test]
fn wrong_dek_fails_to_load() {
    let dir = temp_dir();
    let dek1 = new_dek();
    let dek2 = new_dek();

    let tasks = vec![make_task("t1", DownloadTaskStatus::Pending)];
    task_persistence::save(dir.path(), "abc123", "user", Some(&dek1), &tasks).expect("save");

    let result = task_persistence::load(dir.path(), "abc123", "user", Some(&dek2));
    assert!(result.is_err(), "loading with wrong DEK should fail");
}

// ---------------------------------------------------------------------------
// Full task field round-trip
// ---------------------------------------------------------------------------

#[test]
fn all_task_fields_roundtrip() {
    let dir = temp_dir();
    let dek = new_dek();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let task = DownloadTaskDto {
        task_id: "full-test".into(),
        file_id: "file-123".into(),
        filename: "test.pdf".into(),
        file_path: "/downloads/test.pdf".into(),
        status: DownloadTaskStatus::Scheduled,
        progress: 0.42,
        current_bytes: 1024,
        total_bytes: 4096,
        message: Some("Processing...".into()),
        error: Some("Previous attempt failed".into()),
        created_at: now - 3600,
        started_at: Some(now - 1800),
        completed_at: None,
        priority: 5,
        retry_count: 1,
        max_retries: 5,
        scheduled_time: Some(now + 3600),
        stage: 2,
        bandwidth_limit: Some(1_000_000),
        pause_position: Some(512),
        supports_resume: true,
        batch_id: Some("batch-001".into()),
        batch_name: Some("Folder".into()),
        batch_root_id: Some("folder-001".into()),
        batch_created_at: Some(now - 3700),
        batch_estimated_total: Some(12),
    };

    task_persistence::save(
        dir.path(),
        "abc123",
        "user",
        Some(&dek),
        std::slice::from_ref(&task),
    )
    .expect("save");

    let loaded = task_persistence::load(dir.path(), "abc123", "user", Some(&dek)).expect("load");
    assert_eq!(loaded.len(), 1);

    let t = &loaded[0];
    assert_eq!(t.task_id, "full-test");
    assert_eq!(t.file_id, "file-123");
    assert_eq!(t.filename, "test.pdf");
    assert_eq!(t.file_path, "/downloads/test.pdf");
    assert_eq!(t.status, DownloadTaskStatus::Scheduled);
    assert!((t.progress - 0.42).abs() < 0.001);
    assert_eq!(t.current_bytes, 1024);
    assert_eq!(t.total_bytes, 4096);
    assert_eq!(t.message.as_deref(), Some("Processing..."));
    assert_eq!(t.error.as_deref(), Some("Previous attempt failed"));
    assert_eq!(t.created_at, now - 3600);
    assert_eq!(t.started_at, Some(now - 1800));
    assert_eq!(t.completed_at, None);
    assert_eq!(t.priority, 5);
    assert_eq!(t.retry_count, 1);
    assert_eq!(t.max_retries, 5);
    assert_eq!(t.scheduled_time, Some(now + 3600));
    assert_eq!(t.stage, 2);
    assert_eq!(t.bandwidth_limit, Some(1_000_000));
    assert_eq!(t.pause_position, Some(512));
    assert!(t.supports_resume);
    assert_eq!(t.batch_id.as_deref(), Some("batch-001"));
    assert_eq!(t.batch_name.as_deref(), Some("Folder"));
    assert_eq!(t.batch_root_id.as_deref(), Some("folder-001"));
    assert_eq!(t.batch_created_at, Some(now - 3700));
    assert_eq!(t.batch_estimated_total, Some(12));
}

#[test]
fn failed_task_can_be_retried_from_queue() {
    let queue = download_queue::QueueState::new();
    let mut task = make_task("retry-me", DownloadTaskStatus::Failed);
    task.progress = 0.75;
    task.current_bytes = 768;
    task.error = Some("network interrupted".into());
    task.message = Some("failed".into());
    task.started_at = Some(123);
    task.completed_at = Some(456);
    task.retry_count = 4;
    task.scheduled_time = Some(789);
    task.pause_position = Some(512);

    queue.insert(&task).expect("insert failed task");

    let retried = download_queue::retry_failed_task(&queue, "retry-me").expect("retry task");
    assert!(retried);

    let retried_task = queue.get("retry-me").expect("task should remain queued");
    assert_eq!(retried_task.status, DownloadTaskStatus::Pending);
    assert_eq!(retried_task.progress, 0.0);
    assert_eq!(retried_task.current_bytes, 0);
    assert!(retried_task.error.is_none());
    assert!(retried_task.message.is_none());
    assert!(retried_task.started_at.is_none());
    assert!(retried_task.completed_at.is_none());
    assert_eq!(retried_task.retry_count, 0);
    assert!(retried_task.scheduled_time.is_none());
    assert!(retried_task.pause_position.is_none());
}

#[test]
fn retry_ignores_non_failed_task() {
    let queue = download_queue::QueueState::new();
    let task = make_task("already-done", DownloadTaskStatus::Completed);
    queue.insert(&task).expect("insert completed task");

    let retried = download_queue::retry_failed_task(&queue, "already-done").expect("retry task");
    assert!(!retried);
    assert_eq!(
        queue
            .get("already-done")
            .expect("task should remain")
            .status,
        DownloadTaskStatus::Completed
    );
}
