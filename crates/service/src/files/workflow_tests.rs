use crate::{
    files::access_batches::Target,
    test_rpc::{Peer, page},
};
use serde_json::json;
fn target(kind: &str, id: &str) -> Target {
    Target {
        object_type: kind.into(),
        object_id: id.into(),
        name: id.into(),
        path: None,
    }
}

#[tokio::test]
async fn recursive_access_scan_deduplicates_pages_and_applies_children_first() {
    let peer = Peer::new(|request| {
        let data = if request["action"] == "core.directory.list" {
            match (
                request["data"]["folder_id"].as_str().unwrap(),
                request["data"]["cursor"].as_str(),
            ) {
                ("root", None) => page(
                    json!([{"type":"directory","id":"child","name":"Child"}]),
                    Some("p2"),
                ),
                ("root", Some("p2")) => {
                    page(json!([{"type":"document","id":"doc","title":"File"}]), None)
                }
                ("child", _) => page(json!([]), None),
                _ => panic!("unexpected request: {request}"),
            }
        } else {
            json!({})
        };
        Some((200, data))
    })
    .await;
    let registry = &peer.state.access_batches;
    let id = registry
        .create(
            &peer.state,
            vec![target("directory", "root"), target("directory", "child")],
            "inherit on;\nallow [READ_METADATA] to any;\n".into(),
            false,
            true,
        )
        .await
        .unwrap();
    let batch = registry.get(&peer.state, &id).await.unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    assert_eq!(batch.snapshot().target_count, 3);
    assert!(batch.snapshot().scan_issues.is_empty());
    batch.run(&peer.state, &id, "apply", false).await.unwrap();
    let calls = peer.requests.lock().unwrap();
    let writes: Vec<_> = calls
        .iter()
        .filter(|r| r["action"].as_str().unwrap().ends_with(".dacl.set"))
        .collect();
    assert_eq!(writes.len(), 3);
    assert_eq!(writes.last().unwrap()["data"]["directory_id"], "root");
    assert!(writes.iter().all(|r| r["data"]["dacl"]
        == "inherit on;\nallow [READ_METADATA] to any;\n"
        && r["data"]["allow_self_lockout"] == false));
    assert_eq!(batch.snapshot().run_completed, 3);
}

#[tokio::test]
async fn scan_detects_cycles_and_repeated_cursors_without_unbounded_requests() {
    let peer = Peer::new(|_| {
        Some((
            200,
            page(
                json!([{"type":"directory","id":"root","name":"Root"}]),
                Some("same"),
            ),
        ))
    })
    .await;
    let id = peer
        .state
        .access_batches
        .create(
            &peer.state,
            vec![target("directory", "root")],
            "inherit off;\n".into(),
            false,
            true,
        )
        .await
        .unwrap();
    let batch = peer
        .state
        .access_batches
        .get(&peer.state, &id)
        .await
        .unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    let snapshot = batch.snapshot();
    assert_eq!(snapshot.target_count, 1);
    assert!(
        snapshot
            .scan_issues
            .iter()
            .any(|issue| issue.problem.kind == "cycle")
    );
    assert!(
        snapshot
            .scan_issues
            .iter()
            .any(|issue| issue.problem.kind == "cursor")
    );
    assert_eq!(peer.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn incomplete_scan_requires_approval_and_does_not_hide_other_roots() {
    let peer = Peer::new(|request| {
        if request["action"] == "core.directory.list" {
            Some((403, json!({})))
        } else {
            Some((200, json!({})))
        }
    })
    .await;
    let id = peer
        .state
        .access_batches
        .create(
            &peer.state,
            vec![target("directory", "denied"), target("document", "doc")],
            "inherit off;\n".into(),
            false,
            true,
        )
        .await
        .unwrap();
    let batch = peer
        .state
        .access_batches
        .get(&peer.state, &id)
        .await
        .unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    assert_eq!(batch.snapshot().scan_issues.len(), 1);
    assert!(batch.run(&peer.state, &id, "apply", false).await.is_err());
    assert_eq!(peer.requests.lock().unwrap().len(), 1);
    assert!(!batch.snapshot().started);
    batch.run(&peer.state, &id, "apply", true).await.unwrap();
    assert_eq!(batch.snapshot().run_completed, 2);
}

#[tokio::test]
async fn lost_write_response_is_unconfirmed_and_not_selected_by_continue() {
    let peer = Peer::new(|_| None).await;
    let id = peer
        .state
        .access_batches
        .create(
            &peer.state,
            vec![target("document", "a"), target("document", "b")],
            "inherit on;\n".into(),
            true,
            false,
        )
        .await
        .unwrap();
    let batch = peer
        .state
        .access_batches
        .get(&peer.state, &id)
        .await
        .unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    batch.run(&peer.state, &id, "apply", false).await.unwrap();
    assert_eq!(batch.changes(0)[0].item.status, "pending"); // revisions are returned in change order
    assert!(
        batch
            .changes(0)
            .iter()
            .any(|row| row.item.status == "unconfirmed")
    );
    batch
        .run(&peer.state, &id, "continue", false)
        .await
        .unwrap();
    assert_eq!(peer.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn guard_changes_leave_unsent_items_pending_and_old_sessions_are_rejected() {
    let peer = Peer::new(|_| Some((200, json!({})))).await;
    let id = peer
        .state
        .access_batches
        .create(
            &peer.state,
            vec![target("document", "a")],
            "inherit off;\n".into(),
            false,
            false,
        )
        .await
        .unwrap();
    let batch = peer
        .state
        .access_batches
        .get(&peer.state, &id)
        .await
        .unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    peer.state
        .app_lockdown
        .store(true, std::sync::atomic::Ordering::SeqCst);
    batch.run(&peer.state, &id, "apply", false).await.unwrap();
    assert_eq!(batch.changes(0)[0].item.status, "pending");
    assert!(peer.requests.lock().unwrap().is_empty());
    peer.state.clear_auth().await;
    assert!(
        peer.state
            .access_batches
            .get(&peer.state, &id)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn node_resolution_falls_back_only_on_404_and_checks_parent() {
    let peer = Peer::new(|request| {
        Some(match request["action"].as_str().unwrap() {
            "node_lookup.node.resolve" => (200, json!({"node_ids":["/","parent","doc"]})),
            "core.directory.list" => {
                assert_eq!(request["data"]["folder_id"], "doc");
                assert!(request["data"]["cursor"].is_null());
                assert_eq!(request["data"]["page_size"], 1);
                (404, json!({}))
            }
            "core.document.info.get" => (200, json!({"parent_id":"wrong","title":"Title"})),
            _ => panic!("unexpected request"),
        })
    })
    .await;
    peer.state
        .server_extension_flags
        .write()
        .await
        .push("node_lookup".into());
    assert!(
        super::node_path::resolve(&peer.state, "/Parent/Doc")
            .await
            .unwrap_err()
            .contains("parent")
    );
    assert_eq!(peer.requests.lock().unwrap().len(), 3);
    let denied = Peer::new(|request| {
        Some(if request["action"] == "node_lookup.node.resolve" {
            (200, json!({"node_ids":["/","doc"]}))
        } else {
            (403, json!({}))
        })
    })
    .await;
    denied
        .state
        .server_extension_flags
        .write()
        .await
        .push("node_lookup".into());
    assert!(
        super::node_path::resolve(&denied.state, "/Doc")
            .await
            .is_err()
    );
    let denied_requests = denied.requests.lock().unwrap();
    assert_eq!(denied_requests.len(), 2);
    assert_eq!(denied_requests[1]["action"], "core.directory.list");
}

#[tokio::test]
async fn node_resolution_resolves_listable_directory_without_metadata_permission() {
    let peer = Peer::new(|request| {
        Some(match request["action"].as_str().unwrap() {
            "node_lookup.node.resolve" => {
                assert_eq!(request["data"]["path"], "/回响/B0");
                (200, json!({"node_ids": ["/", "echo", "b0"]}))
            }
            "core.directory.list" => {
                assert_eq!(request["data"]["folder_id"], "b0");
                assert!(request["data"]["cursor"].is_null());
                assert_eq!(request["data"]["page_size"], 1);
                (200, page(json!([]), None))
            }
            other => panic!("unexpected request: {other}"),
        })
    })
    .await;
    peer.state
        .server_extension_flags
        .write()
        .await
        .push("node_lookup".into());

    let resolved = super::node_path::resolve(&peer.state, "/回响/B0")
        .await
        .unwrap();
    assert_eq!(
        resolved
            .segments
            .iter()
            .map(|s| (s.id.as_str(), s.label.as_str()))
            .collect::<Vec<_>>(),
        vec![("echo", "回响"), ("b0", "B0")]
    );
    match resolved.target {
        super::node_path::NodeTarget::Directory { id, label } => {
            assert_eq!(id, "b0");
            assert_eq!(label, "B0");
        }
        other => panic!("expected directory target, got {other:?}"),
    }
    assert_eq!(peer.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn node_resolution_resolves_document_after_directory_404() {
    let peer = Peer::new(|request| {
        Some(match request["action"].as_str().unwrap() {
            "node_lookup.node.resolve" => (200, json!({"node_ids": ["/", "parent", "doc"]})),
            "core.directory.list" => {
                assert_eq!(request["data"]["folder_id"], "doc");
                assert!(request["data"]["cursor"].is_null());
                assert_eq!(request["data"]["page_size"], 1);
                (404, json!({}))
            }
            "core.document.info.get" => {
                assert_eq!(request["data"]["document_id"], "doc");
                (200, json!({"parent_id": "parent", "title": "Server Title"}))
            }
            other => panic!("unexpected request: {other}"),
        })
    })
    .await;
    peer.state
        .server_extension_flags
        .write()
        .await
        .push("node_lookup".into());

    let resolved = super::node_path::resolve(&peer.state, "/Parent/Doc")
        .await
        .unwrap();
    match resolved.target {
        super::node_path::NodeTarget::Document {
            id,
            label,
            parent_id,
        } => {
            assert_eq!(id, "doc");
            assert_eq!(label, "Server Title");
            assert_eq!(parent_id.as_deref(), Some("parent"));
        }
        other => panic!("expected document target, got {other:?}"),
    }
    assert_eq!(peer.requests.lock().unwrap().len(), 3);
}

#[test]
fn dacl_source_validates_maximum_character_length() {
    use super::access_batches::validate_dacl_source;
    assert!(validate_dacl_source("inherit on;\n").is_ok());
    let max = "a".repeat(cfms_core::constants::DACL_SOURCE_MAX_LENGTH);
    assert!(validate_dacl_source(&max).is_ok());
    let over = "a".repeat(cfms_core::constants::DACL_SOURCE_MAX_LENGTH + 1);
    assert!(validate_dacl_source(&over).is_err());
}

#[tokio::test]
async fn self_lockout_decision_retries_with_allow_self_lockout_and_all_mode() {
    let peer = Peer::new(|request| {
        if request["action"] == "core.document.dacl.set"
            && request["data"]["allow_self_lockout"] != true
        {
            Some((
                409,
                json!({
                    "self_lockout_warning": true,
                    "diagnostics": [{"code": "W209", "severity": "warning", "message": "expired"}],
                }),
            ))
        } else {
            Some((200, json!({})))
        }
    })
    .await;
    let id = peer
        .state
        .access_batches
        .create(
            &peer.state,
            vec![target("document", "a"), target("document", "b")],
            "inherit off;\n".into(),
            false,
            false,
        )
        .await
        .unwrap();
    let batch = peer
        .state
        .access_batches
        .get(&peer.state, &id)
        .await
        .unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    let mut events = peer.state.event_tx.subscribe();
    let runner = batch.clone();
    let state = peer.state.clone();
    let running_id = id.clone();
    let run = tokio::spawn(async move { runner.run(&state, &running_id, "apply", false).await });
    let ticket = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let Some(decision) = batch.snapshot().decision {
                assert_eq!(decision.problem.kind, "self_lockout");
                assert_eq!(decision.problem.diagnostics.as_ref().map(Vec::len), Some(1));
                break decision.ticket;
            }
            events.recv().await.unwrap();
        }
    })
    .await
    .unwrap();
    batch.decide(ticket, "allow_lockout_all".into()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), run)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let requests = peer.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0]["data"]["allow_self_lockout"], false);
    assert_eq!(requests[1]["data"]["allow_self_lockout"], true);
    assert_eq!(requests[2]["data"]["allow_self_lockout"], true);
    assert!(
        batch
            .changes(0)
            .iter()
            .all(|row| row.item.status == "success")
    );
}

#[test]
fn classify_failure_preserves_server_diagnostics_on_400() {
    use super::access_batches::classify_failure;
    use crate::rpc::ActionFailure;

    let failure = ActionFailure {
        status: Some(400),
        message: "Invalid CACL policy".into(),
        data: json!({
            "diagnostics": [{"code": "E101", "severity": "error", "message": "Syntax error"}]
        }),
        sent: true,
    };
    let problem = classify_failure(&failure, true);
    assert_eq!(problem.kind, "invalid_policy");
    assert_eq!(problem.diagnostics.as_ref().map(Vec::len), Some(1));
}

#[tokio::test]
async fn stopping_an_in_flight_write_keeps_its_confirmed_success_and_sends_no_next_item() {
    let gate = std::sync::Arc::new(tokio::sync::Notify::new());
    let peer = Peer::gated(|_| Some((200, json!({}))), gate.clone()).await;
    let id = peer
        .state
        .access_batches
        .create(
            &peer.state,
            vec![target("document", "a"), target("document", "b")],
            "inherit off;\n".into(),
            false,
            false,
        )
        .await
        .unwrap();
    let batch = peer
        .state
        .access_batches
        .get(&peer.state, &id)
        .await
        .unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    let runner = batch.clone();
    let state = peer.state.clone();
    let running_id = id.clone();
    let run = tokio::spawn(async move { runner.run(&state, &running_id, "apply", false).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), peer.received.notified())
        .await
        .unwrap();
    batch.stop(&peer.state, &id, None);
    gate.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(5), run)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let results = batch.changes(0);
    assert_eq!(
        results
            .iter()
            .filter(|r| r.item.status == "success")
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|r| r.item.status == "pending")
            .count(),
        1
    );
    assert_eq!(batch.snapshot().phase, "stopped");
    assert_eq!(batch.snapshot().run_completed, 1);
    assert_eq!(peer.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn an_explicit_failure_decision_retries_the_same_item_and_clears_the_prompt() {
    let mut calls = 0;
    let peer = Peer::new(move |_| {
        calls += 1;
        Some(if calls == 1 {
            (403, json!({}))
        } else {
            (200, json!({}))
        })
    })
    .await;
    let id = peer
        .state
        .access_batches
        .create(
            &peer.state,
            vec![target("document", "a")],
            "inherit off;\n".into(),
            false,
            false,
        )
        .await
        .unwrap();
    let batch = peer
        .state
        .access_batches
        .get(&peer.state, &id)
        .await
        .unwrap();
    batch.run(&peer.state, &id, "scan", false).await.unwrap();
    let mut events = peer.state.event_tx.subscribe();
    let runner = batch.clone();
    let state = peer.state.clone();
    let running_id = id.clone();
    let run = tokio::spawn(async move { runner.run(&state, &running_id, "apply", false).await });
    let ticket = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let Some(decision) = batch.snapshot().decision {
                break decision.ticket;
            }
            events.recv().await.unwrap();
        }
    })
    .await
    .unwrap();
    batch.decide(ticket, "retry".into()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), run)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(peer.requests.lock().unwrap().len(), 2);
    assert_eq!(batch.changes(0)[0].item.status, "success");
    assert!(!batch.changes(0)[0].item.skipped);
    assert!(batch.snapshot().decision.is_none());
    assert!(batch.decide(ticket, "retry".into()).is_err());
}
