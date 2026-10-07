use super::context;
use crate::error::AppError;
use crate::{finance, habits, items, journal, search, tasks};
use jiff::tz::TimeZone;
use rusqlite::{Connection, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    Local,
    Custom,
}

impl Policy {
    pub fn for_provider(provider: &str) -> Self {
        if provider == "custom" { Self::Custom } else { Self::Local }
    }

    fn allow(self, name: &str) -> Result<(), AppError> {
        if self == Self::Custom && name == "add_journal_entry" {
            return Err(AppError::Invalid("Tool jurnal hanya tersedia untuk AI lokal".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub summary: String,
    pub name: String,
    pub args: Value,
}

fn schema(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({"type":"function","function":{"name":name,"description":description,
        "parameters":{"type":"object","properties":properties,"required":required,"additionalProperties":false}}})
}

pub fn definitions(policy: Policy) -> Vec<Value> {
    let mut definitions = vec![
        schema(
            "today_overview",
            "Tugas dan tagihan hari ini, habit yang belum dicentang, serta akun. Tanpa jurnal.",
            json!({}),
            &[],
        ),
        schema(
            "search_items",
            "Cari item selain jurnal. Isi jurnal tidak dapat dibaca.",
            json!({"query":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100}}),
            &["query"],
        ),
        schema(
            "list_tasks",
            "Daftar tugas dengan ID untuk memilih tugas yang akan diselesaikan.",
            json!({"status":{"type":"string","enum":["plan","doing","test","review","done"]},"projectId":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100}}),
            &[],
        ),
        schema(
            "create_task",
            "Usulkan tugas baru. Menunggu persetujuan pengguna.",
            json!({"title":{"type":"string"},"projectId":{"type":"string"},"parentId":{"type":"string"},"dueAt":{"type":"integer","description":"Tenggat, epoch milidetik UTC"}}),
            &["title"],
        ),
        schema(
            "complete_task",
            "Usulkan menandai tugas sebagai selesai.",
            json!({"id":{"type":"string"}}),
            &["id"],
        ),
        schema(
            "update_task",
            "Usulkan perubahan tugas: status, prioritas (1 tinggi, 2 sedang, 3 rendah, null kosong), tenggat, atau tag. Menunggu persetujuan pengguna.",
            json!({"id":{"type":"string"},
                "status":{"type":"string","enum":["plan","doing","test","review","done"]},
                "priority":{"type":["integer","null"],"minimum":1,"maximum":3},
                "dueAt":{"type":["integer","null"],"description":"Tenggat, epoch milidetik UTC; null mengosongkan"},
                "tag":{"type":["string","null"]}}),
            &["id"],
        ),
        schema(
            "add_transaction",
            "Usulkan transaksi baru. Uang bilangan bulat satuan terkecil; amount positif, kind menentukan arah.",
            json!({"kind":{"type":"string","enum":["expense","income"]},"title":{"type":"string"},"body":{"type":"string"},"amount":{"type":"integer","minimum":1},"accountId":{"type":"string"},"occurredAt":{"type":"integer","description":"Epoch milidetik UTC"},"category":{"type":"string"}}),
            &["title", "kind", "amount", "accountId", "occurredAt"],
        ),
        schema(
            "add_journal_entry",
            "Usulkan entri jurnal baru dari teks yang diberikan pengguna. Tidak membaca jurnal.",
            json!({"title":{"type":"string"},"body":{"type":"string"},"kind":{"type":"string","enum":["idea","vent","note"]}}),
            &["title", "body"],
        ),
        schema(
            "check_habit",
            "Usulkan mencentang habit hari ini.",
            json!({"id":{"type":"string"}}),
            &["id"],
        ),
    ];
    definitions.retain(|definition| policy.allow(definition["function"]["name"].as_str().unwrap_or("")).is_ok());
    definitions
}

pub fn is_read(name: &str) -> bool {
    matches!(name, "today_overview" | "search_items" | "list_tasks")
}

fn unknown(name: &str) -> AppError {
    AppError::Invalid(format!("Tool tidak dikenal: {name}"))
}

fn decode<T: DeserializeOwned>(name: &str, args: &Value) -> Result<T, AppError> {
    serde_json::from_value(args.clone())
        .map_err(|_| AppError::Invalid(format!("Argumen tool {name} tidak valid")))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyArgs {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchArgs {
    query: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListArgs {
    status: Option<tasks::TaskStatus>,
    project_id: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskArgs {
    title: String,
    project_id: Option<String>,
    parent_id: Option<String>,
    due_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdArgs {
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateTaskArgs {
    id: String,
    status: Option<tasks::TaskStatus>,
    #[serde(default, deserialize_with = "tasks::present_opt")]
    priority: Option<Option<i64>>,
    #[serde(default, deserialize_with = "tasks::present_opt")]
    due_at: Option<Option<i64>>,
    #[serde(default, deserialize_with = "tasks::present_opt")]
    tag: Option<Option<String>>,
}


#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JournalArgs {
    title: String,
    body: String,
    #[serde(default)]
    kind: journal::EntryKind,
}

fn transaction_args(args: &Value) -> Result<finance::TransactionInput, AppError> {
    let input: finance::TransactionInput = decode("add_transaction", args)?;
    // save_transaction also supports editing. The assistant tool only adds.
    let allowed = [
        "title",
        "kind",
        "amount",
        "accountId",
        "occurredAt",
        "category",
        "body",
    ];
    if args
        .as_object()
        .is_none_or(|map| map.keys().any(|key| !allowed.contains(&key.as_str())))
    {
        return Err(AppError::Invalid(
            "Argumen transaksi hanya boleh membuat transaksi baru".into(),
        ));
    }
    Ok(input)
}

pub fn run_read(
    conn: &Connection,
    name: &str,
    args: &Value,
    now: i64,
    tz: &TimeZone,
) -> Result<Value, AppError> {
    match name {
        "today_overview" => {
            decode::<EmptyArgs>(name, args)?;
            context::today_overview(conn, now, tz)
        }
        "search_items" => {
            let args: SearchArgs = decode(name, args)?;
            encode(search::search_for_chat(
                conn,
                &args.query,
                args.limit.unwrap_or(50).clamp(1, 100),
            )?)
        }
        "list_tasks" => {
            let args: ListArgs = decode(name, args)?;
            encode(tasks::card_query(
                conn,
                "NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.task_id = i.id OR j.item_id = i.id) AND (?1 IS NULL OR t.status = ?1) AND (?2 IS NULL OR t.project_id = ?2) ORDER BY i.due_at IS NULL, i.due_at, i.title, i.id LIMIT ?3",
                params![
                    args.status,
                    args.project_id,
                    args.limit.unwrap_or(50).clamp(1, 100) as i64
                ],
                now,
                tz,
            )?)
        }
        _ => Err(unknown(name)),
    }
}

pub fn propose(policy: Policy, name: &str, args: &Value) -> Result<Proposal, AppError> {
    policy.allow(name)?;
    let summary = match name {
        "create_task" => {
            let args: TaskArgs = decode(name, args)?;
            let due = args
                .due_at
                .map(|ms| {
                    jiff::Timestamp::from_millisecond(ms).map(|stamp| {
                        format!(
                            " · tenggat {}",
                            stamp
                                .to_zoned(TimeZone::system())
                                .strftime("%Y-%m-%d %H:%M")
                        )
                    })
                })
                .transpose()?
                .unwrap_or_default();
            format!("Buat tugas “{}”{due}", args.title.trim())
        }
        "update_task" => {
            let a: UpdateTaskArgs = decode(name, args)?;
            let fields: Vec<&str> = [
                a.status.map(|_| "status"),
                a.priority.map(|_| "prioritas"),
                a.due_at.map(|_| "tenggat"),
                a.tag.as_ref().map(|_| "tag"),
            ]
            .into_iter()
            .flatten()
            .collect();
            if fields.is_empty() {
                return Err(AppError::Invalid("Tidak ada perubahan tugas".into()));
            }
            format!("Ubah {} tugas {}", fields.join(", "), a.id)
        }
        "complete_task" => format!("Selesaikan tugas {}", decode::<IdArgs>(name, args)?.id),
        "add_transaction" => {
            let args = transaction_args(args)?;
            let kind = match args.kind {
                finance::TransactionKind::Expense => "pengeluaran",
                finance::TransactionKind::Income => "pemasukan",
            };
            format!(
                "Catat {kind} “{}” · {} · akun {}",
                args.title, args.amount, args.account_id
            )
        }
        "add_journal_entry" => format!(
            "Tambah jurnal “{}”",
            decode::<JournalArgs>(name, args)?.title
        ),
        "check_habit" => format!(
            "Centang habit {} hari ini",
            decode::<IdArgs>(name, args)?.id
        ),
        _ => return Err(unknown(name)),
    };
    Ok(Proposal {
        id: uuid::Uuid::now_v7().to_string(),
        summary,
        name: name.into(),
        args: args.clone(),
    })
}

fn encode(value: impl Serialize) -> Result<Value, AppError> {
    serde_json::to_value(value).map_err(|_| AppError::Other("Hasil tool tidak dapat dibaca".into()))
}

pub fn apply(
    policy: Policy,
    conn: &Connection,
    proposal: &Proposal,
    now: i64,
    tz: &TimeZone,
) -> Result<Value, AppError> {
    let name = proposal.name.as_str();
    policy.allow(name)?;
    let args = &proposal.args;
    match name {
        "create_task" => {
            let args: TaskArgs = decode(name, args)?;
            let input = tasks::NewTask {
                title: args.title,
                project_id: args.project_id,
                parent_id: args.parent_id,
                due_at: args.due_at,
                ..Default::default()
            };
            if let Some(due) = input.due_at {
                jiff::Timestamp::from_millisecond(due)?;
            }
            encode(tasks::create_task(conn, &input, now, tz)?)
        }
        "complete_task" => {
            let id = decode::<IdArgs>(name, args)?.id;
            encode(tasks::update_task(
                conn,
                &id,
                &tasks::TaskPatch {
                    status: Some(tasks::TaskStatus::Done),
                    ..Default::default()
                },
                now,
                tz,
            )?)
        }
        "update_task" => {
            let a: UpdateTaskArgs = decode(name, args)?;
            if let Some(Some(ms)) = a.due_at {
                jiff::Timestamp::from_millisecond(ms)?;
            }
            let tx = conn.unchecked_transaction()?;
            let patch = tasks::TaskPatch { status: a.status, priority: a.priority, tag: a.tag, ..Default::default() };
            // Validates the task first, so the due date below never lands on a missing item.
            tasks::update_task_in_transaction(&tx, &a.id, &patch, now)?;
            if let Some(due) = a.due_at {
                items::update(&tx, &a.id, &items::ItemPatch { due_at: Some(due), ..Default::default() }, now)?;
            }
            let value = encode(tasks::get_task(&tx, &a.id, now, tz)?.card)?;
            tx.commit()?;
            Ok(value)
        }
        "add_transaction" => encode(finance::save_transaction(
            conn,
            &transaction_args(args)?,
            now,
            tz,
        )?),
        "add_journal_entry" => {
            let args: JournalArgs = decode(name, args)?;
            let tx = conn.unchecked_transaction()?;
            let entry = journal::create_entry(&tx, args.kind, Some(&args.title), now, tz)?;
            items::update(
                &tx,
                &entry.id,
                &items::ItemPatch {
                    body: Some(args.body),
                    ..Default::default()
                },
                now,
            )?;
            journal::after_note_saved(&tx, &entry.id, now, tz)?;
            let value = encode(journal::journal_entry(&tx, &entry.id, now, tz)?)?;
            tx.commit()?;
            Ok(value)
        }
        "check_habit" => encode(habits::check_habit(
            conn,
            &decode::<IdArgs>(name, args)?.id,
            true,
            now,
            tz,
        )?),
        _ => Err(unknown(name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db::open_in_memory,
        finance::testing::{jakarta, now},
        tasks,
    };
    use serde_json::json;

    #[test]
    fn write_tool_becomes_a_proposal_without_db_change() {
        let conn = open_in_memory();
        for (name, args) in [
            ("create_task", json!({"title":"Beli teri"})),
            ("complete_task", json!({"id":"task"})),
            ("update_task", json!({"id":"task","priority":2})),
            (
                "add_transaction",
                json!({"title":"Teri", "kind":"expense", "amount":1000,"accountId":"account","occurredAt":now()}),
            ),
            (
                "add_journal_entry",
                json!({"title":"Hari ini","body":"Senang"}),
            ),
            ("check_habit", json!({"id":"habit"})),
        ] {
            let before = conn.total_changes();
            let proposal = propose(Policy::Local, name, &args).unwrap();
            assert!(!proposal.id.is_empty());
            assert!(!proposal.summary.is_empty());
            assert_eq!(proposal.args, args);
            assert_eq!(conn.total_changes(), before);
        }
    }

    #[test]
    fn apply_create_task_creates_it() {
        let conn = open_in_memory();
        let proposal = propose(Policy::Local, "create_task", &json!({"title":"Beli teri"})).unwrap();
        let result = apply(Policy::Local, &conn, &proposal, now(), &jakarta()).unwrap();
        let id = result["id"].as_str().unwrap();
        assert_eq!(
            tasks::get_task(&conn, id, now(), &jakarta())
                .unwrap()
                .card
                .title,
            "Beli teri"
        );
    }

    #[test]
    fn apply_update_task_changes_fields_atomically() {
        let conn = open_in_memory();
        let tz = jakarta();
        let task = tasks::create_task(&conn, &tasks::NewTask { title: "Teri".into(), ..Default::default() }, now(), &tz).unwrap();

        let proposal = propose(Policy::Local, 
            "update_task",
            &json!({"id": task.id, "priority": 1, "dueAt": now(), "status": "doing", "tag": "dapur"}),
        )
        .unwrap();
        assert!(proposal.summary.contains("prioritas"), "{}", proposal.summary);
        let result = apply(Policy::Local, &conn, &proposal, now(), &tz).unwrap();
        assert_eq!(result["priority"], 1);
        assert_eq!(result["status"], "doing");
        assert_eq!(result["dueAt"], now());
        assert_eq!(result["tag"], "dapur");

        let clear = propose(Policy::Local, "update_task", &json!({"id": task.id, "priority": null, "dueAt": null})).unwrap();
        let result = apply(Policy::Local, &conn, &clear, now(), &tz).unwrap();
        assert_eq!(result["priority"], Value::Null);
        assert_eq!(result["dueAt"], Value::Null);
        assert_eq!(result["status"], "doing");

        assert!(propose(Policy::Local, "update_task", &json!({"id": task.id})).is_err()); // nothing to change
        assert!(propose(Policy::Local, "update_task", &json!({"id": task.id, "delete": true})).is_err());

        // A bad priority leaves the due date untouched.
        let bad = Proposal { id: "p".into(), summary: "".into(), name: "update_task".into(),
            args: json!({"id": task.id, "priority": 9, "dueAt": now() + 1}) };
        assert!(matches!(apply(Policy::Local, &conn, &bad, now(), &tz), Err(AppError::Invalid(_))));
        assert_eq!(items::get(&conn, &task.id).unwrap().due_at, None);

        let missing = Proposal { id: "p".into(), summary: "".into(), name: "update_task".into(),
            args: json!({"id": "missing", "priority": 2}) };
        assert!(matches!(apply(Policy::Local, &conn, &missing, now(), &tz), Err(AppError::NotFound)));
        assert!(!definitions(Policy::Local).iter().any(|d| d["function"]["name"] == "delete_task"));
    }

    #[test]
    fn unknown_tool_is_an_error() {
        let conn = open_in_memory();
        assert!(run_read(&conn, "delete_item", &json!({}), now(), &jakarta()).is_err());
        assert!(propose(Policy::Local, "delete_item", &json!({})).is_err());
        assert!(
            apply(Policy::Local,
                &conn,
                &Proposal {
                    id: "p".into(),
                    summary: "".into(),
                    name: "delete_item".into(),
                    args: json!({})
                },
                now(),
                &jakarta()
            )
            .is_err()
        );
    }

    #[test]
    fn search_never_returns_journal_content() {
        let conn = open_in_memory();
        crate::items::capture_note(&conn, "Teri rahasia jurnal", now()).unwrap();
        crate::items::insert(&conn, "page", "Teri publik", "", now()).unwrap();
        let result = run_read(
            &conn,
            "search_items",
            &json!({"query":"teri"}),
            now(),
            &jakarta(),
        )
        .unwrap();
        let serialized = result.to_string();
        assert!(!serialized.contains("rahasia"));
        assert!(serialized.contains("publik"));
    }

    #[test]
    fn search_never_returns_content_copied_from_journal_to_task() {
        let conn = open_in_memory();
        let tz = jakarta();
        let entry = journal::create_entry(
            &conn,
            journal::EntryKind::Idea,
            Some("Teri ide"),
            now(),
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &entry.id,
            &items::ItemPatch {
                body: Some("RAHASIAJURNAL teri pribadi".into()),
                ..Default::default()
            },
            now(),
        )
        .unwrap();
        let converted = journal::entry_to_task(&conn, &entry.id, now(), &tz).unwrap();
        let task_id = converted.task_id.unwrap();
        assert!(
            items::get(&conn, &task_id)
                .unwrap()
                .body
                .contains("RAHASIAJURNAL")
        );
        let public = tasks::create_task(
            &conn,
            &tasks::NewTask {
                title: "Teri publik".into(),
                ..Default::default()
            },
            now(),
            &tz,
        )
        .unwrap();

        // Deleting the source journal must not make its copied text public.
        for deleted in [false, true] {
            if deleted {
                journal::delete_entry(&conn, &entry.id, now()).unwrap();
            }
            for query in ["teri", "RAHASIAJURNAL"] {
                let result =
                    run_read(&conn, "search_items", &json!({"query":query}), now(), &tz).unwrap();
                let serialized = result.to_string();
                assert!(!serialized.contains("RAHASIAJURNAL"), "{serialized}");
                assert!(!serialized.contains(&task_id), "{serialized}");
                if query == "teri" {
                    assert_eq!(result.as_array().unwrap().len(), 1);
                    assert_eq!(result[0]["id"], public.id);
                } else {
                    assert_eq!(result, json!([]));
                }
            }
        }
    }

    #[test]
    fn search_excludes_journal_matches_before_limiting_public_results() {
        let conn = open_in_memory();
        let tz = jakarta();
        let limit = 2;
        for index in 0..=limit {
            let entry = journal::create_entry(
                &conn,
                journal::EntryKind::Idea,
                Some(&format!("Teri rahasia {index}")),
                now(),
                &tz,
            )
            .unwrap();
            journal::entry_to_task(&conn, &entry.id, now(), &tz).unwrap();
            items::capture_note(&conn, &format!("Teri catatan lama {index}"), now()).unwrap();
        }
        let public = tasks::create_task(
            &conn,
            &tasks::NewTask {
                title: "Tugas publik".into(),
                ..Default::default()
            },
            now(),
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &public.id,
            &items::ItemPatch {
                body: Some("Beli teri untuk makan".into()),
                ..Default::default()
            },
            now(),
        )
        .unwrap();
        let page = items::insert(&conn, "page", "Halaman publik", "Resep teri", now()).unwrap();
        // Journal title matches rank above the public body matches.
        let unfiltered = search::search(&conn, "teri", false, limit).unwrap();
        assert!(
            unfiltered
                .iter()
                .all(|hit| hit.item.id != public.id && hit.item.id != page)
        );

        let result = run_read(
            &conn,
            "search_items",
            &json!({"query":"teri","limit":limit}),
            now(),
            &tz,
        )
        .unwrap();
        let hits = result.as_array().unwrap();
        assert_eq!(hits.len(), limit);
        assert!(hits.iter().any(|hit| hit["id"] == public.id));
        assert!(hits.iter().any(|hit| hit["id"] == page));
    }

    #[test]
    fn apply_other_writes_uses_existing_module_behavior() {
        let conn = open_in_memory();
        let tz = jakarta();
        let task = apply(
            Policy::Local,
            &conn,
            &propose(Policy::Local, "create_task", &json!({"title":"Tugas"})).unwrap(),
            now(),
            &tz,
        )
        .unwrap();
        let complete = apply(
            Policy::Local,
            &conn,
            &propose(Policy::Local, "complete_task", &json!({"id":task["id"]})).unwrap(),
            now(),
            &tz,
        )
        .unwrap();
        assert_eq!(complete["status"], "done");
        let account = crate::finance::testing::account(&conn, "Tunai", 10000);
        let transaction = apply(Policy::Local, &conn, &propose(Policy::Local, "add_transaction", &json!({
            "title":"Teri","kind":"expense","amount":1000,"accountId":account,"occurredAt":now()
        })).unwrap(), now(), &tz).unwrap();
        assert_eq!(transaction["amount"], -1000);
        assert_eq!(
            finance::get_account(&conn, &account, now(), &tz)
                .unwrap()
                .balance,
            9000
        );

        let journal_habit = habits::save_habit(
            &conn,
            &habits::HabitInput {
                name: "Menulis jurnal".into(),
                days: 127,
                auto_journal: true,
                ..Default::default()
            },
            now(),
            &tz,
        )
        .unwrap();
        let manual_habit = habits::save_habit(
            &conn,
            &habits::HabitInput {
                name: "Minum air".into(),
                days: 127,
                ..Default::default()
            },
            now(),
            &tz,
        )
        .unwrap();
        let entry = apply(
            Policy::Local,
            &conn,
            &propose(Policy::Local, 
                "add_journal_entry",
                &json!({"title":"Hari ini","body":"Senang","kind":"idea"}),
            )
            .unwrap(),
            now(),
            &tz,
        )
        .unwrap();
        assert_eq!(entry["body"], "Senang");
        assert_eq!(entry["kind"], "idea");
        assert!(
            habits::habits_overview(&conn, now(), &tz)
                .unwrap()
                .habits
                .iter()
                .any(|habit| habit.id == journal_habit.id && habit.done_today)
        );
        let checked = apply(
            Policy::Local,
            &conn,
            &propose(Policy::Local, "check_habit", &json!({"id":manual_habit.id})).unwrap(),
            now(),
            &tz,
        )
        .unwrap();
        assert_eq!(checked["doneToday"], true);
    }

    #[test]
    fn dated_task_creation_rolls_back_when_due_date_cannot_be_saved() {
        let conn = open_in_memory();
        let proposal = propose(Policy::Local, "create_task", &json!({"title":"Beli teri","dueAt":now()})).unwrap();
        conn.execute_batch("CREATE TRIGGER refuse_due BEFORE UPDATE OF due_at ON items BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
        assert!(apply(Policy::Local, &conn, &proposal, now(), &jakarta()).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        conn.execute_batch("DROP TRIGGER refuse_due;").unwrap();
        let item = apply(Policy::Local, &conn, &proposal, now(), &jakarta()).unwrap();
        assert_eq!(item["dueAt"], now());
    }

    #[test]
    fn list_tasks_respects_status_and_soft_deletion() {
        let conn = open_in_memory();
        let tz = jakarta();
        let deleted = tasks::create_task(
            &conn,
            &tasks::NewTask {
                title: "Dihapus".into(),
                ..Default::default()
            },
            now(),
            &tz,
        )
        .unwrap();
        tasks::delete_task(&conn, &deleted.id, now()).unwrap();
        tasks::create_task(
            &conn,
            &tasks::NewTask {
                title: "Rencana".into(),
                ..Default::default()
            },
            now(),
            &tz,
        )
        .unwrap();
        tasks::create_task(
            &conn,
            &tasks::NewTask {
                title: "Selesai".into(),
                status: tasks::TaskStatus::Done,
                ..Default::default()
            },
            now(),
            &tz,
        )
        .unwrap();
        let result = run_read(&conn, "list_tasks", &json!({"status":"plan"}), now(), &tz).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["title"], "Rencana");
    }

    #[test]
    fn malformed_write_arguments_and_transaction_edits_are_rejected() {
        let conn = open_in_memory();
        let before = conn.total_changes();
        for (name, args) in [
            ("create_task", json!([])),
            ("create_task", json!({"title":12})),
            ("create_task", json!({"title":"Tugas","unexpected":true})),
            ("complete_task", json!({})),
            (
                "add_journal_entry",
                json!({"title":"Jurnal","body":"Isi","kind":"invalid"}),
            ),
            (
                "add_transaction",
                json!({"id":"existing", "title":"Teri","kind":"expense","amount":1000,"accountId":"account","occurredAt":now()}),
            ),
            (
                "add_transaction",
                json!({"title":"Teri","kind":"expense","amount":1.5,"accountId":"account","occurredAt":now()}),
            ),
        ] {
            assert!(propose(Policy::Local, name, &args).is_err(), "{name}: {args}");
        }
        assert_eq!(conn.total_changes(), before);
        let invalid = propose(Policy::Local, "add_transaction", &json!({"title":"Teri","kind":"expense","amount":-1000,"accountId":"account","occurredAt":now()})).unwrap();
        assert!(apply(Policy::Local, &conn, &invalid, now(), &jakarta()).is_err());
        assert_eq!(conn.total_changes(), before);
    }

    #[test]
    fn custom_policy_rejects_journal_propose_and_apply() {
        let conn = open_in_memory();
        let args = json!({"title":"Jurnal","body":"PRIVATE_JOURNAL_SENTINEL"});
        assert!(definitions(Policy::Custom).iter().all(|tool| tool["function"]["name"] != "add_journal_entry"));
        assert!(propose(Policy::Custom, "add_journal_entry", &args).is_err());
        let local = propose(Policy::Local, "add_journal_entry", &args).unwrap();
        let before = conn.total_changes();
        assert!(apply(Policy::Custom, &conn, &local, now(), &jakarta()).is_err());
        assert_eq!(conn.total_changes(), before);
        // Email suggestions may supply a title, never an automatic body copy.
        assert!(propose(Policy::Local, "create_task", &json!({"title":"Tugas","body":"PRIVATE_EMAIL_SENTINEL"})).is_err());
    }

    #[test]
    fn deleted_journal_source_stays_private_in_overview_and_limited_task_list() {
        let conn = open_in_memory();
        let tz = jakarta();
        for index in 0..3 {
            let entry = journal::create_entry(&conn, journal::EntryKind::Idea, Some(&format!("A PRIVATE_JOURNAL_SENTINEL {index}")), now(), &tz).unwrap();
            let id = journal::entry_to_task(&conn, &entry.id, now(), &tz).unwrap().task_id.unwrap();
            items::update(&conn, &id, &items::ItemPatch { due_at: Some(Some(now())), ..Default::default() }, now()).unwrap();
            journal::delete_entry(&conn, &entry.id, now()).unwrap();
        }
        let public = tasks::create_task(&conn, &tasks::NewTask { title: "Z tugas pengguna".into(), ..Default::default() }, now(), &tz).unwrap();
        items::update(&conn, &public.id, &items::ItemPatch { due_at: Some(Some(now())), ..Default::default() }, now()).unwrap();
        let overview = run_read(&conn, "today_overview", &json!({}), now(), &tz).unwrap();
        assert_eq!(overview["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(overview["tasks"][0]["id"], public.id);
        let list = run_read(&conn, "list_tasks", &json!({"limit":1}), now(), &tz).unwrap();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["id"], public.id);
    }
}
