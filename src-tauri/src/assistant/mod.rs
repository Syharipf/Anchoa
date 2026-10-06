pub mod context;
pub mod email;
pub mod llm;
pub mod roles;
pub mod providers;
pub mod tools;
pub mod voice;

#[cfg(test)]
pub(crate) mod test_server;

use crate::{db::Db, error::AppError, time};
use jiff::tz::TimeZone;
pub use llm::Endpoint;
use llm::{ChatMessage, ChatRequest};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::{
    Mutex, MutexGuard,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Manager, State, ipc::Channel};
use tools::Proposal;

#[derive(Default)]
pub struct AssistantState {
    conversation: Mutex<Conversation>,
    configuration: Mutex<()>,
    cancel: AtomicBool,
}

#[derive(Default)]
struct Conversation {
    history: Vec<ChatMessage>,
    // Email proposals have no chat tool call and must never enter chat history.
    pending: std::collections::HashMap<String, (Proposal, Option<String>)>,
    running: bool,
    generation: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum AssistantEvent {
    Delta(String),
    Proposal(Proposal),
    Done(ChatMessage),
    Error(String),
}

#[derive(Debug, Serialize)]
pub struct AssistantReply {
    pub message: ChatMessage,
    pub proposals: Vec<Proposal>,
}

impl AssistantState {
    pub(crate) fn configuration_lock(&self) -> Result<MutexGuard<'_, ()>, AppError> {
        self.configuration.lock().map_err(|_| AppError::Other("Konfigurasi AI tidak tersedia".into()))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Conversation>, AppError> {
        self.conversation
            .lock()
            .map_err(|_| AppError::Other("State asisten tidak tersedia".into()))
    }

    #[cfg(test)]
    fn send(
        &self,
        db: &Db,
        endpoint: &Endpoint,
        text: &str,
        now: i64,
        tz: &TimeZone,
        on_event: impl FnMut(AssistantEvent) -> Result<(), AppError>,
    ) -> Result<AssistantReply, AppError> {
        self.send_with(db, text, now, tz, on_event, |request, cancel, delta| {
            llm::stream_chat(endpoint, request, cancel, delta)
        })
    }

    fn send_production(
        &self, db: &Db, store: &crate::keystore::KeyringStore, text: &str,
        now: i64, tz: &TimeZone,
        on_event: impl FnMut(AssistantEvent) -> Result<(), AppError>,
    ) -> Result<AssistantReply, AppError> {
        self.send_resolved(db, Some(store), text, now, tz, on_event, |endpoint, request, cancel, delta| {
            llm::stream_chat(endpoint.ok_or_else(|| AppError::Other("Endpoint AI tidak tersedia".into()))?, request, cancel, delta)
        })
    }

    #[cfg(test)]
    fn send_with(
        &self,
        db: &Db,
        text: &str,
        now: i64,
        tz: &TimeZone,
        on_event: impl FnMut(AssistantEvent) -> Result<(), AppError>,
        mut chat: impl FnMut(
            &ChatRequest,
            &AtomicBool,
            &mut dyn FnMut(&str),
        ) -> Result<ChatMessage, AppError>,
    ) -> Result<AssistantReply, AppError> {
        self.send_resolved(db, None, text, now, tz, on_event, |_, request, cancel, delta| chat(request, cancel, delta))
    }

    #[allow(clippy::too_many_arguments)]
    fn send_resolved(
        &self, db: &Db, store: Option<&crate::keystore::KeyringStore>, text: &str,
        now: i64, tz: &TimeZone,
        mut on_event: impl FnMut(AssistantEvent) -> Result<(), AppError>,
        mut chat: impl FnMut(Option<&Endpoint>, &ChatRequest, &AtomicBool, &mut dyn FnMut(&str)) -> Result<ChatMessage, AppError>,
    ) -> Result<AssistantReply, AppError> {
        let gate = self.configuration_lock()?;
        let mut generation = None;
        let result = (|| {
            let text = text.trim();
            if text.is_empty() {
                return Err(AppError::Empty);
            }
            if text.len() > 64 * 1024 {
                return Err(AppError::Invalid("Pesan asisten terlalu panjang".into()));
            }
            let (epoch, history) = {
                let mut state = self.lock()?;
                if state.running {
                    return Err(AppError::Invalid("Asisten masih menjawab".into()));
                }
                let pending = std::mem::take(&mut state.pending);
                for (id, (proposal, call_id)) in pending {
                    if let Some(call_id) = call_id {
                        state.history.push(tool_message(
                            &call_id,
                            json!({"ok":false,"reason":"diabaikan, user mengirim pesan baru"}),
                        ));
                    } else {
                        state.pending.insert(id, (proposal, None));
                    }
                }
                state.running = true;
                self.cancel.store(false, Ordering::Relaxed);
                (state.generation, state.history.clone())
            };
            generation = Some(epoch);
            let _active = ActiveTurn(self);
            // Copy everything the request needs, then release the database.
            let (role, base, prompt) = {
                let conn = db.conn()?;
                let role = roles::get_role(&conn, "chat")?;
                let base = if store.is_some() { Some(providers::base_url(&conn, &role.provider)?) } else { None };
                (role, base, context::system_prompt(&conn, now, tz)?)
            };
            let endpoint = match (store, base) {
                (Some(store), Some(base)) => Some(providers::endpoint(base, store, &role.provider)?),
                _ => None,
            };
            let policy = tools::Policy::for_provider(&role.provider);
            let model = role.model;
            drop(gate);
            let mut messages = vec![ChatMessage::text("system", prompt)];
            messages.extend(history);
            messages.push(ChatMessage::text("user", text));
            let mut request = ChatRequest {
                model,
                messages,
                tools: tools::definitions(policy),
            };
            let mut seen_calls = std::collections::HashSet::new();
            for _ in 0..4 {
                self.ensure_active(epoch)?;
                let mut event_error = None;
                let response = chat(endpoint.as_ref(), &request, &self.cancel, &mut |delta| {
                    if event_error.is_none()
                        && let Err(error) =
                            self.emit(epoch, AssistantEvent::Delta(delta.into()), &mut on_event)
                    {
                        event_error = Some(error);
                        self.cancel.store(true, Ordering::Relaxed);
                    }
                });
                if let Some(error) = event_error {
                    return Err(error);
                }
                let message = response?;
                self.ensure_active(epoch)?;
                request.messages.push(message.clone());
                let mut pending = Vec::new();
                for call in &message.tool_calls {
                    if call.id.is_empty() || !seen_calls.insert(call.id.clone()) {
                        return Err(AppError::Other(
                            "ID panggilan tool model tidak valid".into(),
                        ));
                    }
                    let args = serde_json::from_str::<Value>(&call.function.arguments)
                        .map_err(|_| AppError::Invalid("Argumen JSON tool tidak valid".into()));
                    let result = args.and_then(|args| {
                        if tools::is_read(&call.function.name) {
                            let conn = db.conn()?;
                            tools::run_read(&conn, &call.function.name, &args, now, tz).map(Some)
                        } else {
                            pending.push((
                                tools::propose(policy, &call.function.name, &args)?,
                                call.id.clone(),
                            ));
                            Ok(None)
                        }
                    });
                    let content = match result {
                        Ok(Some(value)) => value,
                        Ok(None) => continue,
                        Err(error) => json!({"ok":false,"error":error.to_string()}),
                    };
                    request.messages.push(tool_message(&call.id, content));
                }
                if message.tool_calls.is_empty() || !pending.is_empty() {
                    let proposals: Vec<_> = pending
                        .iter()
                        .map(|(proposal, _)| proposal.clone())
                        .collect();
                    {
                        let mut state = self.lock()?;
                        if state.generation != epoch || self.cancel.load(Ordering::Relaxed) {
                            return Err(cancelled());
                        }
                        state.history = request.messages.into_iter().skip(1).collect();
                    }
                    let delivery = (|| {
                        for (proposal, call_id) in &pending {
                            self.emit(
                                epoch,
                                AssistantEvent::Proposal(proposal.clone()),
                                &mut on_event,
                            )?;
                            let mut state = self.lock()?;
                            if state.generation != epoch {
                                return Err(cancelled());
                            }
                            // A stop after delivery still leaves a visible proposal
                            // for the user to approve or reject.
                            state.pending.insert(
                                proposal.id.clone(),
                                (proposal.clone(), Some(call_id.clone())),
                            );
                        }
                        self.emit(epoch, AssistantEvent::Done(message.clone()), &mut on_event)
                    })();
                    if let Err(error) = delivery {
                        let mut state = self.lock()?;
                        if state.generation == epoch {
                            // Resolve undisclosed tool calls so the next request
                            // has neither hidden proposals nor unanswered calls.
                            for (proposal, call_id) in pending {
                                if !state.pending.contains_key(&proposal.id) {
                                    state.history.push(tool_message(
                                        &call_id,
                                        json!({"ok":false,"error":error.to_string()}),
                                    ));
                                }
                            }
                        }
                        return Err(error);
                    }
                    return Ok(AssistantReply { message, proposals });
                }
            }
            Err(AppError::Other(
                "Asisten mencapai batas 4 putaran tool; coba permintaan yang lebih sederhana"
                    .into(),
            ))
        })();
        if let Err(error) = &result {
            let current = generation
                .is_none_or(|epoch| self.lock().is_ok_and(|state| state.generation == epoch));
            if current {
                let _ = on_event(AssistantEvent::Error(error.to_string()));
            }
        }
        result
    }

    fn ensure_active(&self, generation: u64) -> Result<(), AppError> {
        if self.cancel.load(Ordering::Relaxed) || self.lock()?.generation != generation {
            return Err(cancelled());
        }
        Ok(())
    }

    fn emit(
        &self,
        generation: u64,
        event: AssistantEvent,
        callback: &mut impl FnMut(AssistantEvent) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        self.ensure_active(generation)?;
        callback(event)
    }

    fn decide(
        &self,
        db: &Db,
        id: &str,
        approve: bool,
        now: i64,
        tz: &TimeZone,
    ) -> Result<Option<Value>, AppError> {
        let _gate = self.configuration_lock()?;
        let mut state = self.lock()?;
        if state.running {
            return Err(AppError::Invalid(
                "Tunggu sampai asisten selesai menjawab".into(),
            ));
        }
        let (proposal, call_id) = state.pending.get(id).ok_or(AppError::NotFound)?;
        let item = if approve {
            let conn = db.conn()?;
            let policy = tools::Policy::for_provider(&roles::get_role(&conn, "chat")?.provider);
            Some(tools::apply(policy, &conn, proposal, now, tz)?)
        } else {
            None
        };
        // Journal results returned to the UI contain the entry, but the model
        // only receives its ID. Never copy persisted journal content to history.
        let result = match &item {
            Some(value) => json!({"ok":true,"id":value.get("id")}),
            None => json!({"ok":false,"reason":"ditolak user"}),
        };
        if let Some(call_id) = call_id {
            let message = tool_message(call_id, result);
            state.history.push(message);
        }
        state.pending.remove(id);
        Ok(item)
    }

    fn queue_proposal(&self, proposal: Proposal, generation: u64) -> Result<Proposal, AppError> {
        let mut state = self.lock()?;
        if state.generation != generation {
            return Err(cancelled());
        }
        state
            .pending
            .insert(proposal.id.clone(), (proposal.clone(), None));
        Ok(proposal)
    }

    fn pending(&self) -> Result<Vec<Proposal>, AppError> {
        let mut proposals: Vec<_> = self
            .lock()?
            .pending
            .values()
            .map(|(proposal, _)| proposal.clone())
            .collect();
        proposals.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(proposals)
    }

    fn stop(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    fn reset(&self) -> Result<(), AppError> {
        let mut state = self.lock()?;
        self.stop();
        state.generation = state.generation.wrapping_add(1);
        state.history.clear();
        state.pending.clear();
        Ok(())
    }
}

fn cancelled() -> AppError {
    AppError::Other("Permintaan asisten dihentikan".into())
}

fn tool_message(call_id: &str, value: Value) -> ChatMessage {
    let mut message = ChatMessage::text("tool", value.to_string());
    message.tool_call_id = Some(call_id.into());
    message
}

struct ActiveTurn<'a>(&'a AssistantState);
impl Drop for ActiveTurn<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.lock() {
            state.running = false;
        }
    }
}

#[tauri::command]
pub async fn assistant_send(
    app: AppHandle,
    text: String,
    on_event: Channel<AssistantEvent>,
) -> Result<AssistantReply, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AssistantState>();
        state.send_production(
            &app.state::<Db>(),
            &app.state::<crate::keystore::KeyringStore>(),
            &text,
            time::now_ms(),
            &TimeZone::system(),
            |event| on_event.send(event).map_err(AppError::from),
        )
    })
    .await
    .map_err(|_| AppError::Other("Proses asisten gagal".into()))?
}

#[tauri::command]
pub fn assistant_stop(state: State<'_, AssistantState>) {
    state.stop();
}

#[tauri::command]
pub fn assistant_decide(
    db: State<'_, Db>,
    state: State<'_, AssistantState>,
    id: String,
    approve: bool,
) -> Result<Option<Value>, AppError> {
    state.decide(&db, &id, approve, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn assistant_pending(state: State<'_, AssistantState>) -> Result<Vec<Proposal>, AppError> {
    state.pending()
}

#[tauri::command]
pub fn assistant_reset(state: State<'_, AssistantState>) -> Result<(), AppError> {
    state.reset()
}

#[derive(Debug, Serialize)]
pub struct AiStatus {
    pub available: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
    pub provider: String,
    pub name: String,
}

#[tauri::command]
pub async fn ai_status(app: AppHandle) -> Result<AiStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || providers::status(&app, None))
        .await
        .map_err(|_| AppError::Other("Pemeriksaan penyedia AI gagal".into()))?
}

#[derive(Debug, Serialize)]
pub struct AiRoles {
    pub chat: roles::RoleConfig,
    pub journal: roles::RoleConfig,
    pub recap: roles::RoleConfig,
    pub email: roles::RoleConfig,
}

#[tauri::command]
pub fn ai_roles(db: State<'_, Db>) -> Result<AiRoles, AppError> {
    let conn = db.conn()?;
    Ok(AiRoles {
        chat: roles::get_role(&conn, "chat")?,
        journal: roles::get_role(&conn, "journal")?,
        recap: roles::get_role(&conn, "recap")?,
        email: roles::get_role(&conn, "email")?,
    })
}

#[tauri::command]
pub fn set_ai_role(
    db: State<'_, Db>,
    state: State<'_, AssistantState>,
    role: String,
    provider: String,
    model: String,
) -> Result<roles::RoleConfig, AppError> {
    let _gate = state.configuration_lock()?;
    roles::validate(&role, &provider, model.trim())?;
    if role == "chat" {
        state.reset()?;
    }
    roles::set_role(&*db.conn()?, &role, &provider, &model)
}

#[cfg(test)]
mod tests {
    use super::test_server::{Server, sse};
    use super::*;
    use crate::finance::testing::{jakarta, now};
    use serde_json::json;

    fn db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open_at(dir.path().join("assistant.db"));
        (dir, db)
    }

    #[test]
    fn read_tool_then_answer() {
        let server = Server::new(vec![
            sse(&[
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read","type":"function","function":{"name":"today_overview","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}),
            ]),
            sse(&[
                json!({"choices":[{"delta":{"content":"Belum ada tugas."},"finish_reason":"stop"}]}),
            ]),
        ]);
        let (_dir, db) = db();
        let state = AssistantState::default();
        let mut events = Vec::new();
        let result = state
            .send(
                &db,
                &Endpoint {
                    base_url: server.base.clone(),
                    api_key: None,
                },
                "Apa hari ini?",
                now(),
                &jakarta(),
                |event| {
                    events.push(event);
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(result.message.content, "Belum ada tugas.");
        assert!(result.proposals.is_empty());
        assert!(matches!(events.last(), Some(AssistantEvent::Done(_))));
        server.requests.recv().unwrap();
        let (_, request) = server.requests.recv().unwrap();
        assert_eq!(request["messages"][3]["role"], "tool");
        assert_eq!(request["messages"][3]["tool_call_id"], "read");
        server.finish();
    }

    #[test]
    fn write_tool_then_proposal_then_approval() {
        let server = Server::new(vec![sse(&[
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"write","type":"function","function":{"name":"create_task","arguments":"{\"title\":\"Beli teri\"}"}}]},"finish_reason":"tool_calls"}]}),
        ])]);
        let (_dir, db) = db();
        let state = AssistantState::default();
        let mut events = Vec::new();
        let reply = state
            .send(
                &db,
                &Endpoint {
                    base_url: server.base.clone(),
                    api_key: None,
                },
                "Buat tugas beli teri",
                now(),
                &jakarta(),
                |event| {
                    events.push(event);
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(reply.proposals.len(), 1);
        assert!(matches!(events.first(), Some(AssistantEvent::Proposal(_))));
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        let item = state
            .decide(&db, &reply.proposals[0].id, true, now(), &jakarta())
            .unwrap()
            .unwrap();
        assert_eq!(
            crate::tasks::get_task(
                &db.conn().unwrap(),
                item["id"].as_str().unwrap(),
                now(),
                &jakarta()
            )
            .unwrap()
            .card
            .title,
            "Beli teri"
        );
        assert!(
            state
                .decide(&db, &reply.proposals[0].id, true, now(), &jakarta())
                .is_err()
        );
        server.finish();
    }

    #[test]
    fn rejecting_a_proposal_does_not_change_the_database() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let proposal = tools::propose(tools::Policy::Local, "create_task", &json!({"title":"Beli teri"})).unwrap();
        state.conversation.lock().unwrap().pending.insert(
            proposal.id.clone(),
            (proposal.clone(), Some("write".into())),
        );
        let before = db.conn().unwrap().total_changes();
        assert_eq!(
            state
                .decide(&db, &proposal.id, false, now(), &jakarta())
                .unwrap(),
            None
        );
        assert_eq!(db.conn().unwrap().total_changes(), before);
        let history = &state.conversation.lock().unwrap().history;
        assert_eq!(
            history.last().unwrap().tool_call_id.as_deref(),
            Some("write")
        );
        assert_eq!(
            serde_json::from_str::<Value>(&history.last().unwrap().content).unwrap(),
            json!({"ok":false,"reason":"ditolak user"})
        );
    }

    fn tool_call(id: &str, name: &str, args: Value) -> ChatMessage {
        let mut message = ChatMessage::text("assistant", "");
        message.tool_calls.push(llm::ToolCall {
            id: id.into(),
            kind: "function".into(),
            function: llm::ToolFunction {
                name: name.into(),
                arguments: args.to_string(),
            },
        });
        message
    }

    #[test]
    fn pending_proposals_survive_panel_remount_and_can_still_be_decided() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let reply = state
            .send_with(
                &db,
                "Buat tugas",
                now(),
                &jakarta(),
                |_| Ok(()),
                |_, _, _| {
                    Ok(tool_call(
                        "write",
                        "create_task",
                        json!({"title":"Beli teri"}),
                    ))
                },
            )
            .unwrap();
        for _ in 0..2 {
            let pending = state.pending().unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].id, reply.proposals[0].id);
            assert_eq!(pending[0].summary, reply.proposals[0].summary);
            assert_eq!(pending[0].name, "create_task");
            assert_eq!(pending[0].args, json!({"title":"Beli teri"}));
        }
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        let restored = state.pending().unwrap().remove(0);
        state
            .decide(&db, &restored.id, true, now(), &jakarta())
            .unwrap();
        assert!(state.pending().unwrap().is_empty());
    }

    #[test]
    fn new_send_dismisses_all_pending_proposals_and_resolves_their_tool_calls() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let reply = state
            .send_with(
                &db,
                "Buat dua tugas",
                now(),
                &jakarta(),
                |_| Ok(()),
                |_, _, _| {
                    let mut message = tool_call("write-1", "create_task", json!({"title":"Satu"}));
                    message.tool_calls.extend(
                        tool_call("write-2", "create_task", json!({"title":"Dua"})).tool_calls,
                    );
                    Ok(message)
                },
            )
            .unwrap();
        assert_eq!(state.pending().unwrap().len(), 2);
        let before = db.conn().unwrap().total_changes();
        state
            .send_with(
                &db,
                "Pesan baru",
                now(),
                &jakarta(),
                |_| Ok(()),
                |request, _, _| {
                    assert!(state.pending()?.is_empty());
                    for id in ["write-1", "write-2"] {
                        let results: Vec<_> = request
                            .messages
                            .iter()
                            .filter(|message| message.tool_call_id.as_deref() == Some(id))
                            .collect();
                        assert_eq!(results.len(), 1);
                        assert_eq!(results[0].role, "tool");
                        assert_eq!(
                            serde_json::from_str::<Value>(&results[0].content).unwrap(),
                            json!({"ok":false,"reason":"diabaikan, user mengirim pesan baru"})
                        );
                    }
                    assert_eq!(request.messages.last().unwrap().content, "Pesan baru");
                    Ok(ChatMessage::text("assistant", "Lanjut"))
                },
            )
            .unwrap();
        assert!(state.pending().unwrap().is_empty());
        assert_eq!(db.conn().unwrap().total_changes(), before);
        for proposal in reply.proposals {
            assert!(
                state
                    .decide(&db, &proposal.id, true, now(), &jakarta())
                    .is_err()
            );
        }
    }

    #[test]
    fn failed_proposal_delivery_allows_a_later_send_without_reset() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let mut attempts = 0;
        let error = state
            .send_with(
                &db,
                "Buat tugas",
                now(),
                &jakarta(),
                |event| {
                    if matches!(event, AssistantEvent::Proposal(_)) {
                        attempts += 1;
                        return Err(AppError::Other("Channel tertutup".into()));
                    }
                    Ok(())
                },
                |_, _, _| {
                    let mut message = tool_call("write-1", "create_task", json!({"title":"Satu"}));
                    message.tool_calls.extend(
                        tool_call("write-2", "create_task", json!({"title":"Dua"})).tool_calls,
                    );
                    Ok(message)
                },
            )
            .unwrap_err();
        assert!(error.to_string().contains("Channel tertutup"));
        assert_eq!(attempts, 1);
        assert!(state.lock().unwrap().pending.is_empty());
        assert!(!state.lock().unwrap().running);
        state
            .send_with(
                &db,
                "Lanjut",
                now(),
                &jakarta(),
                |_| Ok(()),
                |request, _, _| {
                    for id in ["write-1", "write-2"] {
                        let result = request
                            .messages
                            .iter()
                            .find(|message| message.tool_call_id.as_deref() == Some(id))
                            .unwrap();
                        assert_eq!(
                            serde_json::from_str::<Value>(&result.content).unwrap()["ok"],
                            false
                        );
                    }
                    Ok(ChatMessage::text("assistant", "Lanjut"))
                },
            )
            .unwrap();
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn interrupted_proposal_delivery_keeps_only_emitted_proposals() {
        for cancel in [false, true] {
            let (_dir, db) = db();
            let state = AssistantState::default();
            let mut emitted = Vec::new();
            let mut done = false;
            let error = state
                .send_with(
                    &db,
                    "Buat tugas",
                    now(),
                    &jakarta(),
                    |event| {
                        match event {
                            AssistantEvent::Proposal(proposal) => {
                                if !emitted.is_empty() {
                                    return Err(AppError::Other("Channel tertutup".into()));
                                }
                                emitted.push(proposal);
                                if cancel {
                                    state.stop();
                                }
                            }
                            AssistantEvent::Done(_) => done = true,
                            _ => {}
                        }
                        Ok(())
                    },
                    |_, _, _| {
                        let mut message =
                            tool_call("write-1", "create_task", json!({"title":"Satu"}));
                        message.tool_calls.extend(
                            tool_call("write-2", "create_task", json!({"title":"Dua"})).tool_calls,
                        );
                        Ok(message)
                    },
                )
                .unwrap_err();
            assert!(error.to_string().contains(if cancel {
                "dihentikan"
            } else {
                "Channel tertutup"
            }));
            assert!(!done);
            assert_eq!(emitted.len(), 1);
            let conversation = state.lock().unwrap();
            assert_eq!(conversation.pending.len(), 1);
            assert!(conversation.pending.contains_key(&emitted[0].id));
            assert!(!conversation.running);
            drop(conversation);
            assert!(
                state
                    .decide(&db, &emitted[0].id, false, now(), &jakarta())
                    .unwrap()
                    .is_none()
            );
            state
                .send_with(
                    &db,
                    "Lanjut",
                    now(),
                    &jakarta(),
                    |_| Ok(()),
                    |request, _, _| {
                        for id in ["write-1", "write-2"] {
                            assert_eq!(
                                request
                                    .messages
                                    .iter()
                                    .filter(|message| message.tool_call_id.as_deref() == Some(id))
                                    .count(),
                                1
                            );
                        }
                        Ok(ChatMessage::text("assistant", "Lanjut"))
                    },
                )
                .unwrap();
        }
    }

    #[test]
    fn read_and_write_round_trip_without_network_keeps_db_unlocked() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let mut rounds = 0;
        let mut events = Vec::new();
        let reply = state
            .send_with(
                &db,
                "Buat tugas",
                now(),
                &jakarta(),
                |event| {
                    events.push(event);
                    Ok(())
                },
                |request, _, delta| {
                    // A request can use the DB while the transport is running.
                    assert_eq!(
                        db.conn()?
                            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))?,
                        0
                    );
                    rounds += 1;
                    if rounds == 1 {
                        assert_eq!(request.model, "qwen2.5:3b");
                        Ok(tool_call("read", "list_tasks", json!({})))
                    } else {
                        let tool = request.messages.last().unwrap();
                        assert_eq!(tool.role, "tool");
                        assert_eq!(tool.tool_call_id.as_deref(), Some("read"));
                        assert_eq!(tool.content, "[]");
                        delta("Saya usulkan tugas.");
                        let mut result =
                            tool_call("write", "create_task", json!({"title":"Beli teri"}));
                        result.content = "Saya usulkan tugas.".into();
                        Ok(result)
                    }
                },
            )
            .unwrap();
        assert_eq!(rounds, 2);
        assert!(matches!(
            events.as_slice(),
            [
                AssistantEvent::Delta(_),
                AssistantEvent::Proposal(_),
                AssistantEvent::Done(_)
            ]
        ));
        let id = &reply.proposals[0].id;
        let item = state
            .decide(&db, id, true, now(), &jakarta())
            .unwrap()
            .unwrap();
        assert_eq!(item["title"], "Beli teri");
        assert!(state.decide(&db, id, true, now(), &jakarta()).is_err());
        state
            .send_with(
                &db,
                "Lanjut",
                now(),
                &jakarta(),
                |_| Ok(()),
                |request, _, _| {
                    let history = &request.messages;
                    let approved = &history[history.len() - 2];
                    assert_eq!(approved.tool_call_id.as_deref(), Some("write"));
                    assert_eq!(
                        serde_json::from_str::<Value>(&approved.content).unwrap()["ok"],
                        true
                    );
                    Ok(ChatMessage::text("assistant", "Selesai"))
                },
            )
            .unwrap();
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn reset_during_response_discards_old_history_events_and_proposals() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let mut events = Vec::new();
        assert!(
            state
                .send_with(
                    &db,
                    "Buat tugas",
                    now(),
                    &jakarta(),
                    |event| {
                        events.push(event);
                        Ok(())
                    },
                    |_, _, _| {
                        state.reset()?;
                        Ok(tool_call(
                            "write",
                            "create_task",
                            json!({"title":"Usulan lama"}),
                        ))
                    }
                )
                .is_err()
        );
        assert!(events.is_empty());
        let conversation = state.lock().unwrap();
        assert!(conversation.history.is_empty());
        assert!(conversation.pending.is_empty());
        assert!(!conversation.running);
        drop(conversation);
        state
            .send_with(
                &db,
                "Baru",
                now(),
                &jakarta(),
                |_| Ok(()),
                |request, _, _| {
                    assert_eq!(request.messages.len(), 2);
                    Ok(ChatMessage::text("assistant", "Baru"))
                },
            )
            .unwrap();
    }

    #[test]
    fn stop_and_concurrent_send_do_not_create_proposals() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let mut events = Vec::new();
        let error = state
            .send_with(
                &db,
                "Buat tugas",
                now(),
                &jakarta(),
                |event| {
                    events.push(event);
                    Ok(())
                },
                |_, cancel, _| {
                    assert!(
                        state
                            .send_with(
                                &db,
                                "Kedua",
                                now(),
                                &jakarta(),
                                |_| Ok(()),
                                |_, _, _| panic!("concurrent HTTP")
                            )
                            .is_err()
                    );
                    state.stop();
                    assert!(cancel.load(Ordering::Relaxed));
                    Ok(tool_call(
                        "write",
                        "create_task",
                        json!({"title":"Tidak dibuat"}),
                    ))
                },
            )
            .unwrap_err();
        assert!(error.to_string().contains("dihentikan"));
        assert!(matches!(events.as_slice(), [AssistantEvent::Error(_)]));
        assert!(state.lock().unwrap().pending.is_empty());
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn read_tool_loop_is_limited_to_four_rounds() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let mut rounds = 0;
        let mut events = Vec::new();
        let error = state
            .send_with(
                &db,
                "Ulangi",
                now(),
                &jakarta(),
                |event| {
                    events.push(event);
                    Ok(())
                },
                |_, _, _| {
                    rounds += 1;
                    Ok(tool_call(
                        &format!("read-{rounds}"),
                        "today_overview",
                        json!({}),
                    ))
                },
            )
            .unwrap_err();
        assert_eq!(rounds, 4);
        assert!(error.to_string().contains("4 putaran"));
        assert!(matches!(events.as_slice(), [AssistantEvent::Error(_)]));
        assert!(state.lock().unwrap().history.is_empty());
    }

    #[test]
    fn journal_results_and_search_are_private_in_followup_requests() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let reply = state
            .send_with(
                &db,
                "Tambahkan jurnal",
                now(),
                &jakarta(),
                |_| Ok(()),
                |_, _, _| {
                    Ok(tool_call(
                        "journal",
                        "add_journal_entry",
                        json!({"title":"Entri","body":"Isi awal"}),
                    ))
                },
            )
            .unwrap();
        let item = state
            .decide(&db, &reply.proposals[0].id, true, now(), &jakarta())
            .unwrap()
            .unwrap();
        // Editing via the journal UI must not later expose this saved content.
        crate::items::update(
            &db.conn().unwrap(),
            item["id"].as_str().unwrap(),
            &crate::items::ItemPatch {
                title: Some("RAHASIA JUDUL".into()),
                body: Some("RAHASIA ISI".into()),
                ..Default::default()
            },
            now(),
        )
        .unwrap();
        let mut rounds = 0;
        state
            .send_with(
                &db,
                "Cari rahasia",
                now(),
                &jakarta(),
                |_| Ok(()),
                |request, _, _| {
                    let serialized = serde_json::to_string(&request.messages).unwrap();
                    assert!(!serialized.contains("RAHASIA"), "{serialized}");
                    rounds += 1;
                    if rounds == 1 {
                        Ok(tool_call(
                            "search",
                            "search_items",
                            json!({"query":"rahasia"}),
                        ))
                    } else {
                        assert_eq!(request.messages.last().unwrap().content, "[]");
                        Ok(ChatMessage::text("assistant", "Tidak ditemukan"))
                    }
                },
            )
            .unwrap();
    }

    #[test]
    fn failed_approval_keeps_proposal_and_reset_invalidates_it() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let reply = state
            .send_with(
                &db,
                "Tugas",
                now(),
                &jakarta(),
                |_| Ok(()),
                |_, _, _| {
                    Ok(tool_call(
                        "write",
                        "create_task",
                        json!({"title":"Tugas","projectId":"missing"}),
                    ))
                },
            )
            .unwrap();
        let id = &reply.proposals[0].id;
        assert!(state.decide(&db, id, true, now(), &jakarta()).is_err());
        assert_eq!(state.lock().unwrap().pending.len(), 1);
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        state.reset().unwrap();
        assert!(state.decide(&db, id, true, now(), &jakarta()).is_err());
        assert!(state.lock().unwrap().history.is_empty());
    }

    #[test]
    fn channel_events_use_tagged_wire_format() {
        assert_eq!(
            serde_json::to_value(AssistantEvent::Delta("Halo".into())).unwrap(),
            json!({"type":"delta","data":"Halo"})
        );
        assert_eq!(
            serde_json::to_value(AssistantEvent::Error("Gagal".into())).unwrap(),
            json!({"type":"error","data":"Gagal"})
        );
        let event = serde_json::to_value(AssistantEvent::Done(ChatMessage::text(
            "assistant",
            "Selesai",
        )))
        .unwrap();
        assert_eq!(
            event,
            json!({"type":"done","data":{"role":"assistant","content":"Selesai"}})
        );
    }

    #[test]
    fn production_chat_routes_custom_snapshot_and_switch_clears_session() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let keys = crate::keystore::KeyringStore::with_builder(keyring::mock::default_credential_builder());
        let server = Server::new(vec![sse(&[json!({"choices":[{"delta":{"content":"Kustom"},"finish_reason":"stop"}]})])]);
        {
            let conn = db.conn().unwrap();
            conn.execute("INSERT INTO settings(key,value) VALUES('ai.custom.base_url',?1)", [&server.base]).unwrap();
            roles::set_role(&conn, "chat", "custom", "chosen-model").unwrap();
        }
        keys.set("ai.custom", "SECRET_SENTINEL").unwrap();
        state.send_production(&db, &keys, "Halo", now(), &jakarta(), |_| Ok(())).unwrap();
        let (headers, body) = server.requests.recv().unwrap();
        assert!(headers.starts_with("POST /v1/chat/completions "));
        assert!(headers.to_lowercase().contains("authorization: bearer secret_sentinel"));
        assert!(!state.lock().unwrap().history.is_empty());
        assert_eq!(body["model"], "chosen-model");
        server.finish();
        let epoch = state.lock().unwrap().generation;
        let proposal = tools::propose(tools::Policy::Local, "create_task", &json!({"title":"Old proposal"})).unwrap();
        let id = proposal.id.clone();
        state.queue_proposal(proposal, epoch).unwrap();
        {
            let _gate = state.configuration_lock().unwrap();
            state.reset().unwrap();
            roles::set_role(&db.conn().unwrap(), "chat", "ollama", "local-model").unwrap();
        }
        assert!(state.lock().unwrap().history.is_empty());
        assert!(state.pending().unwrap().is_empty());
        assert!(state.ensure_active(epoch).is_err());
        assert!(state.decide(&db, &id, true, now(), &jakarta()).is_err());
    }

    #[test]
    fn custom_chat_payload_excludes_private_data_and_rejects_journal_writes() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let keys = crate::keystore::KeyringStore::with_builder(keyring::mock::default_credential_builder());
        let calls = json!([
            {"index":0,"id":"overview","type":"function","function":{"name":"today_overview","arguments":"{}"}},
            {"index":1,"id":"search","type":"function","function":{"name":"search_items","arguments":"{\"query\":\"teri\"}"}},
            {"index":2,"id":"list","type":"function","function":{"name":"list_tasks","arguments":"{}"}},
            {"index":3,"id":"journal","type":"function","function":{"name":"add_journal_entry","arguments":"{\"title\":\"Teri\",\"body\":\"Isi\"}"}}
        ]);
        let server = Server::new(vec![
            sse(&[json!({"choices":[{"delta":{"tool_calls":calls},"finish_reason":"tool_calls"}]})]),
            sse(&[json!({"choices":[{"delta":{"content":"Selesai"},"finish_reason":"stop"}]})]),
        ]);
        let tz = jakarta();
        let public_id = {
            let conn = db.conn().unwrap();
            conn.execute("INSERT INTO settings(key,value) VALUES('ai.custom.base_url',?1)", [&server.base]).unwrap();
            roles::set_role(&conn, "chat", "custom", "remote-model").unwrap();
            let due = |id: &str| crate::items::update(&conn, id, &crate::items::ItemPatch { due_at: Some(Some(now())), ..Default::default() }, now()).unwrap();
            let entry = crate::journal::create_entry(&conn, crate::journal::EntryKind::Idea, Some("Teri PRIVATE_JOURNAL_SENTINEL"), now(), &tz).unwrap();
            crate::items::update(&conn, &entry.id, &crate::items::ItemPatch { body: Some("teri PRIVATE_JOURNAL_SENTINEL body".into()), ..Default::default() }, now()).unwrap();
            due(&crate::journal::entry_to_task(&conn, &entry.id, now(), &tz).unwrap().task_id.unwrap());
            let email = crate::items::insert(&conn, "email", "Teri PRIVATE_EMAIL_SENTINEL", "teri PRIVATE_EMAIL_SENTINEL body", now()).unwrap();
            conn.execute("INSERT INTO emails (item_id, folder, uid, from_name, from_addr, to_addrs, message_id, body_cached) VALUES (?1, 'INBOX', 1, 'Siti', 'siti@example.com', '[]', 'm', 1)", [&email]).unwrap();
            let public = crate::tasks::create_task(&conn, &crate::tasks::NewTask { title: "Teri publik".into(), ..Default::default() }, now(), &tz).unwrap();
            due(&public.id);
            public.id
        };
        keys.set("ai.custom", "key").unwrap();
        let reply = state.send_production(&db, &keys, "Cek tugas", now(), &tz, |_| Ok(())).unwrap();
        assert!(reply.proposals.is_empty());
        let bodies: Vec<_> = (0..2).map(|_| server.requests.recv().unwrap().1).collect();
        server.finish();
        for body in &bodies {
            let text = body.to_string();
            assert!(!text.contains("PRIVATE_JOURNAL_SENTINEL"), "{text}");
            assert!(!text.contains("PRIVATE_EMAIL_SENTINEL"), "{text}");
            assert!(body["tools"].as_array().unwrap().iter().all(|tool| tool["function"]["name"] != "add_journal_entry"));
        }
        let results: Vec<_> = bodies[1]["messages"].as_array().unwrap().iter()
            .filter(|message| message["role"] == "tool").map(|message| (message["tool_call_id"].as_str().unwrap(), message["content"].as_str().unwrap())).collect();
        assert_eq!(results.len(), 4);
        for (id, content) in &results[..3] {
            assert!(content.contains(&public_id), "{id}: {content}");
        }
        assert_eq!(results[3].0, "journal");
        assert!(results[3].1.contains("hanya tersedia untuk AI lokal"));
        let journals: i64 = db.conn().unwrap().query_row("SELECT COUNT(*) FROM journal_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(journals, 1);
    }

    #[test]
    fn local_journal_proposal_cannot_apply_after_chat_switches_to_custom() {
        let (_dir, db) = db();
        let state = AssistantState::default();
        let proposal = tools::propose(tools::Policy::Local, "add_journal_entry", &json!({"title":"Jurnal","body":"Isi"})).unwrap();
        let id = proposal.id.clone();
        let epoch = state.lock().unwrap().generation;
        state.queue_proposal(proposal, epoch).unwrap();
        roles::set_role(&db.conn().unwrap(), "chat", "custom", "remote-model").unwrap();
        assert!(matches!(state.decide(&db, &id, true, now(), &jakarta()), Err(AppError::Invalid(_))));
        let journals: i64 = db.conn().unwrap().query_row("SELECT COUNT(*) FROM journal_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(journals, 0);
    }
}
