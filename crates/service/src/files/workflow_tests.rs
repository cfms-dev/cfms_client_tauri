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
            json!({}),
            true,
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
        .filter(|r| r["action"].as_str().unwrap().ends_with(".set"))
        .collect();
    assert_eq!(writes.len(), 3);
    assert_eq!(writes.last().unwrap()["data"]["directory_id"], "root");
    assert!(writes.iter().all(|r| r["data"]["inherit_parent"] == true));
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
            json!({}),
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
            json!({}),
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
            json!({}),
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
            json!({}),
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
    peer.state.permissions.write().await.clear();
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
            "core.directory.info.get" => (404, json!({})),
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
    assert_eq!(denied.requests.lock().unwrap().len(), 2);
}

#[test]
fn access_rules_validate_the_wire_shape_without_discarding_unknown_fields() {
    use super::access_batches::validate_rules;
    assert!(
        validate_rules(
            &json!({"read":[{"match":"any","match_groups":[{"rights":{"require":["a"]}}]}]})
        )
        .is_ok()
    );
    for value in [
        json!({"other":[]}),
        json!({"read":[{"match":"any","match_groups":[],"unknown":true}]}),
        json!({"read":[{"match":"wrong","match_groups":[]}]}),
        json!(null),
        json!({"read":[{"match":"any","match_groups":[{"rights":null}]}]}),
        json!({"read":[{"match":"any","match_groups":[{"match":null}]}]}),
    ] {
        assert!(validate_rules(&value).is_err());
    }
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
            json!({}),
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
            json!({}),
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
