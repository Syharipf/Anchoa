use super::{
    VoiceInstallProgress, VoiceInstallStage, catalog,
    download::Download,
    process::{self, ProcessControl, ScratchDir},
};
use crate::error::AppError;
use std::{ffi::OsStr, fs, path::Path, process::Command};

fn fetch(
    url: &str,
    sha256: &str,
    dest: &Path,
    component: &str,
    progress: &mut impl FnMut(VoiceInstallProgress),
    control: &ProcessControl,
) -> Result<(), AppError> {
    Download { url, sha256, dest }.run(control, |event| {
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
    control: &ProcessControl,
) -> Result<(), AppError> {
    match component {
        "whisper-model" => {
            let scratch = control.scratch(&process::temporary_root(data))?;
            let model = scratch.0.join("ggml-base.bin");
            fetch(
                catalog::WHISPER_URL,
                catalog::WHISPER_SHA256,
                &model,
                component,
                progress,
                control,
            )?;
            control.with_active(|| {
                let dest = data.join("models/whisper/ggml-base.bin");
                fs::create_dir_all(data.join("models/whisper"))?;
                fs::rename(&model, dest)?;
                Ok(())
            })?;
        }
        "piper" => {
            if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
                return Err(AppError::Invalid(
                    "Piper bawaan tersedia untuk Linux x86_64".into(),
                ));
            }
            let tar = process::find_binary("tar", path)
                .ok_or_else(|| AppError::Other("tar belum tersedia untuk memasang Piper".into()))?;
            let scratch = control.scratch(&process::temporary_root(data))?;
            let archive = scratch.0.join("piper_linux_x86_64.tar.gz");
            fetch(
                catalog::PIPER_URL,
                catalog::PIPER_SHA256,
                &archive,
                component,
                progress,
                control,
            )?;
            extract_piper(data, &archive, &tar, control)?;
        }
        value if value.starts_with("voice:") => {
            let id = &value[6..];
            let voice = catalog::builtin(id)
                .ok_or_else(|| AppError::Invalid("Suara katalog tidak dikenal".into()))?;
            let root = data.join("piper/voices");
            let scratch = control.scratch(&process::temporary_root(data))?;
            let model = scratch.0.join(format!("{id}.onnx"));
            fetch(
                voice.url_onnx,
                voice.sha_onnx,
                &model,
                component,
                progress,
                control,
            )?;
            fetch(
                voice.url_json,
                voice.sha_json,
                &catalog::config_path(&model),
                component,
                progress,
                control,
            )?;
            catalog::validate_pair(&model)?;
            control.with_active(|| replace_directory(data, &scratch.0, &root.join(id)))?;
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
pub(super) fn extract_piper(
    data: &Path,
    archive: &Path,
    tar: &Path,
    control: &ProcessControl,
) -> Result<(), AppError> {
    let scratch = control.scratch(&process::temporary_root(data))?;
    let mut command = Command::new(tar);
    command
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(&scratch.0)
        .args(["--no-same-owner", "--no-same-permissions"]);
    process::run(command, None, control, &scratch.0.join("extract.log"))?;
    let extracted = scratch.0.join("piper");
    if !process::executable(&extracted.join("piper")) {
        return Err(AppError::Invalid(
            "Arsip Piper tidak memiliki binary yang valid".into(),
        ));
    }
    control.with_active(|| replace_directory(data, &extracted, &data.join("piper/bin")))
}

fn replace_directory(data: &Path, source: &Path, dest: &Path) -> Result<(), AppError> {
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::Invalid("Lokasi pemasangan tidak valid".into()))?;
    fs::create_dir_all(parent)?;
    let backup = ScratchDir::new(&process::temporary_root(data))?;
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
