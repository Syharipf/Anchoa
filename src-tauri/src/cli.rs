//! The `anchoa agent` interface, usable without starting Tauri.
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use jiff::tz::TimeZone;
use rusqlite::Connection;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::activities::{self, Activity, Kind, NewActivity, Role};
use crate::error::AppError;
use crate::tasks::{NewTask, TaskDetail, TaskStatus};
use crate::{db, items, projects, tasks};

const BODY_LIMIT: usize = 200 * 1024;

/// `args` starts at the subcommand, after the binary name and `agent`.
pub fn run(args: &[String], data_dir: &Path, now: i64) -> (i32, String) {
    match run_inner(args, data_dir, now) {
        Ok(output) => (0, output),
        Err(error) => error_output(error),
    }
}

pub fn error_output(error: impl std::fmt::Display) -> (i32, String) {
    (
        2,
        format!("{}\n", serde_json::json!({"error": error.to_string()})),
    )
}

/// Linux equivalent of the app's `app.path().app_data_dir()`, without a Tauri app.
pub fn data_dir() -> Result<PathBuf, AppError> {
    resolve_data_dir(
        std::env::var_os("XDG_DATA_HOME").as_deref(),
        std::env::var_os("HOME").as_deref(),
    )
}

fn resolve_data_dir(xdg: Option<&OsStr>, home: Option<&OsStr>) -> Result<PathBuf, AppError> {
    // Tauri joins the platform data directory with this same configured identifier.
    #[derive(Deserialize)]
    struct Config {
        identifier: String,
    }
    let config: Config = serde_json::from_str(include_str!("../tauri.conf.json"))
        .map_err(|error| AppError::Other(error.to_string()))?;
    let base = match xdg.map(Path::new).filter(|path| path.is_absolute()) {
        Some(path) => path.to_path_buf(),
        None => home
            .map(Path::new)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| AppError::Invalid("Folder data Anchoa tidak ditemukan".into()))?
            .join(".local/share"),
    };
    Ok(base.join(config.identifier))
}

enum Body<'a> {
    Text(&'a str),
    File(&'a str),
}

enum Command<'a> {
    Projects,
    Inbox {
        project: Option<&'a str>,
    },
    NewTask {
        project: &'a str,
        title: &'a str,
        body: &'a str,
    },
    Status {
        task: &'a str,
        status: TaskStatus,
        actor: &'a str,
    },
    Log {
        task: &'a str,
        actor: &'a str,
        role: Role,
        kind: Kind,
        title: Option<&'a str>,
        body: Body<'a>,
    },
    Plan {
        task: &'a str,
        actor: &'a str,
        file: &'a str,
    },
    Show {
        task: &'a str,
    },
}

struct Options<'a> {
    values: HashMap<&'a str, &'a str>,
    positionals: Vec<&'a str>,
}

impl<'a> Options<'a> {
    fn parse(
        args: &'a [String],
        allowed: &[&str],
        positional_count: usize,
    ) -> Result<Self, AppError> {
        let mut values = HashMap::new();
        let mut positionals = Vec::new();
        let mut json = false;
        let mut args = args.iter().map(String::as_str);
        while let Some(arg) = args.next() {
            if arg == "--json" {
                if json {
                    return Err(AppError::Invalid("Opsi --json berulang".into()));
                }
                json = true;
            } else if allowed.contains(&arg) {
                let value = args
                    .next()
                    .ok_or_else(|| AppError::Invalid(format!("Nilai {arg} wajib diisi")))?;
                if values.insert(arg, value).is_some() {
                    return Err(AppError::Invalid(format!("Opsi {arg} berulang")));
                }
            } else if arg.starts_with('-') {
                return Err(AppError::Invalid(format!("Opsi tidak dikenal: {arg}")));
            } else {
                positionals.push(arg);
            }
        }
        if positionals.len() != positional_count {
            return Err(AppError::Invalid("Jumlah argumen tidak sesuai".into()));
        }
        Ok(Self {
            values,
            positionals,
        })
    }

    fn value(&self, name: &str) -> Option<&'a str> {
        self.values.get(name).copied()
    }

    fn required(&self, name: &str) -> Result<&'a str, AppError> {
        self.value(name)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::Invalid(format!("{name} wajib diisi")))
    }

    fn optional(&self, name: &str) -> Result<Option<&'a str>, AppError> {
        self.value(name).map(|_| self.required(name)).transpose()
    }
}

fn enum_arg<T: DeserializeOwned>(value: &str, name: &str) -> Result<T, AppError> {
    serde_json::from_value(serde_json::Value::String(value.into()))
        .map_err(|_| AppError::Invalid(format!("{name} tidak valid: {value}")))
}

fn parse(args: &[String]) -> Result<Command<'_>, AppError> {
    let (command, rest) = args
        .split_first()
        .ok_or_else(|| AppError::Invalid("Subperintah anchoa agent wajib diisi".into()))?;
    match command.as_str() {
        "projects" => {
            Options::parse(rest, &[], 0)?;
            Ok(Command::Projects)
        }
        "inbox" => {
            let opts = Options::parse(rest, &["--project"], 0)?;
            Ok(Command::Inbox {
                project: opts.optional("--project")?,
            })
        }
        "task" => {
            let (subcommand, rest) = rest
                .split_first()
                .ok_or_else(|| AppError::Invalid("Subperintah task wajib diisi".into()))?;
            match subcommand.as_str() {
                "new" => {
                    let opts = Options::parse(rest, &["--project", "--title", "--body"], 0)?;
                    Ok(Command::NewTask {
                        project: opts.required("--project")?,
                        title: opts.required("--title")?,
                        body: opts.value("--body").unwrap_or_default(),
                    })
                }
                "status" => {
                    let opts = Options::parse(rest, &["--task", "--actor"], 1)?;
                    let status = opts
                        .positionals
                        .first()
                        .ok_or_else(|| AppError::Invalid("Status wajib diisi".into()))?;
                    Ok(Command::Status {
                        task: opts.required("--task")?,
                        status: enum_arg(status, "Status")?,
                        actor: opts.required("--actor")?,
                    })
                }
                _ => Err(AppError::Invalid(format!(
                    "Subperintah task tidak dikenal: {subcommand}"
                ))),
            }
        }
        "log" => {
            let opts = Options::parse(
                rest,
                &[
                    "--task", "--actor", "--role", "--kind", "--title", "--body", "--file",
                ],
                0,
            )?;
            let body = match (opts.value("--body"), opts.optional("--file")?) {
                (Some(body), None) => Body::Text(body),
                (None, Some(file)) => Body::File(file),
                _ => {
                    return Err(AppError::Invalid(
                        "Pilih salah satu --body atau --file".into(),
                    ));
                }
            };
            Ok(Command::Log {
                task: opts.required("--task")?,
                actor: opts.required("--actor")?,
                role: enum_arg(opts.required("--role")?, "Role")?,
                kind: enum_arg(opts.value("--kind").unwrap_or("message"), "Kind")?,
                title: opts.value("--title"),
                body,
            })
        }
        "plan" => {
            let opts = Options::parse(rest, &["--task", "--actor", "--file"], 0)?;
            Ok(Command::Plan {
                task: opts.required("--task")?,
                actor: opts.required("--actor")?,
                file: opts.required("--file")?,
            })
        }
        "show" => {
            let opts = Options::parse(rest, &["--task"], 0)?;
            Ok(Command::Show {
                task: opts.required("--task")?,
            })
        }
        _ => Err(AppError::Invalid(format!(
            "Subperintah tidak dikenal: {command}"
        ))),
    }
}

fn validate_body(body: &str) -> Result<(), AppError> {
    if body.len() > BODY_LIMIT {
        return Err(AppError::Invalid("Isi maksimal 200 KB".into()));
    }
    Ok(())
}

fn read_file(path: &Path) -> Result<String, AppError> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() {
        return Err(AppError::Invalid(
            "--file harus file biasa yang bisa dibaca".into(),
        ));
    }
    let file = File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(AppError::Invalid(
            "--file harus file biasa yang bisa dibaca".into(),
        ));
    }
    let mut bytes = Vec::new();
    file.take(BODY_LIMIT as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > BODY_LIMIT {
        return Err(AppError::Invalid("Isi maksimal 200 KB".into()));
    }
    String::from_utf8(bytes).map_err(|_| AppError::Invalid("--file harus berisi teks UTF-8".into()))
}

fn json_line(value: &impl Serialize) -> Result<String, AppError> {
    serde_json::to_string(value)
        .map(|json| format!("{json}\n"))
        .map_err(|error| AppError::Other(error.to_string()))
}

fn json_lines<T: Serialize>(values: &[T]) -> Result<String, AppError> {
    let mut output = String::new();
    for value in values {
        output.push_str(&json_line(value)?);
    }
    Ok(output)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentProject {
    id: String,
    name: String,
    agent_dir: Option<String>,
}

#[derive(Serialize)]
struct ShownTask {
    #[serde(flatten)]
    detail: TaskDetail,
    body: String,
}

#[derive(Serialize)]
struct Thread {
    task: ShownTask,
    activities: Vec<Activity>,
}

fn run_inner(args: &[String], data_dir: &Path, now: i64) -> Result<String, AppError> {
    let command = parse(args)?;
    let path = data_dir.join("anchoa.db");
    match fs::metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::Invalid("Buka Anchoa sekali dulu".into()));
        }
        Err(error) => return Err(error.into()),
        Ok(metadata) if !metadata.is_file() => {
            return Err(AppError::Invalid("Database harus file biasa".into()));
        }
        Ok(_) => {}
    }
    // Shares db::open's WAL, five-second busy timeout and migrations, with CREATE disabled.
    let conn = db::open_existing(&path)?;
    execute(command, &conn, now)
}

fn execute(command: Command<'_>, conn: &Connection, now: i64) -> Result<String, AppError> {
    let tz = TimeZone::system();
    match command {
        Command::Projects => {
            let mut stmt = conn.prepare("SELECT i.id, i.title, p.agent_dir FROM projects p JOIN items i ON i.id = p.item_id WHERE p.agent = 1 AND i.type = 'project' AND i.deleted_at IS NULL ORDER BY i.title COLLATE NOCASE, i.id")?;
            let projects = stmt
                .query_map([], |row| {
                    Ok(AgentProject {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        agent_dir: row.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            json_lines(&projects)
        }
        Command::Inbox { project } => {
            if let Some(id) = project {
                projects::get_project(conn, id, now, &tz)?;
            }
            json_lines(&activities::inbox(conn, project)?)
        }
        Command::NewTask {
            project,
            title,
            body,
        } => {
            validate_body(body)?;
            let task = tasks::create_task(
                conn,
                &NewTask {
                    title: title.into(),
                    project_id: Some(project.into()),
                    ..Default::default()
                },
                now,
                &tz,
            )?;
            if !body.is_empty() {
                items::update(
                    conn,
                    &task.id,
                    &items::ItemPatch {
                        body: Some(body.into()),
                        ..Default::default()
                    },
                    now,
                )?;
            }
            json_line(&task)
        }
        Command::Status {
            task,
            status,
            actor,
        } => {
            activities::set_status(conn, task, status, actor, now)?;
            json_line(&tasks::get_task(conn, task, now, &tz)?)
        }
        Command::Log {
            task,
            actor,
            role,
            kind,
            title,
            body,
        } => {
            let detail = tasks::get_task(conn, task, now, &tz)?;
            let project = detail
                .card
                .project_id
                .ok_or_else(|| AppError::Invalid("Tugas harus berada di proyek".into()))?;
            let body = match body {
                Body::Text(body) => {
                    validate_body(body)?;
                    body.into()
                }
                Body::File(file) => read_file(Path::new(file))?,
            };
            let title = title
                .unwrap_or_else(|| body.lines().next().unwrap_or_default())
                .to_string();
            json_line(&activities::add(
                conn,
                &NewActivity {
                    task_id: Some(task.into()),
                    project_id: project,
                    actor: actor.into(),
                    role,
                    kind,
                    title,
                    body,
                },
                now,
            )?)
        }
        Command::Plan { task, actor, file } => {
            let markdown = read_file(Path::new(file))?;
            json_line(&activities::save_plan(conn, task, actor, &markdown, now)?)
        }
        Command::Show { task } => json_line(&Thread {
            task: ShownTask {
                detail: tasks::get_task(conn, task, now, &tz)?,
                body: items::get(conn, task)?.body,
            },
            activities: activities::for_task(conn, task)?,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activities::{self, Kind, NewActivity, Role};
    use crate::{db, items, projects, tasks};
    use jiff::tz::TimeZone;
    use rusqlite::Connection;
    use serde_json::{Value, json};

    const NOW: i64 = 1_790_834_400_000;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    fn fixture() -> (tempfile::TempDir, Connection, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open(&dir.path().join("anchoa.db")).unwrap();
        let project = projects::save_project(
            &conn,
            &projects::ProjectInput {
                name: "Anchoa".into(),
                agent: true,
                ..Default::default()
            },
            NOW,
            &TimeZone::UTC,
        )
        .unwrap();
        let project_id = project.summary.id;
        let task = tasks::create_task(
            &conn,
            &tasks::NewTask {
                title: "CLI".into(),
                project_id: Some(project_id.clone()),
                ..Default::default()
            },
            NOW,
            &TimeZone::UTC,
        )
        .unwrap();
        (dir, conn, project_id, task.id)
    }

    fn success(values: &[&str], dir: &Path, now: i64) -> Vec<Value> {
        let (code, output) = run(&args(values), dir, now);
        assert_eq!(code, 0, "{:?}: {output}", values.first());
        output
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn error(values: &[&str], dir: &Path) -> String {
        let (code, output) = run(&args(values), dir, NOW);
        assert_eq!(code, 2, "{:?}: {output}", values.first());
        assert_eq!(output.lines().count(), 1);
        let value: Value = serde_json::from_str(output.trim_end()).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 1);
        let message = value["error"].as_str().unwrap();
        assert!(!message.is_empty());
        message.into()
    }

    fn request(conn: &Connection, project: &str, task: &str) {
        activities::add(
            conn,
            &NewActivity {
                task_id: Some(task.into()),
                project_id: project.into(),
                actor: "Kamu".into(),
                role: Role::Request,
                kind: Kind::Message,
                title: "Permintaan".into(),
                body: "Buat CLI".into(),
            },
            NOW,
        )
        .unwrap();
    }

    #[test]
    fn data_dir_matches_the_apps_xdg_location_and_identifier() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let identifier = config["identifier"].as_str().unwrap();
        assert_eq!(
            resolve_data_dir(Some(OsStr::new("/data")), None).unwrap(),
            Path::new("/data").join(identifier)
        );
        for xdg in [None, Some(OsStr::new("")), Some(OsStr::new("relative"))] {
            assert_eq!(
                resolve_data_dir(xdg, Some(OsStr::new("/home/test"))).unwrap(),
                Path::new("/home/test/.local/share").join(identifier)
            );
        }
        assert!(resolve_data_dir(None, None).is_err());
        assert!(resolve_data_dir(None, Some(OsStr::new(""))).is_err());
        assert!(resolve_data_dir(None, Some(OsStr::new("relative"))).is_err());
    }

    #[test]
    fn parser_accepts_all_subcommands() {
        let commands: &[&[&str]] = &[
            &["projects"],
            &["projects", "--json"],
            &["inbox"],
            &["inbox", "--project", "p"],
            &["task", "new", "--project", "p", "--title", "T"],
            &[
                "task",
                "new",
                "--title",
                "T",
                "--body",
                "B",
                "--project",
                "p",
            ],
            &["task", "status", "--task", "t", "test", "--actor", "Sol"],
            &["task", "status", "review", "--actor", "Sol", "--task", "t"],
            &[
                "log",
                "--task",
                "t",
                "--actor",
                "Sol",
                "--role",
                "implement",
                "--body",
                "halo",
            ],
            &[
                "log", "--file", "plan.md", "--task", "t", "--actor", "Sol", "--role", "plan",
                "--kind", "result", "--title", "Rencana",
            ],
            &["plan", "--task", "t", "--actor", "Sol", "--file", "plan.md"],
            &["show", "--task", "t"],
        ];
        for command in commands {
            assert!(parse(&args(command)).is_ok(), "{command:?}");
        }
        for status in ["plan", "doing", "test", "review", "done"] {
            assert!(
                parse(&args(&[
                    "task", "status", "--task", "t", status, "--actor", "Sol"
                ]))
                .is_ok()
            );
        }
        for role in [
            "request",
            "plan",
            "implement",
            "test",
            "review",
            "merge",
            "note",
        ] {
            for kind in ["message", "status", "result", "link"] {
                assert!(
                    parse(&args(&[
                        "log", "--task", "t", "--actor", "Sol", "--role", role, "--kind", kind,
                        "--body", "B"
                    ]))
                    .is_ok()
                );
            }
        }
    }

    #[test]
    fn invalid_arguments_return_exit_2_and_error_json() {
        let dir = tempfile::tempdir().unwrap();
        let invalid: &[&[&str]] = &[
            &[],
            &["unknown"],
            &["task"],
            &["task", "delete"],
            &["projects", "extra"],
            &["projects", "--project", "p"],
            &["projects", "--json", "--json"],
            &["inbox", "--project"],
            &["inbox", "--project", ""],
            &["inbox", "--project", "p", "--project", "p"],
            &["task", "new", "--project", "p"],
            &["task", "new", "--title", "T"],
            &["task", "new", "--project", "p", "--title", "   "],
            &["task", "status", "--task", "t", "done"],
            &["task", "status", "--task", "t", "--actor", "Sol"],
            &[
                "task", "status", "--task", "t", "done", "review", "--actor", "Sol",
            ],
            &["task", "status", "--task", "t", "bad", "--actor", "Sol"],
            &[
                "log", "--task", "t", "--actor", "Sol", "--role", "bad", "--body", "B",
            ],
            &[
                "log", "--task", "t", "--actor", "Sol", "--role", "note", "--kind", "bad",
                "--body", "B",
            ],
            &["log", "--task", "t", "--actor", "Sol", "--role", "note"],
            &[
                "log", "--task", "t", "--actor", "Sol", "--role", "note", "--body", "B", "--file",
                "f",
            ],
            &[
                "log", "--task", "t", "--actor", "", "--role", "note", "--body", "B",
            ],
            &["plan", "--task", "t", "--file", "f"],
            &["show"],
            &["show", "--task"],
        ];
        for command in invalid {
            error(command, dir.path());
            assert!(parse(&args(command)).is_err(), "{command:?}");
        }
    }

    #[test]
    fn missing_database_returns_error_without_creating_files() {
        let dir = tempfile::tempdir().unwrap();
        for data_dir in [dir.path().to_path_buf(), dir.path().join("missing")] {
            assert_eq!(error(&["projects"], &data_dir), "Buka Anchoa sekali dulu");
            assert!(!data_dir.join("anchoa.db").exists());
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn database_open_failure_preserves_the_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        std::fs::write(&path, b"not a SQLite database").unwrap();
        error(&["projects"], dir.path());
        assert_eq!(std::fs::read(&path).unwrap(), b"not a SQLite database");
    }

    #[test]
    fn projects_lists_only_live_agent_projects_as_json_lines() {
        let (dir, conn, project, _) = fixture();
        let ordinary = projects::save_project(
            &conn,
            &projects::ProjectInput {
                name: "Biasa".into(),
                ..Default::default()
            },
            NOW,
            &TimeZone::UTC,
        )
        .unwrap();
        let deleted = projects::save_project(
            &conn,
            &projects::ProjectInput {
                name: "Dihapus".into(),
                agent: true,
                ..Default::default()
            },
            NOW,
            &TimeZone::UTC,
        )
        .unwrap();
        items::soft_delete(&conn, &deleted.summary.id, NOW).unwrap();
        conn.execute(
            "UPDATE projects SET agent_dir = '/repo' WHERE item_id = ?1",
            [&project],
        )
        .unwrap();
        assert_eq!(
            success(&["projects", "--json"], dir.path(), NOW),
            vec![json!({"id": project, "name": "Anchoa", "agentDir": "/repo"})]
        );
        items::soft_delete(&conn, &project, NOW).unwrap();
        assert!(success(&["projects"], dir.path(), NOW).is_empty());
        assert!(items::get(&conn, &ordinary.summary.id).is_ok());
    }

    #[test]
    fn task_new_creates_a_plan_task_and_saves_optional_body() {
        let (dir, conn, project, _) = fixture();
        for body in [None, Some("Isi\n\"Markdown\"")] {
            let mut command = vec![
                "task",
                "new",
                "--project",
                &project,
                "--title",
                "Tugas baru",
            ];
            if let Some(body) = body {
                command.extend(["--body", body]);
            }
            let output = success(&command, dir.path(), NOW);
            assert_eq!(output.len(), 1);
            assert_eq!(output[0]["status"], "plan");
            assert_eq!(output[0]["projectId"], project);
            let item = items::get(&conn, output[0]["id"].as_str().unwrap()).unwrap();
            assert_eq!(item.title, "Tugas baru");
            assert_eq!(item.body, body.unwrap_or_default());
        }
    }

    #[test]
    fn task_status_writes_an_activity() {
        let (dir, conn, _, task) = fixture();
        let output = success(
            &["task", "status", "--task", &task, "test", "--actor", "Sol"],
            dir.path(),
            NOW + 1,
        );
        assert_eq!(output[0]["status"], "test");
        let history = activities::for_task(&conn, &task).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].actor, "Sol");
        assert_eq!(history[0].kind, Kind::Status);
        assert_eq!(history[0].role, Role::Test);
        assert_eq!(history[0].title, "Sol memindahkan ke Tes");
        assert_eq!(history[0].created_at, NOW + 1);
    }

    #[test]
    fn option_values_may_start_with_dashes() {
        let (dir, _conn, _, task) = fixture();
        let output = success(
            &["log", "--task", &task, "--actor", "Sol", "--role", "plan", "--body", "---\njudul: x\n---"],
            dir.path(),
            NOW + 1,
        );
        assert_eq!(output[0]["body"], "---\njudul: x\n---");
    }

    #[test]
    fn log_accepts_body_or_file_and_defaults_to_message() {
        let (dir, conn, _, task) = fixture();
        let output = success(
            &[
                "log",
                "--task",
                &task,
                "--actor",
                "Sol",
                "--role",
                "implement",
                "--body",
                "halo\nbaris kedua",
            ],
            dir.path(),
            NOW + 1,
        );
        assert_eq!(output[0]["kind"], "message");
        assert_eq!(output[0]["title"], "halo");
        let file = dir.path().join("hasil tes.md");
        std::fs::write(&file, "Semua tes lulus\n").unwrap();
        let output = success(
            &[
                "log",
                "--task",
                &task,
                "--actor",
                "Sol",
                "--role",
                "test",
                "--kind",
                "result",
                "--title",
                "Tes",
                "--file",
                file.to_str().unwrap(),
            ],
            dir.path(),
            NOW + 2,
        );
        assert_eq!(output[0]["body"], "Semua tes lulus\n");
        assert_eq!(output[0]["title"], "Tes");
        assert_eq!(activities::for_task(&conn, &task).unwrap().len(), 2);
    }

    #[test]
    fn inbox_lists_requests_without_follow_up_and_filters_project() {
        let (dir, conn, project, task) = fixture();
        request(&conn, &project, &task);
        let other = projects::save_project(
            &conn,
            &projects::ProjectInput {
                name: "Lain".into(),
                agent: true,
                ..Default::default()
            },
            NOW,
            &TimeZone::UTC,
        )
        .unwrap();
        let other_task = tasks::create_task(
            &conn,
            &tasks::NewTask {
                title: "Lain".into(),
                project_id: Some(other.summary.id.clone()),
                ..Default::default()
            },
            NOW,
            &TimeZone::UTC,
        )
        .unwrap();
        request(&conn, &other.summary.id, &other_task.id);
        assert_eq!(success(&["inbox"], dir.path(), NOW).len(), 2);
        let output = success(&["inbox", "--project", &project], dir.path(), NOW);
        assert_eq!(output.len(), 1);
        assert_eq!(output[0]["id"], task);
        success(
            &[
                "log",
                "--task",
                &task,
                "--actor",
                "Sol",
                "--role",
                "implement",
                "--body",
                "Mulai",
            ],
            dir.path(),
            NOW + 1,
        );
        assert!(success(&["inbox", "--project", &project], dir.path(), NOW + 1).is_empty());
    }

    #[test]
    fn plan_reads_file_and_writes_activity_and_notes_page() {
        let (dir, conn, _, task) = fixture();
        let file = dir.path().join("rencana.md");
        let markdown = "# Rencana\n\nBangun CLI.\n";
        std::fs::write(&file, markdown).unwrap();
        let output = success(
            &[
                "plan",
                "--task",
                &task,
                "--actor",
                "Sol",
                "--file",
                file.to_str().unwrap(),
            ],
            dir.path(),
            NOW + 1,
        );
        assert_eq!(output.len(), 1);
        assert_eq!(output[0]["role"], "plan");
        assert_eq!(output[0]["body"], markdown);
        assert_eq!(
            activities::for_task(&conn, &task).unwrap()[0].body,
            markdown
        );
        let page_body: String = conn.query_row("SELECT child.body FROM items child JOIN items parent ON parent.id = child.parent_id WHERE child.type = 'page' AND child.title = 'CLI' AND parent.title = 'Rencana Anchoa' AND child.deleted_at IS NULL AND parent.deleted_at IS NULL", [], |row| row.get(0)).unwrap();
        assert_eq!(page_body, markdown);
    }

    #[test]
    fn show_returns_task_body_and_chronological_activities() {
        let (dir, conn, project, task) = fixture();
        items::update(
            &conn,
            &task,
            &items::ItemPatch {
                body: Some("Isi tugas".into()),
                ..Default::default()
            },
            NOW,
        )
        .unwrap();
        request(&conn, &project, &task);
        success(
            &["task", "status", "--task", &task, "doing", "--actor", "Sol"],
            dir.path(),
            NOW + 1,
        );
        let output = success(&["show", "--task", &task], dir.path(), NOW + 2);
        assert_eq!(output.len(), 1);
        assert_eq!(output[0]["task"]["id"], task);
        assert_eq!(output[0]["task"]["body"], "Isi tugas");
        assert_eq!(output[0]["task"]["status"], "doing");
        let history = output[0]["activities"].as_array().unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0]["role"], "request");
        assert_eq!(history[1]["role"], "implement");
    }

    #[test]
    fn ids_must_exist_and_soft_deleted_ids_are_rejected() {
        let (dir, conn, project, task) = fixture();
        for (project, task) in [("missing", "missing"), (project.as_str(), task.as_str())] {
            if project != "missing" {
                tasks::delete_task(&conn, task, NOW).unwrap();
                projects::delete_project(&conn, project, NOW).unwrap();
            }
            for command in [
                vec!["inbox", "--project", project],
                vec!["task", "new", "--project", project, "--title", "T"],
                vec!["task", "status", "--task", task, "test", "--actor", "Sol"],
                vec![
                    "log", "--task", task, "--actor", "Sol", "--role", "note", "--body", "B",
                ],
                vec!["show", "--task", task],
            ] {
                error(&command, dir.path());
            }
        }
    }

    #[test]
    fn files_must_be_readable_regular_utf8_files_and_body_is_bounded() {
        let (dir, conn, project, task) = fixture();
        let bad_utf8 = dir.path().join("binary.md");
        std::fs::write(&bad_utf8, [0xff, 0xfe]).unwrap();
        let oversized = dir.path().join("large.md");
        std::fs::write(&oversized, "x".repeat(200 * 1024 + 1)).unwrap();
        for file in [
            dir.path().join("missing.md"),
            dir.path().to_path_buf(),
            bad_utf8,
            oversized,
        ] {
            for command in [
                vec![
                    "plan",
                    "--task",
                    &task,
                    "--actor",
                    "Sol",
                    "--file",
                    file.to_str().unwrap(),
                ],
                vec![
                    "log",
                    "--task",
                    &task,
                    "--actor",
                    "Sol",
                    "--role",
                    "note",
                    "--file",
                    file.to_str().unwrap(),
                ],
            ] {
                error(&command, dir.path());
            }
        }
        let oversized_body = "é".repeat(100 * 1024 + 1);
        error(
            &[
                "log",
                "--task",
                &task,
                "--actor",
                "Sol",
                "--role",
                "note",
                "--body",
                &oversized_body,
            ],
            dir.path(),
        );
        error(
            &[
                "task",
                "new",
                "--project",
                &project,
                "--title",
                "Grand",
                "--body",
                &oversized_body,
            ],
            dir.path(),
        );
        assert!(activities::for_task(&conn, &task).unwrap().is_empty());
        let task_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(task_count, 1);
        let boundary_body = "é".repeat(100 * 1024);
        success(
            &[
                "log",
                "--task",
                &task,
                "--actor",
                "Sol",
                "--role",
                "note",
                "--body",
                &boundary_body,
            ],
            dir.path(),
            NOW,
        );
    }
}
