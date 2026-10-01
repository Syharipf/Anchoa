use super::{
    VoiceInstallProgress, VoiceInstallStage, catalog,
    download::Download,
    process::{self, ScratchDir},
};
use crate::error::AppError;
use std::{ffi::OsStr, fs, path::Path, process::Command, sync::atomic::AtomicBool};

fn fetch(
    url: &str,
    sha256: &str,
    dest: &Path,
    component: &str,
    progress: &mut impl FnMut(VoiceInstallProgress),
) -> Result<(), AppError> {
    Download { url, sha256, dest }.run(|event| {
        progress(VoiceInstallProgress {
            component: component.into(),
            file: dest
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            done_bytes: event.done_bytes,
            total_bytes: event.total_bytes,
            stage: if event.verified {
                VoiceInstallStage::Verified
            } else {
                VoiceInstallStage::Downloading
            },
        })
    })
}

pub fn install(
    data: &Path,
    path: &OsStr,
    component: &str,
    progress: &mut impl FnMut(VoiceInstallProgress),
) -> Result<(), AppError> {
    match component {
        "whisper-model" => fetch(
            catalog::WHISPER_URL,
            catalog::WHISPER_SHA256,
            &data.join("models/whisper/ggml-base.bin"),
            component,
            progress,
        )?,
        "piper" => {
            if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
                return Err(AppError::Invalid(
                    "Piper bawaan tersedia untuk Linux x86_64".into(),
                ));
            }
            let tar = process::find_binary("tar", path)
                .ok_or_else(|| AppError::Other("tar belum tersedia untuk memasang Piper".into()))?;
            let archive = data.join("piper/piper_linux_x86_64.tar.gz");
            fetch(
                catalog::PIPER_URL,
                catalog::PIPER_SHA256,
                &archive,
                component,
                progress,
            )?;
            extract_piper(data, &archive, &tar)?;
        }
        value if value.starts_with("voice:") => {
            let id = &value[6..];
            let voice = catalog::builtin(id)
                .ok_or_else(|| AppError::Invalid("Suara katalog tidak dikenal".into()))?;
            let root = data.join("piper/voices");
            let scratch = ScratchDir::new(&root)?;
            let model = scratch.0.join(format!("{id}.onnx"));
            fetch(voice.url_onnx, voice.sha_onnx, &model, component, progress)?;
            fetch(
                voice.url_json,
                voice.sha_json,
                &catalog::config_path(&model),
                component,
                progress,
            )?;
            catalog::validate_pair(&model)?;
            replace_directory(&scratch.0, &root.join(id))?;
        }
        _ => return Err(AppError::Invalid("Komponen suara tidak dikenal".into())),
    }
    progress(VoiceInstallProgress {
        component: component.into(),
        file: String::new(),
        done_bytes: 0,
        total_bytes: None,
        stage: VoiceInstallStage::Installed,
    });
    Ok(())
}

/// Called only after the archive has passed its pinned SHA-256 check.
pub(super) fn extract_piper(data: &Path, archive: &Path, tar: &Path) -> Result<(), AppError> {
    let scratch = ScratchDir::new(&data.join("piper"))?;
    let mut command = Command::new(tar);
    command
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(&scratch.0)
        .args(["--no-same-owner", "--no-same-permissions"]);
    process::run(
        command,
        None,
        &AtomicBool::new(false),
        &scratch.0.join("extract.log"),
    )?;
    let extracted = scratch.0.join("piper");
    if !process::executable(&extracted.join("piper")) {
        return Err(AppError::Invalid(
            "Arsip Piper tidak memiliki binary yang valid".into(),
        ));
    }
    replace_directory(&extracted, &data.join("piper/bin"))
}

fn replace_directory(source: &Path, dest: &Path) -> Result<(), AppError> {
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::Invalid("Lokasi pemasangan tidak valid".into()))?;
    let backup = ScratchDir::new(parent)?;
    let old = backup.0.join("previous");
    let had_previous = dest.exists();
    if had_previous {
        fs::rename(dest, &old)?;
    }
    if let Err(error) = fs::rename(source, dest) {
        if had_previous {
            fs::rename(&old, dest)?;
        }
        return Err(error.into());
    }
    Ok(())
}
