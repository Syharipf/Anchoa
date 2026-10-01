//! Local speech, with injectable executable paths for hardware-free tests.
mod catalog;
mod download;
mod install;
mod process;
mod settings;
mod speak;

use crate::{db::Db, error::AppError};
use serde::Serialize;
pub use settings::{VoiceParams, VoiceSettings};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State, ipc::Channel};

pub struct VoiceState {
    data: PathBuf,
    path: OsString,
    recorder: Mutex<Option<process::Recorder>>,
    speech: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    install_lock: Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, AppError> {
    mutex
        .lock()
        .map_err(|_| AppError::Other("State suara tidak tersedia".into()))
}

impl VoiceState {
    pub fn new(data: PathBuf) -> Self {
        Self::with_path(data, std::env::var_os("PATH").unwrap_or_default())
    }

    fn with_path(data: PathBuf, path: OsString) -> Self {
        Self {
            data,
            path,
            recorder: Mutex::new(None),
            speech: Arc::new(Mutex::new(None)),
            install_lock: Mutex::new(()),
        }
    }

    fn binary(&self, name: &str) -> Result<PathBuf, AppError> {
        process::find_binary(name, &self.path)
            .ok_or_else(|| AppError::Other(format!("{name} belum tersedia")))
    }

    fn whisper_model(&self) -> PathBuf {
        self.data.join("models/whisper/ggml-base.bin")
    }
    fn piper(&self) -> PathBuf {
        self.data.join("piper/bin/piper")
    }

    fn record_start(&self) -> Result<(), AppError> {
        self.stop()?;
        let binary = self.binary("pw-record")?;
        let mut slot = lock(&self.recorder)?;
        if slot.is_some() {
            return Err(AppError::Invalid(
                "Rekaman sebelumnya belum dihentikan".into(),
            ));
        }
        *slot = Some(process::Recorder::start(
            &binary,
            &self.data.join("tmp/voice"),
            Duration::from_secs(60),
            Duration::from_secs(2),
        )?);
        Ok(())
    }

    fn record_stop(&self) -> Result<String, AppError> {
        let mut recorder = lock(&self.recorder)?
            .take()
            .ok_or_else(|| AppError::Invalid("Tidak ada rekaman aktif".into()))?;
        recorder.stop()?;
        let whisper = process::find_whisper(&self.path).ok_or_else(|| {
            AppError::Other("whisper.cpp belum tersedia; pasang paket whisper-cpp".into())
        })?;
        process::transcribe(&whisper, &self.whisper_model(), recorder.wav())
    }

    fn begin_speech(&self) -> Result<SpeechRun, AppError> {
        let mut slot = lock(&self.speech)?;
        if slot.is_some() {
            return Err(AppError::Invalid("Suara masih diputar".into()));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *slot = Some(cancel.clone());
        Ok(SpeechRun {
            slot: self.speech.clone(),
            cancel,
        })
    }

    fn speak(&self, text: &str, settings: VoiceSettings, run: SpeechRun) -> Result<(), AppError> {
        let model = catalog::model_path(&self.data, &settings.id)?;
        catalog::validate_pair(&model).map_err(|error| {
            AppError::Invalid(format!("Suara belum dipasang atau tidak valid: {error}"))
        })?;
        let piper = self.piper();
        if !process::executable(&piper) {
            return Err(AppError::Invalid("Piper belum dipasang".into()));
        }
        let programs = speak::Programs {
            piper,
            pw_play: self.binary("pw-play")?,
        };
        speak::speak(
            text,
            &model,
            settings.params,
            &programs,
            &self.data.join("tmp/voice"),
            &run.cancel,
        )
    }

    fn stop(&self) -> Result<(), AppError> {
        if let Some(cancel) = lock(&self.speech)?.as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    pub fn stop_all(&self) {
        let _ = self.stop();
        let recorder = self.recorder.lock().ok().and_then(|mut slot| slot.take());
        drop(recorder);
    }

    fn validate_id(&self, id: &str) -> Result<(), AppError> {
        let model = catalog::model_path(&self.data, id)?;
        if catalog::builtin(id).is_none() {
            catalog::validate_pair(&model)?;
        }
        Ok(())
    }

    fn voices(&self, db: &Db) -> Result<Vec<Voice>, AppError> {
        let mut voices = Vec::new();
        for builtin in catalog::VOICES {
            let model = catalog::model_path(&self.data, builtin.id)?;
            voices.push(Voice {
                id: builtin.id.into(),
                label: builtin.label.into(),
                language: builtin.language.into(),
                quality: builtin.quality.into(),
                installed: catalog::validate_pair(&model).is_ok(),
                imported: false,
                params: VoiceParams::default(),
            });
        }
        for (id, label) in catalog::custom_voices(&self.data)? {
            voices.push(Voice {
                id,
                label,
                language: "custom".into(),
                quality: "custom".into(),
                installed: true,
                imported: true,
                params: VoiceParams::default(),
            });
        }
        let conn = db.conn()?;
        for voice in &mut voices {
            voice.params = settings::for_voice(&conn, &voice.id)?;
        }
        Ok(voices)
    }

    fn status(&self, db: &Db) -> Result<VoiceStatus, AppError> {
        let voices = self.voices(db)?;
        let settings = settings::get(&*db.conn()?)?;
        Ok(VoiceStatus {
            pw_record: process::find_binary("pw-record", &self.path).is_some(),
            pw_play: process::find_binary("pw-play", &self.path).is_some(),
            whisper: process::find_whisper(&self.path).map(|path| path.display().to_string()),
            whisper_model: self.whisper_model().is_file(),
            piper: process::executable(&self.piper()),
            voices,
            settings,
            recording: lock(&self.recorder)?
                .as_ref()
                .is_some_and(process::Recorder::is_recording),
            speaking: lock(&self.speech)?
                .as_ref()
                .is_some_and(|cancel| !cancel.load(Ordering::SeqCst)),
        })
    }

    fn install(
        &self,
        component: &str,
        mut progress: impl FnMut(VoiceInstallProgress),
    ) -> Result<(), AppError> {
        let _guard = self
            .install_lock
            .try_lock()
            .map_err(|_| AppError::Other("Pemasangan suara lain masih berjalan".into()))?;
        install::install(&self.data, &self.path, component, &mut progress)
    }
}

impl Drop for VoiceState {
    fn drop(&mut self) {
        self.stop_all();
    }
}

struct SpeechRun {
    slot: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    cancel: Arc<AtomicBool>,
}

impl Drop for SpeechRun {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.slot.lock()
            && slot
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, &self.cancel))
        {
            *slot = None;
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Voice {
    pub id: String,
    pub label: String,
    pub language: String,
    pub quality: String,
    pub installed: bool,
    pub imported: bool,
    pub params: VoiceParams,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub pw_record: bool,
    pub pw_play: bool,
    pub whisper: Option<String>,
    pub whisper_model: bool,
    pub piper: bool,
    pub voices: Vec<Voice>,
    pub settings: VoiceSettings,
    pub recording: bool,
    pub speaking: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VoiceInstallStage {
    Downloading,
    Verified,
    Installed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInstallProgress {
    pub component: String,
    pub file: String,
    pub done_bytes: u64,
    pub total_bytes: Option<u64>,
    pub stage: VoiceInstallStage,
}

#[tauri::command]
pub async fn voice_status(app: AppHandle) -> Result<VoiceStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<VoiceState>().status(&app.state::<Db>())
    })
    .await
    .map_err(|_| AppError::Other("Pemeriksaan suara gagal".into()))?
}

#[tauri::command]
pub async fn voice_install(
    app: AppHandle,
    component: String,
    on_event: Channel<VoiceInstallProgress>,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<VoiceState>().install(&component, |event| {
            let _ = on_event.send(event);
        })
    })
    .await
    .map_err(|_| AppError::Other("Pemasangan suara gagal".into()))?
}

#[tauri::command]
pub async fn voice_record_start(app: AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<VoiceState>().record_start())
        .await
        .map_err(|_| AppError::Other("Rekaman suara gagal dimulai".into()))?
}

#[tauri::command]
pub async fn voice_record_stop(app: AppHandle) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<VoiceState>().record_stop())
        .await
        .map_err(|_| AppError::Other("Transkripsi suara gagal".into()))?
}

#[tauri::command]
pub async fn voice_voices(app: AppHandle) -> Result<Vec<Voice>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<VoiceState>().voices(&app.state::<Db>())
    })
    .await
    .map_err(|_| AppError::Other("Daftar suara gagal dimuat".into()))?
}

#[tauri::command]
pub async fn voice_import(app: AppHandle, onnx_path: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<VoiceState>();
        let _guard = state
            .install_lock
            .try_lock()
            .map_err(|_| AppError::Other("Pemasangan suara lain masih berjalan".into()))?;
        catalog::import_voice(&state.data, Path::new(&onnx_path))
    })
    .await
    .map_err(|_| AppError::Other("Impor suara gagal".into()))?
}

#[tauri::command]
pub fn set_voice(
    db: State<'_, Db>,
    state: State<'_, VoiceState>,
    id: String,
    params: Option<VoiceParams>,
) -> Result<VoiceSettings, AppError> {
    state.validate_id(&id)?;
    let conn = db.conn()?;
    let params = match params {
        Some(params) => params,
        None => settings::for_voice(&conn, &id)?,
    };
    settings::set(&conn, &id, params)
}

#[tauri::command]
pub async fn voice_speak(app: AppHandle, text: String) -> Result<(), AppError> {
    if text.trim().is_empty() {
        return Err(AppError::Empty);
    }
    let settings = {
        let db = app.state::<Db>();
        let conn = db.conn()?;
        settings::get(&conn)?
    };
    // Reserve before queueing work: an immediate voice_stop cancels this run.
    let run = app.state::<VoiceState>().begin_speech()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<VoiceState>().speak(&text, settings, run)
    })
    .await
    .map_err(|_| AppError::Other("Pemutaran suara gagal".into()))?
}

#[tauri::command]
pub fn voice_stop(state: State<'_, VoiceState>) -> Result<(), AppError> {
    state.stop()
}

#[cfg(test)]
mod tests;
