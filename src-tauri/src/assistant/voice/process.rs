use crate::error::AppError;
use std::{
    ffi::OsStr,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc, Mutex,
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

pub fn transcribe(
    binary: &Path,
    model: &Path,
    wav: &Path,
    control: &ProcessControl,
) -> Result<String, AppError> {
    if !model.is_file() {
        return Err(AppError::Invalid("Model whisper belum dipasang".into()));
    }
    if !wav.is_file() {
        return Err(AppError::Invalid("Rekaman suara tidak ditemukan".into()));
    }
    let text = wav.with_file_name("transcript.txt");
    let log = wav.with_file_name("whisper.log");
    let mut command = Command::new(binary);
    command
        .arg("-m")
        .arg(model)
        .args(["-l", "id", "-nt", "-f"])
        .arg(wav)
        .stdin(Stdio::null());
    control.with_active(|| {
        command
            .stdout(fs::File::create(&text)?)
            .stderr(fs::File::create(&log)?);
        Ok(())
    })?;
    let child = RunningChild(control);
    control.spawn(command)?;
    let status = loop {
        control.check_active()?;
        if let Some(status) = child.try_wait()? {
            break status;
        }
        thread::sleep(POLL);
    };
    if !status.success() {
        return Err(AppError::Other(format!(
            "Transkripsi whisper gagal: {}",
            fs::read_to_string(log).unwrap_or_default().trim()
        )));
    }
    String::from_utf8(fs::read(text)?)
        .map(|text| text.trim().to_owned())
        .map_err(|_| AppError::Other("Teks whisper tidak terbaca".into()))
}

pub(super) fn temporary_root(data: &Path) -> PathBuf {
    data.join("voice-tmp")
}

/// Sweep only the temporary namespace, never model or imported-voice directories.
pub(super) fn sweep_temporary(data: &Path) -> Result<(), AppError> {
    let root = temporary_root(data);
    match fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.is_dir() => {
            for entry in fs::read_dir(&root)? {
                let entry = entry?;
                if entry.file_type()?.is_dir() {
                    fs::remove_dir_all(entry.path())?;
                } else {
                    fs::remove_file(entry.path())?;
                }
            }
        }
        Ok(_) => fs::remove_file(&root)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    fs::create_dir_all(root)?;
    Ok(())
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

/// Shared by a worker and shutdown. Registration and cancellation use the same
/// lock, so a cancelled worker cannot launch a child or recreate scratch files.
#[derive(Default)]
pub(super) struct ProcessControl {
    cancelled: AtomicBool,
    child: Mutex<Option<ManagedChild>>,
    finished: AtomicBool,
}

impl ProcessControl {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn check_active(&self) -> Result<(), AppError> {
        if self.is_cancelled() {
            Err(AppError::Other("Proses suara dibatalkan".into()))
        } else {
            Ok(())
        }
    }

    pub fn with_active<T>(
        &self,
        action: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let _guard = super::lock(&self.child)?;
        self.check_active()?;
        action()
    }

    pub fn scratch(&self, root: &Path) -> Result<ScratchDir, AppError> {
        self.with_active(|| ScratchDir::new(root))
    }

    fn spawn(&self, command: Command) -> Result<(), AppError> {
        let mut slot = super::lock(&self.child)?;
        self.check_active()?;
        *slot = Some(ManagedChild::spawn(command)?);
        Ok(())
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = self.child.lock()
            && let Some(child) = slot.as_mut()
            && let Err(error) = child.kill_and_wait()
        {
            log::warn!("failed to stop voice child: {error}");
        }
    }

    pub fn finish(&self) {
        self.finished.store(true, Ordering::SeqCst);
    }

    pub fn wait_until(&self, deadline: Instant) {
        while !self.finished.load(Ordering::SeqCst) && Instant::now() < deadline {
            thread::sleep(POLL.min(deadline.saturating_duration_since(Instant::now())));
        }
    }
}

struct RunningChild<'a>(&'a ProcessControl);

impl RunningChild<'_> {
    fn kill_and_wait(&self) -> Result<(), AppError> {
        if let Some(child) = super::lock(&self.0.child)?.as_mut() {
            child.kill_and_wait()?;
        }
        Ok(())
    }

    fn try_wait(&self) -> Result<Option<ExitStatus>, AppError> {
        super::lock(&self.0.child)?
            .as_mut()
            .ok_or_else(|| AppError::Other("Proses suara tidak tersedia".into()))?
            .0
            .try_wait()
            .map_err(AppError::from)
    }

    fn signal(&self, signal: &str) -> Result<(), AppError> {
        if let Some(child) = super::lock(&self.0.child)?.as_mut() {
            child.signal(signal)?;
        }
        Ok(())
    }
}

impl Drop for RunningChild<'_> {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.0.child.lock() {
            // Drop reaps the child before releasing the shared slot.
            drop(slot.take());
        }
    }
}

pub struct Recorder {
    wav: PathBuf,
    _scratch: ScratchDir,
    stop: Sender<()>,
    worker: Option<JoinHandle<Result<(), AppError>>>,
    pub(super) control: Arc<ProcessControl>,
}

impl Recorder {
    pub fn start(
        binary: &Path,
        root: &Path,
        max: Duration,
        grace: Duration,
    ) -> Result<Self, AppError> {
        let control = Arc::new(ProcessControl::default());
        let scratch = control.scratch(root)?;
        let wav = scratch.0.join("recording.wav");
        let mut command = Command::new(binary);
        command
            .args(["--rate", "16000", "--channels", "1", "--format", "s16"])
            .arg(&wav)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        control.spawn(command)?;
        let (stop, requests) = mpsc::channel();
        let active = control.clone();
        let worker = thread::spawn(move || {
            let child = RunningChild(&active);
            let deadline = Instant::now() + max;
            loop {
                if let Some(status) = child.try_wait()? {
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
                if let Some(status) = child.try_wait()? {
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
            control,
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
    control: &ProcessControl,
    log: &Path,
) -> Result<bool, AppError> {
    if control.is_cancelled() {
        return Ok(false);
    }
    control.with_active(|| {
        command
            .stdout(Stdio::null())
            .stderr(fs::File::create(log)?)
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        Ok(())
    })?;
    let child = RunningChild(control);
    if let Err(error) = control.spawn(command) {
        return if control.is_cancelled() {
            Ok(false)
        } else {
            Err(error)
        };
    }
    let writer = input.and_then(|input| {
        super::lock(&control.child)
            .ok()?
            .as_mut()?
            .0
            .stdin
            .take()
            .map(|mut stdin| thread::spawn(move || stdin.write_all(input.as_bytes())))
    });
    let result = loop {
        if control.is_cancelled() {
            break Ok(false);
        }
        if let Some(status) = child.try_wait()? {
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
    drop(child);
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
