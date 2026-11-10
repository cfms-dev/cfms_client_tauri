//! Access-rule batch execution, including explicit reconciliation of unknown writes.
use crate::{
    rpc::{ActionFailure, SessionIdentity, action_once_guarded},
    state::AppState,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub object_type: String,
    pub object_id: String,
    pub name: String,
    pub path: Option<String>,
}
impl Target {
    fn key(&self) -> String {
        format!("{}:{}", self.object_type, self.object_id)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Problem {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}
impl Problem {
    fn new(kind: &str) -> Self {
        Self {
            kind: kind.into(),
            status: None,
        }
    }
}
#[derive(Clone, Serialize)]
pub struct Item {
    pub target: Target,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<Problem>,
    pub skipped: bool,
}
#[derive(Clone, Serialize)]
pub struct ScanIssue {
    pub target: Target,
    pub problem: Problem,
}
#[derive(Clone, Serialize)]
pub struct Decision {
    pub ticket: u64,
    pub target: Target,
    pub problem: Problem,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: String,
    pub operation: String,
    pub scan_issues: Vec<ScanIssue>,
    pub scan_complete: bool,
    pub started: bool,
    pub run_completed: usize,
    pub run_total: usize,
    pub active_key: Option<String>,
    pub waiting_until: Option<u64>,
    pub retry_at: u64,
    pub stop_requested: bool,
    pub stop_reason: Option<Problem>,
    pub target_count: usize,
    pub revision: u64,
    pub decision: Option<Decision>,
}
struct State {
    snapshot: Snapshot,
    items: Vec<Item>,
    revisions: HashMap<String, u64>,
    children: HashMap<String, Vec<String>>,
    queue: VecDeque<Target>,
    cursor: Option<String>,
    cursors: HashSet<String>,
    rules: serde_json::Value,
    inherit: bool,
    answer: Option<(u64, String)>,
}
pub struct Batch {
    identity: SessionIdentity,
    state: Mutex<State>,
    stopped: AtomicBool,
    busy: AtomicBool,
    disposed: AtomicBool,
}
#[derive(Default)]
pub struct Registry {
    batches: Mutex<HashMap<String, Arc<Batch>>>,
    cooldown: Mutex<Option<(SessionIdentity, u64)>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemChange {
    pub index: usize,
    pub revision: u64,
    pub item: Item,
}

pub fn validate_rules(rules: &serde_json::Value) -> Result<(), String> {
    fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
    where
        D: serde::Deserializer<'de>,
        T: Deserialize<'de>,
    {
        T::deserialize(deserializer).map(Some)
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "lowercase")]
    enum Match {
        All,
        Any,
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Condition {
        #[serde(rename = "match", default, deserialize_with = "present")]
        _mode: Option<Match>,
        #[serde(rename = "require", default, deserialize_with = "present")]
        _require: Option<Vec<String>>,
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Sub {
        #[serde(rename = "match", default, deserialize_with = "present")]
        _mode: Option<Match>,
        #[serde(rename = "rights", default, deserialize_with = "present")]
        _rights: Option<Condition>,
        #[serde(rename = "groups", default, deserialize_with = "present")]
        _groups: Option<Condition>,
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Group {
        #[serde(rename = "match")]
        _mode: Match,
        #[serde(rename = "match_groups")]
        _groups: Vec<Sub>,
    }
    let map = rules.as_object().ok_or("Access rules must be an object")?;
    for (key, value) in map {
        if !["read", "write", "move", "manage"].contains(&key.as_str()) {
            return Err("Unknown access operation".into());
        }
        serde_json::from_value::<Vec<Group>>(value.clone()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

impl Registry {
    pub async fn create(
        &self,
        app: &AppState,
        targets: Vec<Target>,
        rules: serde_json::Value,
        inherit: bool,
        recursive: bool,
    ) -> Result<String, String> {
        validate_rules(&rules)?;
        if targets.is_empty()
            || targets.iter().any(|t| {
                t.object_id.is_empty()
                    || !["document", "directory"].contains(&t.object_type.as_str())
            })
        {
            return Err("Invalid access-rule targets".into());
        }
        let identity = SessionIdentity::capture(app).await?;
        let retry_at = self
            .cooldown
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(scope, _)| scope == &identity)
            .map(|(_, until)| *until)
            .unwrap_or(0);
        let mut state = State {
            snapshot: Snapshot {
                phase: "idle".into(),
                operation: "scan".into(),
                scan_issues: vec![],
                scan_complete: !recursive,
                started: false,
                run_completed: 0,
                run_total: 0,
                active_key: None,
                waiting_until: None,
                retry_at,
                stop_requested: false,
                stop_reason: None,
                target_count: 0,
                revision: 0,
                decision: None,
            },
            items: vec![],
            revisions: HashMap::new(),
            children: HashMap::new(),
            queue: VecDeque::new(),
            cursor: None,
            cursors: HashSet::new(),
            rules,
            inherit,
            answer: None,
        };
        for target in targets {
            add_target(&mut state, target, recursive);
        }
        let id = format!("access-batch:{:032x}", rand::random::<u128>());
        self.batches.lock().unwrap().insert(
            id.clone(),
            Arc::new(Batch {
                identity,
                state: Mutex::new(state),
                stopped: AtomicBool::new(false),
                busy: AtomicBool::new(false),
                disposed: AtomicBool::new(false),
            }),
        );
        Ok(id)
    }
    pub async fn get(&self, app: &AppState, id: &str) -> Result<Arc<Batch>, String> {
        let batch = self
            .batches
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("Access batch not found")?;
        batch.identity.ensure_current(app).await?;
        Ok(batch)
    }
    pub fn stop_all(&self) {
        self.cooldown.lock().unwrap().take();
        for batch in self.batches.lock().unwrap().values() {
            batch.disposed.store(true, Ordering::SeqCst);
            batch.stopped.store(true, Ordering::SeqCst);
        }
    }
    fn remember_cooldown(&self, identity: &SessionIdentity, until: u64) {
        let mut cooldown = self.cooldown.lock().unwrap();
        let previous = cooldown
            .as_ref()
            .filter(|(scope, _)| scope == identity)
            .map(|(_, value)| *value)
            .unwrap_or(0);
        *cooldown = Some((identity.clone(), previous.max(until)));
    }
    pub async fn wait_all_stopped(&self) {
        let batches = self
            .batches
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect::<Vec<_>>();
        while batches
            .iter()
            .any(|batch| batch.busy.load(Ordering::SeqCst))
        {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
    pub fn remove(&self, id: &str) {
        let mut batches = self.batches.lock().unwrap();
        if let Some(batch) = batches.get(id) {
            batch.disposed.store(true, Ordering::SeqCst);
            batch.stopped.store(true, Ordering::SeqCst);
            if !batch.busy.load(Ordering::SeqCst) {
                batches.remove(id);
            }
        }
    }
}

impl Batch {
    pub fn snapshot(&self) -> Snapshot {
        self.state.lock().unwrap().snapshot.clone()
    }
    pub fn changes(&self, after: u64) -> Vec<ItemChange> {
        let state = self.state.lock().unwrap();
        let mut items: Vec<_> = state
            .items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                let revision = *state.revisions.get(&item.target.key())?;
                (revision > after).then(|| ItemChange {
                    index,
                    revision,
                    item: item.clone(),
                })
            })
            .collect();
        items.sort_by_key(|item| item.revision);
        items.truncate(super::SERVER_CURSOR_PAGE_SIZE as usize);
        items
    }
    pub fn stop(&self, app: &AppState, id: &str, reason: Option<Problem>) {
        self.stopped.store(true, Ordering::SeqCst);
        let mut state = self.state.lock().unwrap();
        state.snapshot.stop_requested = true;
        state.snapshot.stop_reason = reason;
        drop(state);
        emit(app, id);
    }
    pub fn decide(&self, ticket: u64, answer: String) -> Result<(), String> {
        if !["retry", "skip", "skip_all", "cancel"].contains(&answer.as_str()) {
            return Err("Invalid failure decision".into());
        }
        let mut state = self.state.lock().unwrap();
        if state.snapshot.decision.as_ref().map(|d| d.ticket) != Some(ticket) {
            return Err("This failure decision is no longer active".into());
        }
        state.answer = Some((ticket, answer));
        Ok(())
    }
    async fn guard(&self, app: &AppState) -> Result<(), Problem> {
        if self.disposed.load(Ordering::SeqCst) || self.stopped.load(Ordering::SeqCst) {
            return Err(self
                .snapshot()
                .stop_reason
                .unwrap_or_else(|| Problem::new("stopped")));
        }
        if self.identity.ensure_current(app).await.is_err() {
            return Err(Problem::new("identity"));
        }
        if app.token.read().await.is_none() {
            return Err(Problem::new("session"));
        }
        let permissions = app.permissions.read().await;
        if !permissions.iter().any(|p| p == "set_access_rules") {
            return Err(Problem::new("permission"));
        }
        if app.app_lockdown.load(Ordering::SeqCst)
            && !permissions.iter().any(|p| p == "bypass_lockdown")
        {
            return Err(Problem::new("lockdown"));
        }
        if app.conn.read().await.as_ref().is_none_or(|c| c.is_closed()) {
            return Err(Problem::new("disconnected"));
        }
        Ok(())
    }
    fn halt(&self, problem: Problem) {
        let mut state = self.state.lock().unwrap();
        state.snapshot.phase = if problem.kind == "temporary" {
            "paused"
        } else {
            "stopped"
        }
        .into();
        state.snapshot.stop_reason = Some(problem);
    }
    async fn wait(&self, app: &AppState, id: &str, until: u64) -> Result<(), Problem> {
        while now_ms() < until {
            self.guard(app).await?;
            {
                let mut state = self.state.lock().unwrap();
                state.snapshot.waiting_until = Some(until);
                state.snapshot.phase = "waiting".into();
            }
            emit(app, id);
            tokio::time::sleep(std::time::Duration::from_millis(
                until.saturating_sub(now_ms()).min(100),
            ))
            .await;
        }
        self.state.lock().unwrap().snapshot.waiting_until = None;
        self.guard(app).await
    }
    async fn request(
        &self,
        app: &AppState,
        id: &str,
        action: &str,
        data: serde_json::Value,
        mutation: bool,
    ) -> Result<serde_json::Value, Problem> {
        for attempt in 0..=crate::transfers::retry::MAX_BACKGROUND_RETRIES {
            self.guard(app).await?;
            let retry_at = self.snapshot().retry_at;
            self.wait(app, id, retry_at).await?;
            {
                let mut state = self.state.lock().unwrap();
                state.snapshot.phase = if mutation { "running" } else { "scanning" }.into();
            }
            match action_once_guarded(app, &self.identity, action, data.clone(), || async {
                self.guard(app).await.map_err(|problem| problem.kind)
            })
            .await
            {
                Ok(value) => return Ok(value),
                Err(error)
                    if error.transient()
                        && attempt < crate::transfers::retry::MAX_BACKGROUND_RETRIES =>
                {
                    let delay =
                        crate::transfers::retry::retry_delay(attempt + 1, error.retry_after());
                    let until = now_ms().saturating_add(delay.as_millis() as u64);
                    self.state.lock().unwrap().snapshot.retry_at = until;
                    app.access_batches.remember_cooldown(&self.identity, until);
                }
                Err(error) => {
                    if error.transient() {
                        let until = now_ms().saturating_add(
                            crate::transfers::retry::retry_delay(attempt + 1, error.retry_after())
                                .as_millis() as u64,
                        );
                        self.state.lock().unwrap().snapshot.retry_at = until;
                        app.access_batches.remember_cooldown(&self.identity, until);
                    }
                    return Err(classify_failure(&error, mutation));
                }
            }
        }
        unreachable!()
    }
    pub async fn run(
        &self,
        app: &AppState,
        id: &str,
        command: &str,
        allow_incomplete: bool,
    ) -> Result<(), String> {
        if self.disposed.load(Ordering::SeqCst) {
            return Err("Access batch has been disposed".into());
        }
        if command == "apply" {
            let snapshot = self.snapshot();
            if snapshot.phase != "ready"
                || snapshot.started
                || (!allow_incomplete && !snapshot.scan_issues.is_empty())
            {
                return Err("Access batch requires a ready, explicitly approved scope".into());
            }
        }
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err("Access batch is already running".into());
        }
        struct Release<'a>(&'a AtomicBool);
        impl Drop for Release<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _release = Release(&self.busy);
        self.stopped.store(false, Ordering::SeqCst);
        {
            let mut state = self.state.lock().unwrap();
            state.snapshot.stop_requested = false;
            state.snapshot.stop_reason = None;
        }
        let result = if command == "scan" {
            self.scan(app, id).await
        } else {
            self.apply(app, id, command, allow_incomplete).await
        };
        if let Err(problem) = result {
            self.halt(problem);
        }
        {
            let mut state = self.state.lock().unwrap();
            state.snapshot.active_key = None;
            state.snapshot.waiting_until = None;
            state.snapshot.decision = None;
        }
        emit(app, id);
        drop(_release);
        if self.disposed.load(Ordering::SeqCst) {
            app.access_batches.remove(id);
        }
        Ok(())
    }
    async fn scan(&self, app: &AppState, id: &str) -> Result<(), Problem> {
        if self.snapshot().started {
            return Err(Problem::new("rejected"));
        }
        {
            let mut state = self.state.lock().unwrap();
            state.snapshot.phase = "scanning".into();
            state.snapshot.operation = "scan".into();
        }
        loop {
            self.guard(app).await?;
            let next = {
                let state = self.state.lock().unwrap();
                state
                    .queue
                    .front()
                    .cloned()
                    .map(|target| (target, state.cursor.clone()))
            };
            let Some((target, cursor)) = next else {
                break;
            };
            self.state.lock().unwrap().snapshot.active_key = Some(target.key());
            emit(app, id);
            let response = self.request(app, id, "core.directory.list", serde_json::json!({"folder_id": target.object_id, "cursor": cursor, "page_size": super::SERVER_CURSOR_PAGE_SIZE}), false).await;
            let page = response.and_then(|raw| {
                super::parse_listing_page_dto(raw).map_err(|_| Problem::new("invalid_response"))
            });
            match page {
                Ok(page) => {
                    let mut state = self.state.lock().unwrap();
                    let mut keys = Vec::new();
                    for folder in page.folders {
                        let child = Target {
                            object_type: "directory".into(),
                            object_id: folder.id,
                            path: Some(format!(
                                "{}/{}",
                                target.path.as_ref().unwrap_or(&target.name),
                                folder.name
                            )),
                            name: folder.name,
                        };
                        keys.push(child.key());
                        add_target(&mut state, child, true);
                    }
                    for doc in page.documents {
                        let child = Target {
                            object_type: "document".into(),
                            object_id: doc.id,
                            path: Some(format!(
                                "{}/{}",
                                target.path.as_ref().unwrap_or(&target.name),
                                doc.title
                            )),
                            name: doc.title,
                        };
                        keys.push(child.key());
                        add_target(&mut state, child, false);
                    }
                    state.children.entry(target.key()).or_default().extend(keys);
                    if !page.has_more {
                        next_directory(&mut state);
                    } else if !state
                        .cursors
                        .insert(page.next_cursor.clone().unwrap_or_default())
                    {
                        state.snapshot.scan_issues.push(ScanIssue {
                            target,
                            problem: Problem::new("cursor"),
                        });
                        next_directory(&mut state);
                    } else {
                        state.cursor = page.next_cursor;
                    }
                }
                Err(problem) if halts(&problem) => return Err(problem),
                Err(problem) => {
                    let mut state = self.state.lock().unwrap();
                    state
                        .snapshot
                        .scan_issues
                        .push(ScanIssue { target, problem });
                    next_directory(&mut state);
                }
            }
            emit(app, id);
        }
        let mut state = self.state.lock().unwrap();
        reorder(&mut state);
        state.snapshot.scan_complete = true;
        state.snapshot.phase = "ready".into();
        drop(state);
        emit(app, id);
        Ok(())
    }
    async fn apply(
        &self,
        app: &AppState,
        id: &str,
        command: &str,
        allow_incomplete: bool,
    ) -> Result<(), Problem> {
        let indices: Vec<usize> = {
            let mut state = self.state.lock().unwrap();
            if !state.snapshot.started
                && (command != "apply"
                    || state.snapshot.phase != "ready"
                    || (!allow_incomplete && !state.snapshot.scan_issues.is_empty()))
            {
                return Err(Problem::new("rejected"));
            }
            state.snapshot.started = true;
            state.snapshot.operation = "apply".into();
            state.snapshot.phase = "running".into();
            let indices: Vec<_> = state
                .items
                .iter()
                .enumerate()
                .filter_map(|(i, item)| {
                    let select = match command {
                        "apply" => item.status == "pending",
                        "retry" => item.status == "failed",
                        "continue" => {
                            item.status == "pending"
                                || (item.status == "failed"
                                    && item.problem.as_ref().is_some_and(|p| {
                                        ["temporary", "session", "lockdown"]
                                            .contains(&p.kind.as_str())
                                    }))
                        }
                        "resubmit" => item.status == "unconfirmed",
                        _ => false,
                    };
                    select.then_some(i)
                })
                .collect();
            state.snapshot.run_completed = 0;
            state.snapshot.run_total = indices.len();
            indices
        };
        let mut skipped = HashSet::new();
        for index in indices {
            loop {
                self.guard(app).await?;
                let (target, rules, inherit) = {
                    let state = self.state.lock().unwrap();
                    (
                        state.items[index].target.clone(),
                        state.rules.clone(),
                        state.inherit,
                    )
                };
                self.state.lock().unwrap().snapshot.active_key = Some(target.key());
                emit(app, id);
                let action = if target.object_type == "document" {
                    "core.document.access_rule.set"
                } else {
                    "core.directory.access_rule.set"
                };
                let id_field = if target.object_type == "document" {
                    "document_id"
                } else {
                    "directory_id"
                };
                let outcome = self.request(app, id, action, serde_json::json!({(id_field): target.object_id, "access_rules": rules, "inherit_parent": inherit}), true).await;
                let problem = outcome.err();
                let attempted = problem.as_ref().is_none_or(|p| {
                    p.status.is_some()
                        || ["unconfirmed", "invalid_response"].contains(&p.kind.as_str())
                });
                if attempted {
                    let mut state = self.state.lock().unwrap();
                    state.items[index].status = match &problem {
                        None => "success",
                        Some(p)
                            if ["unconfirmed", "invalid_response"].contains(&p.kind.as_str()) =>
                        {
                            "unconfirmed"
                        }
                        _ => "failed",
                    }
                    .into();
                    state.items[index].problem = problem.clone();
                    state.items[index].skipped = false;
                    changed(&mut state, index);
                }
                emit(app, id);
                if let Err(stopped) = self.guard(app).await {
                    if attempted {
                        self.state.lock().unwrap().snapshot.run_completed += 1;
                    }
                    return Err(stopped);
                }
                let Some(problem) = problem else {
                    break;
                };
                if halts(&problem) {
                    if attempted {
                        self.state.lock().unwrap().snapshot.run_completed += 1;
                    }
                    return Err(problem);
                }
                let key = format!("{}:{:?}", problem.kind, problem.status);
                let choice = if skipped.contains(&key) {
                    "skip".into()
                } else {
                    self.decision(app, id, target, problem).await?
                };
                if choice == "retry" {
                    continue;
                }
                if choice == "cancel" {
                    return Err(Problem::new("stopped"));
                }
                if choice == "skip_all" {
                    skipped.insert(key);
                }
                {
                    let mut state = self.state.lock().unwrap();
                    state.items[index].skipped = true;
                    changed(&mut state, index);
                }
                break;
            }
            self.state.lock().unwrap().snapshot.run_completed += 1;
            emit(app, id);
        }
        self.state.lock().unwrap().snapshot.phase = "finished".into();
        Ok(())
    }
    async fn decision(
        &self,
        app: &AppState,
        id: &str,
        target: Target,
        problem: Problem,
    ) -> Result<String, Problem> {
        let ticket = rand::random::<u64>() >> 12;
        {
            let mut state = self.state.lock().unwrap();
            state.snapshot.phase = "deciding".into();
            state.snapshot.decision = Some(Decision {
                ticket,
                target,
                problem,
            });
            state.answer = None;
        }
        emit(app, id);
        loop {
            self.guard(app).await?;
            let answer = self.state.lock().unwrap().answer.take();
            if let Some((_, answer)) = answer {
                self.state.lock().unwrap().snapshot.decision = None;
                return Ok(answer);
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn emit(app: &AppState, id: &str) {
    let _ = app
        .event_tx
        .send(cfms_core::ServiceEvent::AccessBatchChanged { id: id.into() });
}
fn changed(state: &mut State, index: usize) {
    state.snapshot.revision += 1;
    state
        .revisions
        .insert(state.items[index].target.key(), state.snapshot.revision);
}
fn add_target(state: &mut State, target: Target, recursive: bool) {
    if state.revisions.contains_key(&target.key()) {
        return;
    }
    if recursive && target.object_type == "directory" {
        state.queue.push_back(target.clone());
    }
    state.items.push(Item {
        target,
        status: "pending".into(),
        problem: None,
        skipped: false,
    });
    changed(state, state.items.len() - 1);
    state.snapshot.target_count = state.items.len();
}
fn next_directory(state: &mut State) {
    state.queue.pop_front();
    state.cursor = None;
    state.cursors.clear();
}
fn halts(problem: &Problem) -> bool {
    [
        "identity",
        "session",
        "permission",
        "disconnected",
        "lockdown",
        "temporary",
        "unconfirmed",
        "stopped",
    ]
    .contains(&problem.kind.as_str())
}
pub fn classify_failure(error: &ActionFailure, mutation: bool) -> Problem {
    let kind = match error.status {
        Some(401) => "session",
        Some(403) => "denied",
        Some(404) => "missing",
        Some(999) => "lockdown",
        Some(429 | 503) => "temporary",
        Some(_) => "rejected",
        None if mutation && error.sent => "unconfirmed",
        None => "disconnected",
    };
    Problem {
        kind: kind.into(),
        status: error.status,
    }
}
fn reorder(state: &mut State) {
    let map: HashMap<_, _> = state
        .items
        .drain(..)
        .map(|item| (item.target.key(), item))
        .collect();
    let mut roots: Vec<_> = map.keys().cloned().collect();
    roots.sort();
    let mut visited = HashSet::new();
    let mut active = HashSet::new();
    for root in roots {
        let mut stack = vec![(root, false)];
        while let Some((key, exit)) = stack.pop() {
            if exit {
                active.remove(&key);
                visited.insert(key.clone());
                if let Some(item) = map.get(&key) {
                    state.items.push(item.clone());
                }
            } else if active.contains(&key) {
                if let Some(item) = map.get(&key) {
                    state.snapshot.scan_issues.push(ScanIssue {
                        target: item.target.clone(),
                        problem: Problem::new("cycle"),
                    });
                }
            } else if !visited.contains(&key) {
                active.insert(key.clone());
                stack.push((key.clone(), true));
                if let Some(children) = state.children.get(&key) {
                    for child in children.iter().rev() {
                        stack.push((child.clone(), false));
                    }
                }
            }
        }
    }
    for index in 0..state.items.len() {
        changed(state, index);
    }
}
