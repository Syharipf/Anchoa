use crate::error::AppError;
use std::{
    ffi::OsStr,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const POLL: Duration = Duration::from_millis(20);

pub fn executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
        }
        #[cfg(not(unix))]
        {
            metadata.is_file()
        }
    })
}

pub fn find_binary(name: &str, path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path)
        .map(|dir| dir.join(name))
        .find(|path| executable(path))
}

pub fn find_whisper(path: &OsStr) -> Option<PathBuf> {
    find_binary("whisper-cli", path).or_else(|| find_binary("whisper-cpp", path))
}

pub fn transcribe(binary: &Path, model: &Path, wav: &Path) -> Result<String, AppError> {
    if !model.is_file() {
        return Err(AppError::Invalid("Model whisper belum dipasang".into()));
    }
    if !wav.is_file() {
        return Err(AppError::Invalid("Rekaman suara tidak ditemukan".into()));
    }
    let output = Command::new(binary)
        .arg("-m")
        .arg(model)
        .args(["-l", "id", "-nt", "-f"])
        .arg(wav)
        .stdin(Stdio::null())
        .output()?;
    if !output.status.success() {
        return Err(AppError::Other(format!(
            "Transkripsi whisper gagal: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    String::from_utf8(output.stdout)
        .map(|text| text.trim().to_owned())
        .map_err(|_| AppError::Other("Teks whisper tidak terbaca".into()))
}

/// Scratch files always live in app data and are removed on every exit path.
pub(super) struct ScratchDir(pub PathBuf);

impl ScratchDir {
    pub fn new(root: &Path) -> Result<Self, AppError> {
        fs::create_dir_all(root)?;
        let path = root.join(format!(".voice-{}", uuid::Uuid::now_v7()));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct ManagedChild(Child);

impl ManagedChild {
    fn spawn(mut command: Command) -> Result<Self, AppError> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        Ok(Self(command.spawn()?))
    }

    fn signal(&mut self, signal: &str) -> Result<(), AppError> {
        if self.0.try_wait()?.is_some() {
            return Ok(());
        }
        #[cfg(unix)]
        {
            // Fixed system executable, never a shell or text supplied by users.
            let sent = Command::new("/usr/bin/kill")
                .args([signal, "--", &format!("-{}", self.0.id())])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success());
            if sent {
                return Ok(());
            }
        }
        self.0.kill()?;
        Ok(())
    }

    fn kill_and_wait(&mut self) -> Result<(), AppError> {
        self.signal("-KILL")?;
        self.0.wait()?;
        Ok(())
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        let _ = self.kill_and_wait();
    }
}

pub struct Recorder {
    wav: PathBuf,
    _scratch: ScratchDir,
    stop: Sender<()>,
    worker: Option<JoinHandle<Result<(), AppError>>>,
}

impl Recorder {
    pub fn start(
        binary: &Path,
        root: &Path,
        max: Duration,
        grace: Duration,
    ) -> Result<Self, AppError> {
        let scratch = ScratchDir::new(root)?;
        let wav = scratch.0.join("recording.wav");
        let mut command = Command::new(binary);
        command
            .args(["--rate", "16000", "--channels", "1", "--format", "s16"])
            .arg(&wav)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = ManagedChild::spawn(command)?;
        let (stop, requests) = mpsc::channel();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + max;
            loop {
                if let Some(status) = child.0.try_wait()? {
                    return recording_status(status);
                }
                if Instant::now() >= deadline
                    || !matches!(
                        requests.recv_timeout(POLL),
                        Err(mpsc::RecvTimeoutError::Timeout)
                    )
                {
                    break;
                }
            }
            child.signal("-INT")?;
            let deadline = Instant::now() + grace;
            loop {
                if let Some(status) = child.0.try_wait()? {
                    return recording_status(status);
                }
                if Instant::now() >= deadline {
                    child.kill_and_wait()?;
                    return Ok(());
                }
                thread::sleep(POLL);
            }
        });
        Ok(Self {
            wav,
            _scratch: scratch,
            stop,
            worker: Some(worker),
        })
    }

    pub fn wav(&self) -> &Path {
        &self.wav
    }

    pub fn is_recording(&self) -> bool {
        self.worker
            .as_ref()
            .is_some_and(|worker| !worker.is_finished())
    }

    pub fn stop(&mut self) -> Result<(), AppError> {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| AppError::Other("Proses rekaman gagal".into()))??;
        }
        if fs::metadata(&self.wav).is_ok_and(|metadata| metadata.len() > 0) {
            Ok(())
        } else {
            Err(AppError::Other("Rekaman suara kosong".into()))
        }
    }
}

fn recording_status(status: ExitStatus) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if status.signal() == Some(2) {
            return Ok(());
        }
    }
    if status.success() || status.code() == Some(130) {
        Ok(())
    } else {
        Err(AppError::Other(format!("pw-record gagal ({status})")))
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Polling permits cancellation of both synthesis and playback. Stderr goes to
/// disk so a chatty subprocess cannot fill a pipe and deadlock the worker.
pub(super) fn run(
    mut command: Command,
    input: Option<String>,
    cancel: &AtomicBool,
    log: &Path,
) -> Result<bool, AppError> {
    if cancel.load(Ordering::SeqCst) {
        return Ok(false);
    }
    command
        .stdout(Stdio::null())
        .stderr(fs::File::create(log)?)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    let mut child = ManagedChild::spawn(command)?;
    let writer = input.and_then(|input| {
        child
            .0
            .stdin
            .take()
            .map(|mut stdin| thread::spawn(move || stdin.write_all(input.as_bytes())))
    });
    let result = loop {
        if cancel.load(Ordering::SeqCst) {
            child.kill_and_wait()?;
            break Ok(false);
        }
        if let Some(status) = child.0.try_wait()? {
            if status.success() {
                break Ok(true);
            }
            let detail = fs::read_to_string(log).unwrap_or_default();
            break Err(AppError::Other(format!(
                "Proses suara gagal ({status}): {}",
                detail.trim()
            )));
        }
        thread::sleep(POLL);
    };
    if let Some(writer) = writer {
        let written = writer
            .join()
            .map_err(|_| AppError::Other("Pengiriman teks suara gagal".into()))?;
        if matches!(result, Ok(true)) {
            written?;
        }
    }
    result
}
