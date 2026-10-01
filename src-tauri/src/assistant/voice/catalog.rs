use super::process::ScratchDir;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

// Copied verbatim from the plan's "Konstanta unduhan". Never derive or guess
// production hashes from HTTP responses.
pub const WHISPER_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
pub const WHISPER_SHA256: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
pub const PIPER_URL: &str =
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz";
pub const PIPER_SHA256: &str = "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992";

pub struct BuiltinVoice {
    pub id: &'static str,
    pub label: &'static str,
    pub language: &'static str,
    pub quality: &'static str,
    pub url_onnx: &'static str,
    pub sha_onnx: &'static str,
    pub url_json: &'static str,
    pub sha_json: &'static str,
}

pub const VOICES: &[BuiltinVoice] = &[
    BuiltinVoice {
        id: "id_ID-news_tts-medium",
        label: "Indonesia · News",
        language: "id_ID",
        quality: "medium",
        url_onnx: "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx",
        sha_onnx: "ed8f02aa593f7af6b19acbdb8142e0da0dd72f46194eb33d38e0eb10a52597e8",
        url_json: "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json",
        sha_json: "1ef677072668a5e172e0759b1d3871f129009d1167f093325a17607f7add5ad7",
    },
    BuiltinVoice {
        id: "en_US-amy-medium",
        label: "English · Amy",
        language: "en_US",
        quality: "medium",
        url_onnx: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx",
        sha_onnx: "b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18",
        url_json: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json",
        sha_json: "95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77",
    },
    BuiltinVoice {
        id: "en_US-lessac-high",
        label: "English · Lessac",
        language: "en_US",
        quality: "high",
        url_onnx: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx",
        sha_onnx: "4cabf7c3a638017137f34a1516522032d4fe3f38228a843cc9b764ddcbcd9e09",
        url_json: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json",
        sha_json: "db42b97d9859f257bc1561b8ed980e7fb2398402050a74ddd6cbec931a92412f",
    },
    BuiltinVoice {
        id: "en_US-ryan-high",
        label: "English · Ryan",
        language: "en_US",
        quality: "high",
        url_onnx: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx",
        sha_onnx: "b3990d7606e183ec8dbfba70a4607074f162de1a0c412e0180d1ff60bb154eca",
        url_json: "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json",
        sha_json: "c6d3b98f08315cb4bebf0d49d50fc4ff491b503c64b940cd3d5ca28543b48011",
    },
];

pub const MAX_VOICE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct ImportedVoice {
    label: String,
}

pub fn builtin(id: &str) -> Option<&'static BuiltinVoice> {
    VOICES.iter().find(|voice| voice.id == id)
}

pub fn valid_custom_id(id: &str) -> bool {
    id.strip_prefix("custom-")
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}

pub fn model_path(data: &Path, id: &str) -> Result<PathBuf, AppError> {
    if builtin(id).is_some() {
        return Ok(data
            .join("piper/voices")
            .join(id)
            .join(format!("{id}.onnx")));
    }
    if valid_custom_id(id) {
        return Ok(data.join("piper/voices/custom").join(id).join("voice.onnx"));
    }
    Err(AppError::Invalid("Suara tidak dikenal".into()))
}

pub fn config_path(onnx: &Path) -> PathBuf {
    let mut name = onnx.as_os_str().to_os_string();
    name.push(".json");
    PathBuf::from(name)
}

fn open_voice_file(path: &Path) -> Result<File, AppError> {
    // Check before opening so directories and named pipes are never opened.
    if !fs::metadata(path)?.is_file() {
        return Err(AppError::Invalid("Model suara harus berupa berkas".into()));
    }
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() >= MAX_VOICE_BYTES {
        return Err(AppError::Invalid(
            "Berkas suara harus berisi data dan berukuran kurang dari 200 MB".into(),
        ));
    }
    Ok(file)
}

fn read_config(file: &mut File) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::new();
    file.take(MAX_VOICE_BYTES).read_to_end(&mut bytes)?;
    if bytes.len() as u64 >= MAX_VOICE_BYTES {
        return Err(AppError::Invalid("Konfigurasi suara terlalu besar".into()));
    }
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Invalid("JSON suara tidak terbaca".into()))?;
    let rate = json
        .pointer("/audio/sample_rate")
        .and_then(serde_json::Value::as_u64);
    if !rate.is_some_and(|rate| rate > 0 && rate <= u32::MAX as u64) {
        return Err(AppError::Invalid(
            "JSON suara harus memiliki audio.sample_rate yang valid".into(),
        ));
    }
    Ok(bytes)
}

pub fn validate_pair(onnx: &Path) -> Result<(), AppError> {
    open_voice_file(onnx)?;
    read_config(&mut open_voice_file(&config_path(onnx))?)?;
    Ok(())
}

pub fn import_voice(data: &Path, onnx: &Path) -> Result<String, AppError> {
    if onnx.extension() != Some(std::ffi::OsStr::new("onnx")) {
        return Err(AppError::Invalid("Pilih model suara .onnx".into()));
    }
    let model = open_voice_file(onnx)?;
    let config = read_config(&mut open_voice_file(&config_path(onnx))?)?;
    let root = data.join("piper/voices/custom");
    let scratch = ScratchDir::new(&root)?;
    let id = format!("custom-{}", uuid::Uuid::now_v7());
    let mut target = File::create(scratch.0.join("voice.onnx"))?;
    let copied = std::io::copy(&mut model.take(MAX_VOICE_BYTES), &mut target)?;
    if copied == 0 || copied >= MAX_VOICE_BYTES {
        return Err(AppError::Invalid("Ukuran model suara tidak valid".into()));
    }
    target.sync_all()?;
    File::create(scratch.0.join("voice.onnx.json"))?.write_all(&config)?;
    let label = onnx
        .file_stem()
        .ok_or_else(|| AppError::Invalid("Nama model tidak valid".into()))?
        .to_string_lossy()
        .into_owned();
    let metadata = serde_json::to_vec(&ImportedVoice { label })
        .map_err(|error| AppError::Other(error.to_string()))?;
    fs::write(scratch.0.join("voice.json"), metadata)?;
    fs::rename(&scratch.0, root.join(&id))?;
    Ok(id)
}

/// Only valid pairs are visible as installed voices; partial installs cannot
/// be selected accidentally.
pub fn custom_voices(data: &Path) -> Result<Vec<(String, String)>, AppError> {
    let root = data.join("piper/voices/custom");
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.into()),
    };
    let mut voices = Vec::new();
    for entry in entries {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type()?.is_dir()
            || !valid_custom_id(&id)
            || validate_pair(&entry.path().join("voice.onnx")).is_err()
        {
            continue;
        }
        let metadata = fs::read(entry.path().join("voice.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ImportedVoice>(&bytes).ok());
        if let Some(metadata) = metadata {
            voices.push((id, metadata.label));
        }
    }
    voices.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
    Ok(voices)
}
