//! Agent commands are started only by an explicit request from the UI.
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use jiff::tz::TimeZone;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::activities::{self, Kind, NewActivity, Role};
use crate::db::Db;
use crate::error::AppError;
use crate::projects::{self, ProjectDetail};
use crate::tasks::{self, NewTask, TaskCard};
use crate::time;

const LOG_LIMIT: usize = 64 * 1024;

#[derive(Default)]
pub struct AgentRunner {
    // Workers share only the process map; they acquire the DB after the child exits.
    inner: Arc<Mutex<HashMap<String, Child>>>,
}

impl AgentRunner {
    fn map(&self) -> Result<MutexGuard<'_, HashMap<String, Child>>, AppError> {
        self.inner
            .lock()
            .map_err(|_| AppError::Other("Mutex poisoned".into()))
    }

    pub fn ensure_idle(&self, project_id: &str) -> Result<(), AppError> {
        if self.map()?.contains_key(project_id) {
            return Err(AppError::Invalid("Agen masih berjalan".into()));
        }
        Ok(())
    }

    /// Locks the DB briefly to load configuration; callers must not hold its guard.
    pub fn start(
        &self,
        app: &AppHandle,
        project_id: &str,
        task_id: &str,
        request: &str,
    ) -> Result<(), AppError> {
        let (project, task) = {
            let db = app.state::<Db>();
            let conn = db.conn()?;
            let now = time::now_ms();
            let tz = TimeZone::system();
            (
                projects::get_project(&conn, project_id, now, &tz)?,
                tasks::get_task(&conn, task_id, now, &tz)?.card,
            )
        };
        let data_dir = app.path().app_data_dir()?;
        let app = app.clone();
        let project_id = project_id.to_string();
        let task_id = task_id.to_string();
        self.start_command(&data_dir, &project, &task, request, move |outcome| {
            if let Some(db) = app.try_state::<Db>() {
                record_outcome(&db, &project_id, &task_id, outcome);
            }
        })
    }

    fn start_command(
        &self,
        data_dir: &Path,
        project: &ProjectDetail,
        task: &TaskCard,
        request: &str,
        on_exit: impl FnOnce(Result<ExitStatus, AppError>) + Send + 'static,
    ) -> Result<(), AppError> {
        let project_id = &project.summary.id;
        let mut map = self.map()?;
        if map.contains_key(project_id) {
            return Err(AppError::Invalid("Agen masih berjalan".into()));
        }
        if task.project_id.as_deref() != Some(project_id.as_str()) {
            return Err(AppError::Invalid("Tugas tidak berada di proyek ini".into()));
        }
        // Revalidate at execution time: the saved directory may have disappeared or changed.
        let (command, dir) = command_config(project)?;
        let log_path = log_path(data_dir, &task.id)?;
        let cli = std::env::current_exe()?;
        std::fs::create_dir_all(data_dir.join("agent-runs"))?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)?;
        let mut command_process = Command::new("sh");
        command_process
            .args(["-c", command])
            .current_dir(dir)
            .env("ANCHOA_PROJECT", project_id)
            .env("ANCHOA_TASK", &task.id)
            .env("ANCHOA_REQUEST", request)
            .env("ANCHOA_CLI", cli)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log.try_clone()?))
            .stderr(Stdio::from(log));
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command_process.process_group(0);
        }
        let child = command_process.spawn()?;
        map.insert(project_id.clone(), child);

        let inner = self.inner.clone();
        let worker_project = project_id.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("agent-runner".into())
            .spawn(move || {
                wait_for_child(inner, worker_project, on_exit);
            })
        {
            if let Some(mut child) = map.remove(project_id) {
                let _ = stop_child(&mut child);
                let _ = child.wait();
            }
            return Err(error.into());
        }
        Ok(())
    }

    pub fn stop(&self, project_id: &str) -> Result<(), AppError> {
        if let Some(child) = self.map()?.get_mut(project_id) {
            stop_child(child)?;
        }
        Ok(())
    }

    pub fn stop_all(&self) {
        if let Ok(mut map) = self.map() {
            for child in map.values_mut() {
                if let Err(error) = stop_child(child) {
                    log::error!("failed to stop agent: {error}");
                }
            }
        }
    }

    pub fn running(&self) -> Vec<String> {
        let Ok(map) = self.map() else {
            return Vec::new();
        };
        let mut projects: Vec<_> = map.keys().cloned().collect();
        projects.sort();
        projects
    }
}

fn command_config(project: &ProjectDetail) -> Result<(&str, PathBuf), AppError> {
    if !project.agent {
        return Err(AppError::Invalid("Proyek bukan proyek agen".into()));
    }
    let command = project
        .agent_command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .ok_or_else(|| AppError::Invalid("Perintah agen belum diisi".into()))?;
    let dir = projects::validate_agent_dir(project.agent_dir.as_deref())?
        .ok_or_else(|| AppError::Invalid("Folder agen belum diisi".into()))?;
    Ok((command, PathBuf::from(dir)))
}

fn stop_child(child: &mut Child) -> Result<(), AppError> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }
    // Kill the shell's process group, including the agent it launched.
    #[cfg(unix)]
    if Command::new("sh")
        .args([
            "-c",
            "kill -KILL -- -\"$1\"",
            "anchoa-stop",
            &child.id().to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
    {
        return Ok(());
    }
    child.kill()?;
    Ok(())
}

fn wait_for_child(
    inner: Arc<Mutex<HashMap<String, Child>>>,
    project_id: String,
    on_exit: impl FnOnce(Result<ExitStatus, AppError>),
) {
    let outcome = loop {
        let status = {
            let Ok(mut map) = inner.lock() else {
                return;
            };
            let Some(child) = map.get_mut(&project_id) else {
                return;
            };
            child.try_wait()
        };
        match status {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                if let Ok(mut map) = inner.lock()
                    && let Some(child) = map.get_mut(&project_id)
                {
                    let _ = stop_child(child);
                    let _ = child.wait();
                }
                break Err(error.into());
            }
        }
    };
    // Neither the process map nor the DB is locked during the wait above.
    on_exit(outcome);
    if let Ok(mut map) = inner.lock() {
        map.remove(&project_id);
    }
}

fn record_outcome(db: &Db, project_id: &str, task_id: &str, outcome: Result<ExitStatus, AppError>) {
    let title = match outcome {
        Ok(status) if status.success() => return,
        Ok(status) => {
            #[cfg(unix)]
            let code = {
                use std::os::unix::process::ExitStatusExt;
                status
                    .code()
                    .or_else(|| status.signal().map(|signal| 128 + signal))
            };
            #[cfg(not(unix))]
            let code = status.code();
            format!("Agen gagal (kode {})", code.unwrap_or(-1))
        }
        Err(error) => format!("Agen gagal: {error}"),
    };
    let result = db.conn().and_then(|conn| {
        activities::add(
            &conn,
            &NewActivity {
                task_id: Some(task_id.into()),
                project_id: project_id.into(),
                actor: "Anchoa".into(),
                role: Role::Note,
                kind: Kind::Result,
                body: title.clone(),
                title,
            },
            time::now_ms(),
        )
    });
    if let Err(error) = result {
        log::error!("failed to record agent exit for task {task_id}: {error}");
    }
}

/// A request without a command remains in the inbox until an agent picks it up.
pub fn create_request(
    conn: &Connection,
    project_id: &str,
    text: &str,
    now: i64,
    tz: &TimeZone,
) -> Result<(TaskCard, bool), AppError> {
    if text.trim().is_empty() {
        return Err(AppError::Empty);
    }
    if text.len() > 200 * 1024 {
        return Err(AppError::Invalid("Isi aktivitas maksimal 200 KB".into()));
    }
    let project = projects::get_project(conn, project_id, now, tz)?;
    if !project.agent {
        return Err(AppError::Invalid("Proyek bukan proyek agen".into()));
    }
    let should_start = project
        .agent_command
        .as_deref()
        .is_some_and(|command| !command.trim().is_empty());
    if should_start {
        command_config(&project)?;
    }
    let title: String = text
        .trim()
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .take(120)
        .collect();
    let task = tasks::create_task(
        conn,
        &NewTask {
            title: title.clone(),
            project_id: Some(project_id.into()),
            ..Default::default()
        },
        now,
        tz,
    )?;
    activities::add(
        conn,
        &NewActivity {
            task_id: Some(task.id.clone()),
            project_id: project_id.into(),
            actor: "Kamu".into(),
            role: Role::Request,
            kind: Kind::Message,
            title,
            body: text.into(),
        },
        now,
    )?;
    Ok((task, should_start))
}

fn log_path(data_dir: &Path, task_id: &str) -> Result<PathBuf, AppError> {
    let id = uuid::Uuid::parse_str(task_id)
        .map_err(|_| AppError::Invalid("ID tugas tidak valid".into()))?;
    Ok(data_dir.join("agent-runs").join(format!("{id}.log")))
}

pub fn read_log(data_dir: &Path, task_id: &str) -> Result<String, AppError> {
    let mut file = match File::open(log_path(data_dir, task_id)?) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(error.into()),
    };
    let start = file.metadata()?.len().saturating_sub(LOG_LIMIT as u64);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity(LOG_LIMIT);
    file.take(LOG_LIMIT as u64).read_to_end(&mut bytes)?;
    let boundary = if start > 0 {
        bytes
            .iter()
            .take_while(|byte| **byte & 0xc0 == 0x80)
            .count()
    } else {
        0
    };
    let text = String::from_utf8_lossy(&bytes[boundary..]);
    // Invalid bytes can expand to three-byte replacement characters; bound the result too.
    let mut from = text.len().saturating_sub(LOG_LIMIT);
    while !text.is_char_boundary(from) {
        from += 1;
    }
    Ok(text[from..].into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activities::{Kind, Role};
    use crate::projects::ProjectInput;
    use crate::tasks::{NewTask, TaskStatus};
    use jiff::tz::TimeZone;
    use rusqlite::params;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    struct Fixture {
        dir: tempfile::TempDir,
        db: Arc<Db>,
        runner: AgentRunner,
        project_id: String,
        task_id: String,
    }

    impl Fixture {
        fn new(command: &str) -> Self {
            // The real project validator requires a folder under home.
            let dir = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
            let db = Arc::new(Db::open_at(dir.path().join("anchoa.db")));
            let (project_id, task_id) = {
                let conn = db.conn().unwrap();
                let project = projects::save_project(
                    &conn,
                    &ProjectInput {
                        name: "Agen".into(),
                        agent: true,
                        agent_command: Some(command.into()),
                        agent_dir: Some(dir.path().to_str().unwrap().into()),
                        ..Default::default()
                    },
                    1000,
                    &TimeZone::UTC,
                )
                .unwrap();
                let project_id = project.summary.id;
                let task = tasks::create_task(
                    &conn,
                    &NewTask {
                        title: "Jalankan agen".into(),
                        project_id: Some(project_id.clone()),
                        ..Default::default()
                    },
                    1000,
                    &TimeZone::UTC,
                )
                .unwrap();
                (project_id, task.id)
            };
            Self {
                dir,
                db,
                runner: AgentRunner::default(),
                project_id,
                task_id,
            }
        }

        fn start(&self, request: &str) -> Result<(), AppError> {
            self.start_on(&self.runner, request)
        }

        fn start_on(&self, runner: &AgentRunner, request: &str) -> Result<(), AppError> {
            let (project, task) = {
                let conn = self.db.conn()?;
                (
                    projects::get_project(&conn, &self.project_id, 1000, &TimeZone::UTC)?,
                    tasks::get_task(&conn, &self.task_id, 1000, &TimeZone::UTC)?.card,
                )
            };
            let db = self.db.clone();
            let project_id = self.project_id.clone();
            let task_id = self.task_id.clone();
            runner.start_command(self.dir.path(), &project, &task, request, move |outcome| {
                record_outcome(&db, &project_id, &task_id, outcome)
            })
        }

        fn wait(&self) {
            until(|| self.runner.running().is_empty());
        }

        fn log(&self) -> String {
            read_log(self.dir.path(), &self.task_id).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.runner.stop_all();
        }
    }

    fn until(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            assert!(Instant::now() < deadline, "agent did not finish in time");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn start_runs_the_command_with_env_and_logs_output() {
        let fixture = Fixture::new(
            "printf '%s\\n' \"$ANCHOA_PROJECT\" \"$ANCHOA_TASK\" \"$ANCHOA_REQUEST\" \"$ANCHOA_CLI\"; pwd; printf 'stderr\\n' >&2",
        );
        let log_dir = fixture.dir.path().join("agent-runs");
        std::fs::create_dir(&log_dir).unwrap();
        std::fs::write(
            log_dir.join(format!("{}.log", fixture.task_id)),
            "earlier\n",
        )
        .unwrap();
        let request = "Permintaan 'teks'\n$literal; $(literal)";
        fixture.start(request).unwrap();
        fixture.wait();
        let expected = format!(
            "earlier\n{}\n{}\n{}\n{}\n{}\nstderr\n",
            fixture.project_id,
            fixture.task_id,
            request,
            std::env::current_exe().unwrap().display(),
            fixture.dir.path().canonicalize().unwrap().display(),
        );
        assert_eq!(fixture.log(), expected);
        assert!(
            activities::for_task(&fixture.db.conn().unwrap(), &fixture.task_id)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn failure_writes_an_activity() {
        let fixture = Fixture::new("echo gagal >&2; exit 7");
        fixture.start("Kerjakan").unwrap();
        fixture.wait();
        let history = activities::for_task(&fixture.db.conn().unwrap(), &fixture.task_id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].title, "Agen gagal (kode 7)");
        assert_eq!(history[0].actor, "Anchoa");
        assert_eq!(history[0].role, Role::Note);
        assert_eq!(history[0].kind, Kind::Result);
        assert_eq!(
            history[0].task_id.as_deref(),
            Some(fixture.task_id.as_str())
        );
        assert_eq!(history[0].project_id, fixture.project_id);
        assert_eq!(fixture.log(), "gagal\n");
    }

    #[test]
    fn only_one_run_per_project() {
        let mut fixture = Fixture::new("exec sleep 30");
        fixture.start("Pertama").unwrap();
        assert_eq!(fixture.runner.running(), vec![fixture.project_id.clone()]);
        fixture.task_id = tasks::create_task(
            &fixture.db.conn().unwrap(),
            &NewTask {
                title: "Tugas lain".into(),
                project_id: Some(fixture.project_id.clone()),
                ..Default::default()
            },
            1000,
            &TimeZone::UTC,
        )
        .unwrap()
        .id;
        assert!(
            matches!(fixture.start("Kedua"), Err(AppError::Invalid(message)) if message == "Agen masih berjalan")
        );
        // Commands and the CLI must still be able to use the DB while the child runs.
        assert!(fixture.db.conn().is_ok());
        fixture.runner.stop(&fixture.project_id).unwrap();
        fixture.wait();
        fixture.start("Lagi").unwrap();
        fixture.runner.stop(&fixture.project_id).unwrap();
        fixture.wait();
    }

    #[test]
    fn separate_projects_can_run_and_stop_all_kills_every_child() {
        let first = Fixture::new("exec sleep 30");
        let second = Fixture::new("exec sleep 30");
        first.start("Pertama").unwrap();
        second.start_on(&first.runner, "Kedua").unwrap();
        let mut expected = vec![first.project_id.clone(), second.project_id.clone()];
        expected.sort();
        assert_eq!(first.runner.running(), expected);
        first.runner.stop_all();
        first.wait();
    }

    #[test]
    fn stop_kills_the_child() {
        let fixture = Fixture::new("echo started; exec sleep 30");
        fixture.start("Kerjakan").unwrap();
        until(|| fixture.log().contains("started"));
        fixture.runner.stop(&fixture.project_id).unwrap();
        fixture.wait();
        assert!(fixture.runner.running().is_empty());
        fixture.runner.stop(&fixture.project_id).unwrap();
    }

    #[test]
    fn start_revalidates_the_directory_and_requires_agent_configuration() {
        let fixture = Fixture::new("echo should-not-run");
        let missing = fixture.dir.path().join("missing");
        let file = fixture.dir.path().join("file");
        std::fs::write(&file, "file").unwrap();
        for dir in [
            None,
            Some(""),
            Some("/tmp"),
            missing.to_str(),
            file.to_str(),
        ] {
            fixture
                .db
                .conn()
                .unwrap()
                .execute(
                    "UPDATE projects SET agent_dir = ?1 WHERE item_id = ?2",
                    params![dir, fixture.project_id],
                )
                .unwrap();
            assert!(matches!(
                fixture.start("Kerjakan"),
                Err(AppError::Invalid(_))
            ));
            assert!(fixture.runner.running().is_empty());
        }
        #[cfg(unix)]
        {
            let link = fixture.dir.path().join("repo-link");
            std::os::unix::fs::symlink("/tmp", &link).unwrap();
            fixture
                .db
                .conn()
                .unwrap()
                .execute(
                    "UPDATE projects SET agent_dir = ?1 WHERE item_id = ?2",
                    params![link.to_str().unwrap(), fixture.project_id],
                )
                .unwrap();
            assert!(matches!(
                fixture.start("Kerjakan"),
                Err(AppError::Invalid(_))
            ));
        }
        fixture
            .db
            .conn()
            .unwrap()
            .execute(
                "UPDATE projects SET agent_dir = ?1, agent = 0 WHERE item_id = ?2",
                params![fixture.dir.path().to_str().unwrap(), fixture.project_id],
            )
            .unwrap();
        assert!(matches!(
            fixture.start("Kerjakan"),
            Err(AppError::Invalid(_))
        ));
        assert!(!fixture.dir.path().join("agent-runs").exists());
    }

    #[test]
    fn log_returns_the_last_64_kb_on_a_utf8_boundary() {
        let fixture = Fixture::new("true");
        assert_eq!(fixture.log(), "");
        let log_dir = fixture.dir.path().join("agent-runs");
        std::fs::create_dir(&log_dir).unwrap();
        let log_path = log_dir.join(format!("{}.log", fixture.task_id));
        let contents = format!("old\n{}END", "€".repeat(30_000));
        std::fs::write(&log_path, &contents).unwrap();
        let tail = fixture.log();
        assert!(tail.len() <= 64 * 1024);
        assert!(contents.ends_with(&tail));
        assert!(tail.starts_with('€'));
        assert!(tail.ends_with("END"));
        assert!(!tail.contains('\u{fffd}'));
        // Even binary output cannot make replacement characters exceed the byte limit.
        std::fs::write(&log_path, vec![0xff; 70_000]).unwrap();
        assert!(fixture.log().len() <= 64 * 1024);
        assert!(read_log(fixture.dir.path(), "../../anchoa.db").is_err());
    }

    #[test]
    fn request_without_command_stays_in_plan_with_a_request_activity() {
        let fixture = Fixture::new("true");
        fixture
            .db
            .conn()
            .unwrap()
            .execute(
                "UPDATE projects SET agent_command = NULL, agent_dir = NULL WHERE item_id = ?1",
                [&fixture.project_id],
            )
            .unwrap();
        let text = "Tambahkan pencarian\nDengan filter proyek";
        let (task, should_start) = create_request(
            &fixture.db.conn().unwrap(),
            &fixture.project_id,
            text,
            2000,
            &TimeZone::UTC,
        )
        .unwrap();
        assert!(!should_start);
        assert_eq!(task.status, TaskStatus::Plan);
        assert_eq!(task.title, "Tambahkan pencarian");
        let conn = fixture.db.conn().unwrap();
        let history = activities::for_task(&conn, &task.id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].actor, "Kamu");
        assert_eq!(history[0].role, Role::Request);
        assert_eq!(history[0].kind, Kind::Message);
        assert_eq!(history[0].body, text);
        assert!(
            activities::inbox(&conn, Some(&fixture.project_id))
                .unwrap()
                .iter()
                .any(|t| t.id == task.id)
        );
        assert!(fixture.runner.running().is_empty());
        assert!(!fixture.dir.path().join("agent-runs").exists());
    }

    #[test]
    fn invalid_requests_do_not_create_tasks() {
        let fixture = Fixture::new("true");
        let conn = fixture.db.conn().unwrap();
        for text in ["".to_string(), " \n ".into(), "x".repeat(200 * 1024 + 1)] {
            assert!(
                create_request(&conn, &fixture.project_id, &text, 2000, &TimeZone::UTC).is_err()
            );
        }
        assert!(create_request(&conn, "missing", "hello", 2000, &TimeZone::UTC).is_err());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
