//! Detection and listing of remote storage backends for the file manager.
//!
//! rclone is the primary transport: FTP, SFTP, S3, WebDAV and friends are all
//! driven through configured rclone remotes (`rclone listremotes`), so Anchoa
//! never implements protocol clients and never touches `rclone.conf`
//! (it holds credentials — we only ever ask rclone for remote NAMES and file
//! metadata).
//!
//! Detection never touches the network and never blocks: it reads
//! `/proc/mounts` (network fs types), probes for the `rclone` binary and runs
//! a timed-out `rclone listremotes`.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::files::{Crumb, Entry, FileKind, Listing, Place};

/// How long any single rclone invocation may run before we give up.
/// A hung network mount must surface as an error, not freeze the app.
const RCLONE_TIMEOUT: Duration = Duration::from_secs(15);
/// Upper bound on subprocess output we are willing to read.
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

/// Marker prefix every remote path carries. The frontend uses it to route
/// listing to `list_remote` instead of the local filesystem path guard.
pub const REMOTE_PREFIX: &str = "rclone:";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePlaces {
    /// True when an `rclone` binary was found on PATH.
    pub available: bool,
    /// `rclone version` first line, when available. Names only, no env dumps.
    pub version: Option<String>,
    /// Configured rclone remotes (names only, never config contents).
    pub remotes: Vec<Place>,
    /// Network filesystems already mounted (fuse.rclone, nfs, cifs, sshfs, davfs).
    pub mounts: Vec<Place>,
    /// Human hint when rclone is missing (Indonesian, install guidance).
    pub hint: Option<String>,
}

// ---------------------------------------------------------------------------
// rclone discovery
// ---------------------------------------------------------------------------

/// Look for an `rclone` binary on a `:`-separated PATH. Missing binary is normal.
pub fn find_rclone(path_env: Option<&str>) -> Option<PathBuf> {
    let path = path_env?;
    for dir in path.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join("rclone");
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(m) => m.is_file() && m.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

// ---------------------------------------------------------------------------
// `rclone listremotes` parsing
// ---------------------------------------------------------------------------

/// Parse `rclone listremotes` output: one remote per line, each ending in `:`.
/// Whitespace and empty lines are ignored; a line without a trailing `:` is
/// tolerated and still accepted (older rclone builds print the bare name).
pub fn parse_listremotes(output: &str) -> Vec<String> {
    let mut remotes = Vec::new();
    for line in output.lines() {
        let name = line.trim();
        if name.is_empty() {
            continue;
        }
        let name = name.strip_suffix(':').unwrap_or(name);
        if name.is_empty() || name.contains(char::is_whitespace) {
            continue;
        }
        if !remotes.iter().any(|r| r == name) {
            remotes.push(name.to_string());
        }
    }
    remotes
}

/// First line of `rclone version`, e.g. `rclone v1.67.0`. Never logs env or args.
fn parse_version(output: &str) -> Option<String> {
    output
        .lines()
        .next()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
}

// ---------------------------------------------------------------------------
// /proc/mounts: network filesystems
// ---------------------------------------------------------------------------

/// Filesystem types considered "remote storage already mounted".
pub fn is_network_fs_type(fs_type: &str) -> bool {
    matches!(
        fs_type,
        "fuse.rclone"
            | "nfs"
            | "nfs4"
            | "cifs"
            | "smb2"
            | "smb3"
            | "sshfs"
            | "davfs"
            | "davfs2"
            | "fuse.sshfs"
    )
}

/// Decode `\040`-style octal escapes used by /proc/mounts for spaces.
fn decode_octal(s: &str) -> String {
    if !s.contains('\\') {
        return s.to_string();
    }
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 3 < bytes.len() {
            let d1 = bytes[i + 1].wrapping_sub(b'0');
            let d2 = bytes[i + 2].wrapping_sub(b'0');
            let d3 = bytes[i + 3].wrapping_sub(b'0');
            if d1 <= 7 && d2 <= 7 && d3 <= 7 {
                out.push(d1 * 64 + d2 * 8 + d3);
                i += 4;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Parse /proc/mounts into `Place`s for network filesystem mount points.
/// Duplicates are removed; the mount point basename is used as the name.
pub fn parse_network_mounts(proc_mounts: &str) -> Vec<Place> {
    let mut mounts = Vec::new();
    let mut seen = HashSet::new();
    for line in proc_mounts.lines() {
        let mut parts = line.split_whitespace();
        let (Some(_dev), Some(mount), Some(fs_type)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        if !is_network_fs_type(fs_type) {
            continue;
        }
        let decoded = decode_octal(mount);
        if decoded.is_empty() || !seen.insert(decoded.clone()) {
            continue;
        }
        let name = Path::new(&decoded)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| decoded.clone());
        mounts.push(Place {
            name,
            path: decoded,
            icon: "remote".to_string(),
        });
    }
    mounts
}

// ---------------------------------------------------------------------------
// Listing a remote path: `rclone lsjson`
// ---------------------------------------------------------------------------

/// A single entry of `rclone lsjson` output (fields we care about). rclone
/// prints PascalCase keys: `Path`, `Name`, `Size`, `ModTime`, `IsDir`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct LsJsonEntry {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_dir: bool,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub mod_time: Option<String>,
}

/// Classify an rclone entry by extension, mirroring `files::kind_of` for local
/// files so FileGrid/FileList render both identically.
pub fn kind_from_name(name: &str) -> FileKind {
    let ext = name
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif" => FileKind::Image,
        "mp4" | "webm" | "mkv" | "mov" => FileKind::Video,
        "pdf" => FileKind::Pdf,
        "txt" | "md" | "json" | "toml" | "yaml" | "yml" | "rs" | "ts" | "tsx" | "js" | "css"
        | "html" | "sh" | "py" | "csv" | "log" => FileKind::Text,
        _ => FileKind::Other,
    }
}

/// rclone-modified ISO8601 ("2024-05-06T12:34:56.789Z") → epoch ms.
pub fn parse_mod_time(iso: &str) -> Option<i64> {
    iso.parse::<jiff::Timestamp>().ok().map(|t| t.as_millisecond())
}

/// Parse `rclone lsjson` JSON into the SAME `Listing` shape `files::list_dir`
/// returns, so FileGrid/FileList render remote listings unchanged.
pub fn parse_lsjson(listing_path: &str, json: &str) -> Result<Listing, AppError> {
    let raw: Vec<LsJsonEntry> = serde_json::from_str(json)
        .map_err(|e| AppError::Invalid(format!("Output rclone tidak valid: {e}")))?;

    let (remote_name, remote_root) = match listing_path.strip_prefix(REMOTE_PREFIX) {
        Some(rest) => match rest.split_once(':') {
            Some((name, sub)) => (name.to_string(), sub.to_string()),
            None => (rest.to_string(), String::new()),
        },
        None => (String::new(), String::new()),
    };
    let remote_root = remote_root.trim_matches('/').to_string();
    // Canonical `rclone:name:sub/dir` form (no slash after the colon), shared
    // by the listing, its crumbs, parent and entries so one folder has one key.
    let base = format!("{REMOTE_PREFIX}{remote_name}:");
    let canonical = format!("{base}{remote_root}");

    // First crumb carries the `rclone:gdrive:` label so the breadcrumb UI
    // makes the remote obvious at a glance. The user always knows they left
    // local disk.
    let mut crumbs = Vec::new();
    if !remote_name.is_empty() {
        crumbs.push(Crumb {
            name: base.clone(),
            path: base.clone(),
        });
        let mut cursor = base.clone();
        for comp in remote_root.split('/').filter(|c| !c.is_empty()) {
            if cursor.len() > base.len() {
                cursor.push('/');
            }
            cursor.push_str(comp);
            crumbs.push(Crumb {
                name: comp.to_string(),
                path: cursor.clone(),
            });
        }
    }

    // parent: None at the remote root, one level up otherwise.
    let parent = if remote_root.is_empty() {
        None
    } else {
        let up = remote_root
            .rsplit_once('/')
            .map(|(head, _)| head.to_string())
            .unwrap_or_default();
        Some(format!("{base}{up}"))
    };

    let mut entries: Vec<Entry> = Vec::with_capacity(raw.len());
    for item in raw {
        let name = if item.name.is_empty() {
            item.path.rsplit('/').next().unwrap_or("").to_string()
        } else {
            item.name.clone()
        };
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let hidden = name.starts_with('.');
        let entry_path = if remote_root.is_empty() {
            format!("{base}{name}")
        } else {
            format!("{canonical}/{name}")
        };
        let kind = if item.is_dir {
            FileKind::Folder
        } else {
            kind_from_name(&name)
        };
        entries.push(Entry {
            name: name.clone(),
            path: entry_path,
            kind,
            size: item.size.max(0) as u64,
            modified: item
                .mod_time
                .as_deref()
                .and_then(parse_mod_time)
                .unwrap_or(0),
            hidden,
        });
    }
    entries.sort_by(|a, b| {
        let a_folder = a.kind == FileKind::Folder;
        let b_folder = b.kind == FileKind::Folder;
        match (a_folder, b_folder) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a
                .name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.name.cmp(&b.name)),
        }
    });

    Ok(Listing {
        path: canonical,
        parent,
        crumbs,
        entries,
    })
}

// ---------------------------------------------------------------------------
// Subprocess runner with timeout (mocked in tests)
// ---------------------------------------------------------------------------

/// Outcome of one timed-out subprocess run. stdout/stderr are pre-truncated by
/// the runner and NEVER contain config contents (we never cat rclone.conf).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutput {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl RunOutput {
    pub fn ok(&self) -> bool {
        self.status == Some(0)
    }
}

/// Strip rclone's own non-essential noise from errors before showing them.
/// We deliberately cap size so a wild remote cannot flood the error toast, and
/// we never echo environment variables or config file contents.
fn clean_stderr(stderr: &str) -> String {
    let msg = stderr.trim();
    if msg.is_empty() {
        return "rclone tidak menjawab".to_string();
    }
    let first = msg.lines().next().unwrap_or(msg);
    // Count chars, not bytes: `String::truncate` panics mid-codepoint.
    if first.chars().count() > 300 {
        let mut cut: String = first.chars().take(300).collect();
        cut.push('…');
        return cut;
    }
    first.to_string()
}

#[derive(Debug)]
pub enum RunError {
    Spawn(io::Error),
    TimedOut,
}

/// Run a command with a hard timeout, returning its output.
/// On timeout the process is killed (best effort) and `TimedOut` is returned.
pub fn run_with_timeout(
    bin: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<RunOutput, RunError> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(RunError::Spawn)?;

    // Take the pipes so we can read with a deadline; otherwise a full pipe
    // can deadlock the child while we wait for exit.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    // Reader threads complete when the child closes its pipes.
    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stdout_pipe {
            read_capped(&mut pipe, &mut buf);
        }
        buf
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            read_capped(&mut pipe, &mut buf);
        }
        buf
    });

    // Poll try_wait: cheap, bounded, no extra thread to manage.
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RunError::Spawn(e));
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            // Detached readers finish on their own once the pipes are closed.
            return Err(RunError::TimedOut);
        }
        std::thread::sleep(Duration::from_millis(20));
    };

    let stdout = String::from_utf8_lossy(&join_output(stdout_handle)).to_string();
    let stderr = String::from_utf8_lossy(&join_output(stderr_handle)).to_string();
    Ok(RunOutput {
        status: status.code(),
        stdout,
        stderr,
    })
}

fn join_output(handle: std::thread::JoinHandle<Vec<u8>>) -> Vec<u8> {
    handle.join().unwrap_or_default()
}

fn read_capped(pipe: &mut dyn io::Read, buf: &mut Vec<u8>) {
    let mut chunk = [0u8; 8192];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let remaining = MAX_OUTPUT_BYTES.saturating_sub(buf.len());
                let take = n.min(remaining);
                buf.extend_from_slice(&chunk[..take]);
                if buf.len() >= MAX_OUTPUT_BYTES {
                    break;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// High-level operations used by the Tauri commands
// ---------------------------------------------------------------------------

/// Detect all remote backends. Never touches the network and never blocks
/// indefinitely (rclone probe is timed out). Missing rclone is normal.
pub fn detect() -> Result<RemotePlaces, AppError> {
    let path_env = std::env::var_os("PATH").and_then(|p| p.to_str().map(|s| s.to_string()));
    let mounts_text = std::fs::read_to_string("/proc/mounts").ok();
    detect_with(
        path_env.as_deref(),
        mounts_text.as_deref(),
        |bin, args| {
            run_with_timeout(bin, args, RCLONE_TIMEOUT).map_err(|e| match e {
                RunError::TimedOut => AppError::Other("rclone tidak merespons (timeout)".into()),
                RunError::Spawn(e) => AppError::Io(e),
            })
        },
    )
}

fn detect_with(
    path_env: Option<&str>,
    proc_mounts: Option<&str>,
    run: impl Fn(&Path, &[&str]) -> Result<RunOutput, AppError>,
) -> Result<RemotePlaces, AppError> {
    let mounts = proc_mounts
        .map(parse_network_mounts)
        .unwrap_or_default();
    let Some(rclone) = find_rclone(path_env) else {
        return Ok(RemotePlaces {
            available: false,
            version: None,
            remotes: Vec::new(),
            mounts,
            hint: Some(
                "rclone tidak ditemukan. Pasang rclone (mis. `sudo dnf install rclone`) untuk \
                 mengakses Google Drive, FTP, SFTP, S3, WebDAV, dan lainnya."
                    .to_string(),
            ),
        });
    };

    let version = run(&rclone, &["version"])
        .ok()
        .and_then(|out| parse_version(&out.stdout));

    let remotes = match run(&rclone, &["listremotes"]) {
        Ok(out) if out.ok() => parse_listremotes(&out.stdout)
            .into_iter()
            .map(|name| Place {
                path: format!("{REMOTE_PREFIX}{name}:"),
                name,
                icon: "remote".to_string(),
            })
            .collect(),
        Ok(out) => {
            return Err(AppError::Other(clean_stderr(&out.stderr)));
        }
        Err(e) => return Err(e),
    };

    Ok(RemotePlaces {
        available: true,
        version,
        remotes,
        mounts,
        hint: None,
    })
}

/// List a remote path with `rclone lsjson`. Remote paths NEVER go through
/// `files::guard` (it canonicalizes local paths and would reject them).
pub fn list_remote_path(path: &str, hidden: bool) -> Result<Listing, AppError> {
    let path_env = std::env::var_os("PATH").and_then(|p| p.to_str().map(|s| s.to_string()));
    list_remote_with(path_env.as_deref(), path, hidden, |bin, args| {
        run_with_timeout(bin, args, RCLONE_TIMEOUT).map_err(|e| match e {
            RunError::TimedOut => AppError::Other("Remote tidak merespons: rclone timeout".into()),
            RunError::Spawn(e) => AppError::Io(e),
        })
    })
}

fn list_remote_with(
    path_env: Option<&str>,
    path: &str,
    hidden: bool,
    run: impl Fn(&Path, &[&str]) -> Result<RunOutput, AppError>,
) -> Result<Listing, AppError> {
    let target = normalize_remote_target(path)?;
    let Some(rclone) = find_rclone(path_env) else {
        return Err(AppError::Other(RCLONE_MISSING.to_string()));
    };

    let out = run(
        &rclone,
        &["lsjson", "--max-depth", "1", &target],
    )?;
    if !out.ok() {
        return Err(AppError::Other(clean_stderr(&out.stderr)));
    }
    let mut listing = parse_lsjson(path, &out.stdout)?;
    if !hidden {
        listing.entries.retain(|e| !e.hidden);
    }
    Ok(listing)
}

const RCLONE_MISSING: &str =
    "rclone tidak ditemukan. Pasang rclone untuk mengakses penyimpanan remote.";

/// Validate and normalize a remote target passed from the frontend.
/// Accepts `rclone:name:` / `rclone:name:sub/dir` and returns `name:sub/dir`.
fn normalize_remote_target(path: &str) -> Result<String, AppError> {
    let trimmed = path.trim();
    let Some(rest) = trimmed.strip_prefix(REMOTE_PREFIX) else {
        return Err(AppError::Invalid(
            "Path remote harus diawali rclone:".into(),
        ));
    };
    if rest.is_empty() || rest == ":" {
        return Err(AppError::Invalid("Nama remote kosong".into()));
    }
    let Some((name, sub)) = rest.split_once(':') else {
        return Err(AppError::Invalid(
            "Format remote harus rclone:<nama>:<subpath>".into(),
        ));
    };
    // A leading `-` would reach rclone as a flag instead of a remote name.
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::Invalid("Nama remote kosong".into()));
    }
    let sub = sub.trim_matches('/');
    if sub.split('/').any(|c| c == "..") {
        return Err(AppError::Invalid("Subpath remote tidak valid".into()));
    }
    if sub.is_empty() {
        Ok(format!("{name}:"))
    } else {
        Ok(format!("{name}:{sub}"))
    }
}

fn blocking_error(e: tauri::Error) -> AppError {
    AppError::Other(format!("Tugas remote gagal: {e}"))
}

/// Remote places for the Files sidebar. rclone probes run off the async
/// runtime because each may take up to [`RCLONE_TIMEOUT`].
#[tauri::command]
pub async fn file_remotes() -> Result<RemotePlaces, AppError> {
    tauri::async_runtime::spawn_blocking(detect)
        .await
        .map_err(blocking_error)?
}

/// Lists an `rclone:` path. Deliberately bypasses the local path guard; the
/// target is validated by [`normalize_remote_target`] instead.
#[tauri::command]
pub async fn list_remote(path: String, hidden: bool) -> Result<Listing, AppError> {
    tauri::async_runtime::spawn_blocking(move || list_remote_path(&path, hidden))
        .await
        .map_err(blocking_error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn place(name: &str) -> Place {
        Place {
            name: name.to_string(),
            path: format!("{REMOTE_PREFIX}{name}:"),
            icon: "remote".to_string(),
        }
    }

    fn ok_run(stdout: &str) -> impl Fn(&Path, &[&str]) -> Result<RunOutput, AppError> {
        let stdout = stdout.to_string();
        move |_bin, _args| {
            Ok(RunOutput {
                status: Some(0),
                stdout: stdout.clone(),
                stderr: String::new(),
            })
        }
    }

    /// A PATH holding an executable `rclone` stub, so detection does not
    /// depend on the machine running the tests. The runner is mocked anyway.
    fn fake_rclone_path() -> (tempfile::TempDir, String) {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("rclone");
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = tmp.path().to_string_lossy().to_string();
        (tmp, path)
    }

    fn lsjson_sample() -> String {
        // Verbatim shape of `rclone lsjson remote:Documents` (no -R):
        // PascalCase keys, `Path` relative to the listed dir, Size -1 for dirs.
        r#"[
{"Path":"report.pdf","Name":"report.pdf","Size":1234,"MimeType":"application/pdf","ModTime":"2026-10-06T09:30:00.000000000Z","IsDir":false},
{"Path":"Archive","Name":"Archive","Size":-1,"MimeType":"inode/directory","ModTime":"2026-10-05T08:00:00.000000000Z","IsDir":true},
{"Path":".secret","Name":".secret","Size":5,"MimeType":"application/octet-stream","ModTime":"2026-10-04T08:00:00.000000000Z","IsDir":false}
]"#
        .to_string()
    }

    // -- find_rclone ---------------------------------------------------------

    #[test]
    fn find_rclone_finds_executable_on_path() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("rclone");
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let found = find_rclone(Some(&format!(
            "/nonexistent:{}",
            tmp.path().to_string_lossy()
        )));
        assert_eq!(found, Some(bin));
    }

    #[test]
    fn find_rclone_missing_is_normal() {
        assert_eq!(find_rclone(Some("/nonexistent-xyz")), None);
        assert_eq!(find_rclone(None), None);
    }

    // -- parse_listremotes ---------------------------------------------------

    #[test]
    fn parses_listremotes_output() {
        assert_eq!(
            parse_listremotes("gdrive:\ndropbox:\n\n  s3:  \n"),
            vec!["gdrive", "dropbox", "s3"]
        );
    }

    #[test]
    fn parses_listremotes_without_colons_and_dedups() {
        assert_eq!(parse_listremotes("gdrive\ngdrive:\n"), vec!["gdrive"]);
    }

    #[test]
    fn empty_listremotes_means_no_remotes() {
        assert!(parse_listremotes("").is_empty());
        assert!(parse_listremotes("\n\n").is_empty());
    }

    // -- mounts --------------------------------------------------------------

    #[test]
    fn parses_network_mounts_from_proc_mounts() {
        let mounts = "\
/dev/nvme0n1p2 / btrfs rw 0 0
gdrive: /home/u/mnt/gdrive fuse.rclone rw,nosuid 0 0
nas:/share /mnt/nas nfs4 rw 0 0
//win/share /mnt/share cifs rw 0 0
u@host:/x /mnt/ssh fuse.sshfs rw 0 0
";
        let got = parse_network_mounts(mounts);
        let names: Vec<&str> = got.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["gdrive", "nas", "share", "ssh"]);
        assert!(got.iter().all(|p| p.icon == "remote"));
    }

    #[test]
    fn decodes_octal_escapes_and_ignores_local_mounts() {
        let mounts = "/dev/sda1 /run/media/u/USB\\040Drive vfat rw 0 0\n";
        assert!(parse_network_mounts(mounts).is_empty());
        let net = "/dev/sda1 /mnt/my\\040nas nfs rw 0 0\n";
        let got = parse_network_mounts(net);
        assert_eq!(got[0].path, "/mnt/my nas");
    }

    // -- detect --------------------------------------------------------------

    #[test]
    fn detect_without_rclone_reports_available_false_with_hint() {
        let info = detect_with(
            Some("/nonexistent-anchoa-test"),
            None,
            |_bin, _args| {
                Ok(RunOutput {
                    status: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                })
            },
        )
        .unwrap();
        assert!(!info.available);
        assert!(info.remotes.is_empty());
        assert!(info.version.is_none());
        assert!(info.hint.unwrap().contains("rclone tidak ditemukan"));
    }

    #[test]
    fn detect_with_rclone_lists_remotes_and_version() {
        let (_tmp, path_env) = fake_rclone_path();
        let calls = std::cell::RefCell::new(Vec::<String>::new());
        let info = {
            let calls_ref = &calls;
            detect_with(
                Some(&path_env),
                None,
                move |bin, args| {
                    calls_ref
                        .borrow_mut()
                        .push(format!("{} {}", bin.display(), args.join(" ")));
                    if args.first() == Some(&"version") {
                        Ok(RunOutput {
                            status: Some(0),
                            stdout: "rclone v1.67.0\n- os/version: fedora\n".into(),
                            stderr: String::new(),
                        })
                    } else {
                        Ok(RunOutput {
                            status: Some(0),
                            stdout: "gdrive:\ns3:\n".into(),
                            stderr: String::new(),
                        })
                    }
                },
            )
        }
        .unwrap();
        assert!(info.available);
        assert_eq!(info.version.as_deref(), Some("rclone v1.67.0"));
        assert_eq!(info.remotes, vec![place("gdrive"), place("s3")]);
        assert!(info.hint.is_none());
        let calls = calls.borrow();
        assert!(calls.iter().any(|c| c.ends_with("listremotes")));
    }

    #[test]
    fn detect_surfaces_network_mounts_without_rclone() {
        let info = detect_with(
            Some("/nonexistent"),
            Some("/dev/a /mnt/nas nfs4 rw 0 0\n"),
            |_bin, _args| Ok(ok_empty()),
        )
        .unwrap();
        assert_eq!(info.mounts.len(), 1);
        assert_eq!(info.mounts[0].name, "nas");
        assert_eq!(info.mounts[0].path, "/mnt/nas");
    }

    #[test]
    fn detect_rclone_failure_is_an_error_not_empty_list() {
        let (_tmp, path_env) = fake_rclone_path();
        let info = detect_with(Some(&path_env), None, |_bin, _args| {
            Ok(RunOutput {
                status: Some(1),
                stdout: String::new(),
                stderr: "Failed to load config".into(),
            })
        });
        assert!(info.is_err());
    }

    fn ok_empty() -> RunOutput {
        RunOutput {
            status: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        }
    }

    // -- lsjson → Listing ----------------------------------------------------

    #[test]
    fn parses_lsjson_into_listing_shape() {
        let listing = parse_lsjson("rclone:gdrive:Documents", &lsjson_sample()).unwrap();
        assert_eq!(listing.path, "rclone:gdrive:Documents");
        assert_eq!(listing.parent.as_deref(), Some("rclone:gdrive:"));
        assert_eq!(listing.crumbs.len(), 2);
        assert_eq!(listing.crumbs[0].name, "rclone:gdrive:");
        assert_eq!(listing.crumbs[1].path, "rclone:gdrive:Documents");
        // Folders first, then case-insensitive names.
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Archive", ".secret", "report.pdf"]);
        let folder = &listing.entries[0];
        assert_eq!(folder.kind, FileKind::Folder);
        assert_eq!(folder.path, "rclone:gdrive:Documents/Archive");
        let pdf = listing
            .entries
            .iter()
            .find(|e| e.name == "report.pdf")
            .unwrap();
        assert_eq!(pdf.kind, FileKind::Pdf);
        assert_eq!(pdf.size, 1234);
        assert_eq!(pdf.modified, 1_791_279_000_000);
    }

    #[test]
    fn lsjson_at_remote_root_has_no_parent() {
        let listing = parse_lsjson(
            "rclone:gdrive:",
            r#"[{"Path":"Docs","Name":"Docs","Size":-1,"MimeType":"inode/directory","ModTime":"2026-10-05T08:00:00Z","IsDir":true}]"#,
        )
        .unwrap();
        assert_eq!(listing.parent, None);
        assert_eq!(listing.entries[0].path, "rclone:gdrive:Docs");
        assert_eq!(listing.crumbs.len(), 1);
    }

    #[test]
    fn lsjson_invalid_json_is_clear_error() {
        let err = parse_lsjson("rclone:gdrive:", "not json").unwrap_err();
        assert!(err.to_string().contains("tidak valid"));
    }

    #[test]
    fn kind_from_name_mirrors_local_kind_of() {
        assert_eq!(kind_from_name("a.png"), FileKind::Image);
        assert_eq!(kind_from_name("b.mkv"), FileKind::Video);
        assert_eq!(kind_from_name("c.PDF"), FileKind::Pdf);
        assert_eq!(kind_from_name("d.rs"), FileKind::Text);
        assert_eq!(kind_from_name("e.bin"), FileKind::Other);
        assert_eq!(kind_from_name(".gitignore"), FileKind::Other);
        assert_eq!(kind_from_name("folder."), FileKind::Other);
    }

    #[test]
    fn parses_mod_time() {
        assert_eq!(parse_mod_time("2026-10-06T09:30:00.000000000Z"), Some(1_791_279_000_000));
        assert_eq!(parse_mod_time("2026-10-05T08:00:00.000000000Z"), Some(1_791_187_200_000));
        assert_eq!(parse_mod_time("garbage"), None);
    }

    // -- list_remote ---------------------------------------------------------

    #[test]
    fn list_remote_requires_rclone_prefix() {
        let err = list_remote_with(Some("/bin"), "/home/u/x", true, ok_run("[]")).unwrap_err();
        assert!(err.to_string().contains("rclone:"));
    }

    #[test]
    fn list_remote_without_rclone_is_a_clear_error() {
        let err = list_remote_with(
            Some("/nonexistent-anchoa-xyz"),
            "rclone:gdrive:",
            true,
            |_bin, _args| {
                panic!("rclone is not on PATH, runner must not be called")
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("rclone tidak ditemukan"));
    }

    #[test]
    fn list_remote_filters_hidden_when_requested() {
        let (_tmp, path_env) = fake_rclone_path();
        let listing = list_remote_with(
            Some(&path_env),
            "rclone:gdrive:",
            false,
            ok_run(&lsjson_sample()),
        )
        .unwrap();
        assert!(listing.entries.iter().all(|e| !e.hidden));
        let listing = list_remote_with(
            Some(&path_env),
            "rclone:gdrive:",
            true,
            ok_run(&lsjson_sample()),
        )
        .unwrap();
        assert!(listing.entries.iter().any(|e| e.hidden));
    }

    #[test]
    fn list_remote_sends_normalized_target() {
        let (_tmp, path_env) = fake_rclone_path();
        let seen = std::cell::RefCell::new(Vec::<String>::new());
        let listing = {
            let seen_ref = &seen;
            list_remote_with(
                Some(&path_env),
                "rclone:gdrive:/Docs//",
                true,
                move |bin, args| {
                    seen_ref
                        .borrow_mut()
                        .push(format!("{} {}", bin.display(), args.join(" ")));
                    if args.first() == Some(&"lsjson") {
                        Ok(RunOutput {
                            status: Some(0),
                            stdout: lsjson_sample(),
                            stderr: String::new(),
                        })
                    } else {
                        unreachable!()
                    }
                },
            )
        }
        .unwrap();
        assert_eq!(listing.path, "rclone:gdrive:Docs");
        assert_eq!(listing.entries[0].path, "rclone:gdrive:Docs/Archive");
        let seen = seen.borrow();
        assert!(seen[0].contains("gdrive:Docs"));
        assert!(seen[0].contains("--max-depth 1"));
    }

    // -- timeout path --------------------------------------------------------

    #[test]
    fn run_with_timeout_times_out_on_hung_process() {
        let sleeper = write_sleeper_script();
        let started = Instant::now();
        let res = run_with_timeout(&sleeper, &[], Duration::from_millis(300));
        assert!(matches!(res, Err(RunError::TimedOut)));
        assert!(started.elapsed() < Duration::from_secs(5));
        // clean up
        let _ = std::fs::remove_file(sleeper);
    }

    fn write_sleeper_script() -> PathBuf {
        let path = std::env::temp_dir().join("anchoa-remotes-sleeper.sh");
        std::fs::write(&path, "#!/bin/sh\nsleep 30\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    #[test]
    fn run_with_timeout_captures_output() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("echo.sh");
        std::fs::write(&path, "#!/bin/sh\necho hello\necho err >&2\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let out = run_with_timeout(&path, &[], Duration::from_secs(5)).unwrap();
        assert!(out.ok());
        assert_eq!(out.stdout.trim(), "hello");
        assert_eq!(out.stderr.trim(), "err");
    }

    // -- security ------------------------------------------------------------

    #[test]
    fn normalize_rejects_traversal_and_flag_like_names() {
        assert!(normalize_remote_target("rclone:gdrive:../etc").is_err());
        assert!(normalize_remote_target("rclone:--config:x").is_err());
        assert!(normalize_remote_target("/etc/passwd").is_err());
        assert!(normalize_remote_target("").is_err());
        assert_eq!(normalize_remote_target("rclone:gdrive:").unwrap(), "gdrive:");
        assert_eq!(
            normalize_remote_target("rclone:gdrive:Docs/Files").unwrap(),
            "gdrive:Docs/Files"
        );
        // "a..b" (not a "..") is still allowed.
        assert_eq!(
            normalize_remote_target("rclone:gdrive:a..b").unwrap(),
            "gdrive:a..b"
        );
    }

    #[test]
    fn clean_stderr_never_dumps_more_than_one_line_and_is_bounded() {
        let long = "x".repeat(1000);
        let cleaned = clean_stderr(&format!("line1\nline2\n{long}"));
        assert_eq!(cleaned, "line1");
        let cleaned = clean_stderr(&long);
        assert_eq!(cleaned.chars().count(), 301);
        let wide = "é".repeat(400);
        assert_eq!(clean_stderr(&wide).chars().count(), 301);
        assert_eq!(clean_stderr(""), "rclone tidak menjawab");
    }

    #[test]
    fn run_output_ok_requires_zero_status() {
        let out = RunOutput {
            status: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(out.ok());
        let out = RunOutput {
            status: Some(1),
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(!out.ok());
    }
}
