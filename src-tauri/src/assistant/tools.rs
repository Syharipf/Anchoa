use super::context;
use crate::error::AppError;
use crate::{finance, habits, items, journal, search, tasks};
use jiff::tz::TimeZone;
use rusqlite::{Connection, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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

pub fn definitions() -> Vec<Value> {
    vec![
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
    ]
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
            let hits = search::search(
                conn,
                &args.query,
                false,
                args.limit.unwrap_or(50).clamp(1, 100),
            )?;
            // All notes, including legacy notes without journal_entries, belong
            // to the journal. Filter before serializing a single snippet.
            encode(
                hits.into_iter()
                    .filter(|hit| hit.item.kind != "note")
                    .collect::<Vec<_>>(),
            )
        }
        "list_tasks" => {
            let args: ListArgs = decode(name, args)?;
            encode(tasks::card_query(
                conn,
                "(?1 IS NULL OR t.status = ?1) AND (?2 IS NULL OR t.project_id = ?2) ORDER BY i.due_at IS NULL, i.due_at, i.title, i.id LIMIT ?3",
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

pub fn propose(name: &str, args: &Value) -> Result<Proposal, AppError> {
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
    conn: &Connection,
    proposal: &Proposal,
    now: i64,
    tz: &TimeZone,
) -> Result<Value, AppError> {
    let name = proposal.name.as_str();
    let args = &proposal.args;
    match name {
        "create_task" => {
            let args: TaskArgs = decode(name, args)?;
            let input = tasks::NewTask {
                title: args.title,
                project_id: args.project_id,
                parent_id: args.parent_id,
                ..Default::default()
            };
            if let Some(due) = args.due_at {
                jiff::Timestamp::from_millisecond(due)?;
                let tx = conn.unchecked_transaction()?;
                let task = tasks::create_task_in_transaction(&tx, &input, now, tz)?;
                items::update(
                    &tx,
                    &task.id,
                    &items::ItemPatch {
                        due_at: Some(Some(due)),
                        ..Default::default()
                    },
                    now,
                )?;
                let result = tasks::get_task(&tx, &task.id, now, tz)?.card;
                let value = encode(result)?;
                tx.commit()?;
                Ok(value)
            } else {
                encode(tasks::create_task(conn, &input, now, tz)?)
            }
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
            let proposal = propose(name, &args).unwrap();
            assert!(!proposal.id.is_empty());
            assert!(!proposal.summary.is_empty());
            assert_eq!(proposal.args, args);
            assert_eq!(conn.total_changes(), before);
        }
    }

    #[test]
    fn apply_create_task_creates_it() {
        let conn = open_in_memory();
        let proposal = propose("create_task", &json!({"title":"Beli teri"})).unwrap();
        let result = apply(&conn, &proposal, now(), &jakarta()).unwrap();
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
    fn unknown_tool_is_an_error() {
        let conn = open_in_memory();
        assert!(run_read(&conn, "delete_item", &json!({}), now(), &jakarta()).is_err());
        assert!(propose("delete_item", &json!({})).is_err());
        assert!(
            apply(
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
    fn apply_other_writes_uses_existing_module_behavior() {
        let conn = open_in_memory();
        let tz = jakarta();
        let task = apply(
            &conn,
            &propose("create_task", &json!({"title":"Tugas"})).unwrap(),
            now(),
            &tz,
        )
        .unwrap();
        let complete = apply(
            &conn,
            &propose("complete_task", &json!({"id":task["id"]})).unwrap(),
            now(),
            &tz,
        )
        .unwrap();
        assert_eq!(complete["status"], "done");
        let account = crate::finance::testing::account(&conn, "Tunai", 10000);
        let transaction = apply(&conn, &propose("add_transaction", &json!({
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
            &conn,
            &propose(
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
            &conn,
            &propose("check_habit", &json!({"id":manual_habit.id})).unwrap(),
            now(),
            &tz,
        )
        .unwrap();
        assert_eq!(checked["doneToday"], true);
    }

    #[test]
    fn dated_task_creation_rolls_back_when_due_date_cannot_be_saved() {
        let conn = open_in_memory();
        let proposal = propose("create_task", &json!({"title":"Beli teri","dueAt":now()})).unwrap();
        conn.execute_batch("CREATE TRIGGER refuse_due BEFORE UPDATE OF due_at ON items BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
        assert!(apply(&conn, &proposal, now(), &jakarta()).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        conn.execute_batch("DROP TRIGGER refuse_due;").unwrap();
        let item = apply(&conn, &proposal, now(), &jakarta()).unwrap();
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
            assert!(propose(name, &args).is_err(), "{name}: {args}");
        }
        assert_eq!(conn.total_changes(), before);
        let invalid = propose("add_transaction", &json!({"title":"Teri","kind":"expense","amount":-1000,"accountId":"account","occurredAt":now()})).unwrap();
        assert!(apply(&conn, &invalid, now(), &jakarta()).is_err());
        assert_eq!(conn.total_changes(), before);
    }
}
