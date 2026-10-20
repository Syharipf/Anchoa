//! File format conversion through external CLI tools: ImageMagick for images,
//! ffmpeg for audio/video, and poppler for PDF. Nothing here builds a shell
//! string: every argument is an `OsString` handed straight to `Command`.
//!
//! Only conversions whose tool exists on `PATH` are advertised, so the UI never
//! offers a format the backend cannot produce.

use std::ffi::{OsStr, OsString};
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::files::{self, Roots};

/// Images above this size are refused before spawning ImageMagick.
pub const IMAGE_SOURCE_LIMIT: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConvertKind {
    Image,
    Audio,
    Video,
    Pdf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub program: String,
    pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCapability {
    pub source_ext: String,
    pub kind: ConvertKind,
    pub targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertCapabilities {
    pub tools: Vec<ToolStatus>,
    pub formats: Vec<FormatCapability>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tool {
    Magick,
    Ffmpeg,
    Pdftoppm,
    Pdftotext,
}

#[derive(Debug, Default, Clone)]
struct Tools {
    magick: Option<PathBuf>,
    ffmpeg: Option<PathBuf>,
    pdftoppm: Option<PathBuf>,
    pdftotext: Option<PathBuf>,
}

impl Tools {
    fn program(&self, tool: Tool) -> Option<&Path> {
        let path = match tool {
            Tool::Magick => &self.magick,
            Tool::Ffmpeg => &self.ffmpeg,
            Tool::Pdftoppm => &self.pdftoppm,
            Tool::Pdftotext => &self.pdftotext,
        };
        path.as_deref()
    }

    fn has(&self, tool: Tool) -> bool {
        self.program(tool).is_some()
    }
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

fn find_tool(program: &str, path_env: Option<&OsStr>) -> Option<PathBuf> {
    let path_env = path_env?;
    std::env::split_paths(path_env)
        .map(|dir| dir.join(program))
        .find(|candidate| is_executable(candidate))
}

fn probe_tools(path_env: Option<&OsStr>) -> Tools {
    Tools {
        magick: find_tool("magick", path_env),
        ffmpeg: find_tool("ffmpeg", path_env),
        pdftoppm: find_tool("pdftoppm", path_env),
        pdftotext: find_tool("pdftotext", path_env),
    }
}

static TOOLS: std::sync::LazyLock<Tools> =
    std::sync::LazyLock::new(|| probe_tools(std::env::var_os("PATH").as_deref()));

const IMAGE_SOURCES: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "avif", "bmp", "gif", "tif", "tiff", "ico", "svg", "heic",
    "heif",
];
const PDF_SOURCES: &[&str] = &["pdf"];
const AUDIO_SOURCES: &[&str] = &["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a", "aac"];
const VIDEO_SOURCES: &[&str] = &["mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv"];
const AUDIO_TARGETS: &[&str] = &["mp3", "m4a", "ogg", "opus", "flac", "wav"];

#[derive(Debug)]
struct Rule {
    sources: &'static [&'static str],
    target: &'static str,
    tool: Tool,
    kind: ConvertKind,
}

const RULES: &[Rule] = &[
    Rule { sources: IMAGE_SOURCES, target: "png", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "jpg", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "webp", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "avif", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "tif", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "bmp", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "gif", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "ico", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: IMAGE_SOURCES, target: "pdf", tool: Tool::Magick, kind: ConvertKind::Image },
    Rule { sources: PDF_SOURCES, target: "png", tool: Tool::Pdftoppm, kind: ConvertKind::Pdf },
    Rule { sources: PDF_SOURCES, target: "jpg", tool: Tool::Pdftoppm, kind: ConvertKind::Pdf },
    Rule { sources: PDF_SOURCES, target: "tif", tool: Tool::Pdftoppm, kind: ConvertKind::Pdf },
    Rule { sources: PDF_SOURCES, target: "txt", tool: Tool::Pdftotext, kind: ConvertKind::Pdf },
    Rule { sources: AUDIO_SOURCES, target: "mp3", tool: Tool::Ffmpeg, kind: ConvertKind::Audio },
    Rule { sources: AUDIO_SOURCES, target: "m4a", tool: Tool::Ffmpeg, kind: ConvertKind::Audio },
    Rule { sources: AUDIO_SOURCES, target: "ogg", tool: Tool::Ffmpeg, kind: ConvertKind::Audio },
    Rule { sources: AUDIO_SOURCES, target: "opus", tool: Tool::Ffmpeg, kind: ConvertKind::Audio },
    Rule { sources: AUDIO_SOURCES, target: "flac", tool: Tool::Ffmpeg, kind: ConvertKind::Audio },
    Rule { sources: AUDIO_SOURCES, target: "wav", tool: Tool::Ffmpeg, kind: ConvertKind::Audio },
    Rule { sources: VIDEO_SOURCES, target: "mp4", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "webm", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "mkv", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "mp3", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "m4a", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "ogg", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "opus", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "flac", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
    Rule { sources: VIDEO_SOURCES, target: "wav", tool: Tool::Ffmpeg, kind: ConvertKind::Video },
];

fn canonical_ext(ext: &str) -> &str {
    match ext {
        "jpeg" => "jpg",
        "tiff" => "tif",
        "oga" => "ogg",
        "m4v" => "mp4",
        "heif" => "heic",
        other => other,
    }
}

fn source_extensions() -> impl Iterator<Item = &'static str> {
    IMAGE_SOURCES
        .iter()
        .chain(PDF_SOURCES)
        .chain(AUDIO_SOURCES)
        .chain(VIDEO_SOURCES)
        .copied()
}

fn kind_of(source: &str, tools: &Tools) -> ConvertKind {
    RULES
        .iter()
        .find(|rule| rule.sources.contains(&source) && tools.has(rule.tool))
        .map(|rule| rule.kind)
        .unwrap_or(ConvertKind::Image)
}

fn capabilities_with(tools: &Tools) -> ConvertCapabilities {
    let mut formats = Vec::new();
    for source in source_extensions() {
        let mut targets: Vec<String> = Vec::new();
        for rule in RULES {
            if !rule.sources.contains(&source) || !tools.has(rule.tool) {
                continue;
            }
            if canonical_ext(source) == canonical_ext(rule.target) {
                continue;
            }
            if !targets.iter().any(|target| target == rule.target) {
                targets.push(rule.target.to_string());
            }
        }
        if !targets.is_empty() {
            formats.push(FormatCapability {
                source_ext: source.to_string(),
                kind: kind_of(source, tools),
                targets,
            });
        }
    }
    let status = |program: &str, available: bool| ToolStatus {
        program: program.to_string(),
        available,
    };
    ConvertCapabilities {
        tools: vec![
            status("magick", tools.has(Tool::Magick)),
            status("ffmpeg", tools.has(Tool::Ffmpeg)),
            status("pdftoppm", tools.has(Tool::Pdftoppm)),
            status("pdftotext", tools.has(Tool::Pdftotext)),
        ],
        formats,
    }
}

pub fn capabilities() -> ConvertCapabilities {
    capabilities_with(&TOOLS)
}

fn normalize_target(raw: &str) -> Result<String, AppError> {
    let target = raw.trim().trim_start_matches('.').to_ascii_lowercase();
    if target.is_empty() || !target.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::Invalid("Format tujuan tidak valid".into()));
    }
    Ok(target)
}

fn plan_for(source: &str, target: &str, tools: &Tools) -> Result<&'static Rule, AppError> {
    if canonical_ext(source) == canonical_ext(target) {
        return Err(AppError::Invalid(
            "Format tujuan sama dengan format sumber".into(),
        ));
    }
    let rule = RULES
        .iter()
        .find(|rule| rule.sources.contains(&source) && rule.target == target)
        .ok_or_else(|| {
            AppError::Invalid(format!(
                "Konversi .{source} ke .{target} tidak didukung"
            ))
        })?;
    if !tools.has(rule.tool) {
        let program = match rule.tool {
            Tool::Magick => "ImageMagick (magick)",
            Tool::Ffmpeg => "ffmpeg",
            Tool::Pdftoppm => "pdftoppm",
            Tool::Pdftotext => "pdftotext",
        };
        return Err(AppError::Other(format!(
            "Konversi membutuhkan {program} yang belum terpasang"
        )));
    }
    Ok(rule)
}

fn push_all(args: &mut Vec<OsString>, values: &[&str]) {
    args.extend(values.iter().map(OsString::from));
}

fn audio_codec_args(target: &str) -> Vec<&'static str> {
    match target {
        "mp3" => vec!["-c:a", "libmp3lame", "-q:a", "2"],
        "m4a" => vec!["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
        "ogg" => vec!["-c:a", "libvorbis", "-q:a", "5"],
        "opus" => vec!["-c:a", "libopus", "-b:a", "128k"],
        "flac" => vec!["-c:a", "flac"],
        "wav" => vec!["-c:a", "pcm_s16le"],
        _ => Vec::new(),
    }
}

fn args_for(rule: &Rule, source: &Path, output: &Path) -> Vec<OsString> {
    let mut args = Vec::new();
    match rule.tool {
        Tool::Magick => {
            push_all(&mut args, &["-limit", "memory", "512MiB", "-limit", "map", "1536MiB"]);
            if rule.target == "pdf" {
                push_all(&mut args, &["-density", "150"]);
            }
            args.push(OsString::from(format!("{}[0]", source.display())));
            args.push(OsString::from("-auto-orient"));
            match rule.target {
                "jpg" => push_all(
                    &mut args,
                    &["-background", "white", "-alpha", "remove", "-alpha", "off", "-quality", "92"],
                ),
                "webp" => push_all(&mut args, &["-quality", "90"]),
                "avif" => push_all(&mut args, &["-quality", "80"]),
                "tif" => push_all(&mut args, &["-compress", "lzw"]),
                "bmp" => push_all(
                    &mut args,
                    &["-background", "white", "-alpha", "remove", "-alpha", "off"],
                ),
                "gif" => push_all(&mut args, &["-layers", "optimize"]),
                "ico" => push_all(&mut args, &["-resize", "256x256>"]),
                _ => {}
            }
            args.push(output.as_os_str().to_os_string());
        }
        Tool::Pdftoppm => {
            push_all(
                &mut args,
                &["-f", "1", "-l", "1", "-singlefile", "-r", "150", "-scale-to", "4096"],
            );
            match rule.target {
                "jpg" => push_all(&mut args, &["-jpeg", "-jpegopt", "quality=90"]),
                "tif" => push_all(&mut args, &["-tiff", "-tiffcompression", "lzw"]),
                _ => push_all(&mut args, &["-png"]),
            }
            args.push(source.as_os_str().to_os_string());
            args.push(output.with_extension("").into_os_string());
        }
        Tool::Pdftotext => {
            push_all(&mut args, &["-layout", "-enc", "UTF-8"]);
            args.push(source.as_os_str().to_os_string());
            args.push(output.as_os_str().to_os_string());
        }
        Tool::Ffmpeg => {
            push_all(&mut args, &["-nostdin", "-loglevel", "error", "-y", "-i"]);
            args.push(source.as_os_str().to_os_string());
            if AUDIO_TARGETS.contains(&rule.target) {
                push_all(&mut args, &["-vn", "-map", "0:a:0?"]);
                push_all(&mut args, &audio_codec_args(rule.target));
            } else {
                match rule.target {
                    "webm" => push_all(
                        &mut args,
                        &["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k"],
                    ),
                    "mp4" => push_all(
                        &mut args,
                        &["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
                    ),
                    _ => push_all(
                        &mut args,
                        &["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "160k"],
                    ),
                }
            }
            args.push(output.as_os_str().to_os_string());
        }
    }
    args
}

struct Claimed {
    path: PathBuf,
    committed: bool,
}

impl Drop for Claimed {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn claim_output(dir: &Path, stem: &str, target: &str) -> Result<(Claimed, std::fs::File), AppError> {
    for counter in 1..1000_u32 {
        let name = if counter == 1 {
            format!("{stem}.{target}")
        } else {
            format!("{stem} ({counter}).{target}")
        };
        let path = dir.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((Claimed { path, committed: false }, file)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(AppError::Other(
        "Terlalu banyak berkas dengan nama yang sama".into(),
    ))
}

pub fn convert_file(path: &str, target: &str, roots: &Roots) -> Result<ConvertResult, AppError> {
    let canonical = files::guard(path, roots)?;
    if !canonical.is_file() {
        return Err(AppError::Invalid(
            "Hanya berkas biasa yang bisa dikonversi".into(),
        ));
    }
    let source_ext = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let target = normalize_target(target)?;
    let rule = plan_for(&source_ext, &target, &TOOLS)?;
    if rule.kind == ConvertKind::Image {
        let size = fs::metadata(&canonical)?.len();
        if size > IMAGE_SOURCE_LIMIT {
            return Err(AppError::Invalid(
                "Gambar terlalu besar untuk dikonversi (maksimal 512 MB)".into(),
            ));
        }
    }
    let parent = canonical
        .parent()
        .ok_or_else(|| AppError::Invalid("Folder induk tidak ditemukan".into()))?;
    let stem = canonical
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("berkas");
    let (mut claimed, file) = claim_output(parent, stem, &target)?;
    drop(file);
    let program = TOOLS
        .program(rule.tool)
        .ok_or_else(|| AppError::Other("Tool konversi tidak ditemukan".into()))?;
    let output = Command::new(program)
        .args(args_for(rule, &canonical, &claimed.path))
        .output()
        .map_err(|error| AppError::Other(format!("Gagal menjalankan konversi: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let line = stderr
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Proses konversi gagal")
            .trim();
        let short: String = line.chars().take(300).collect();
        return Err(AppError::Other(short));
    }
    let meta = fs::metadata(&claimed.path)?;
    if !meta.is_file() || (target != "txt" && meta.len() == 0) {
        return Err(AppError::Other("Hasil konversi tidak valid".into()));
    }
    let result_path = claimed.path.to_string_lossy().into_owned();
    claimed.committed = true;
    Ok(ConvertResult {
        path: result_path,
        bytes: meta.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn full_tools() -> Tools {
        Tools {
            magick: Some(PathBuf::from("magick")),
            ffmpeg: Some(PathBuf::from("ffmpeg")),
            pdftoppm: Some(PathBuf::from("pdftoppm")),
            pdftotext: Some(PathBuf::from("pdftotext")),
        }
    }

    fn target_list(formats: &[FormatCapability], source: &str) -> Vec<String> {
        formats
            .iter()
            .find(|format| format.source_ext == source)
            .map(|format| format.targets.clone())
            .unwrap_or_default()
    }

    #[test]
    fn capabilities_list_the_installed_matrix() {
        let caps = capabilities_with(&full_tools());
        assert_eq!(
            target_list(&caps.formats, "png"),
            ["jpg", "webp", "avif", "tif", "bmp", "gif", "ico", "pdf"]
        );
        assert_eq!(target_list(&caps.formats, "pdf"), ["png", "jpg", "tif", "txt"]);
        assert!(target_list(&caps.formats, "wav").contains(&"mp3".to_string()));
        assert!(target_list(&caps.formats, "mp4").contains(&"webm".to_string()));
        assert!(caps.tools.iter().all(|tool| tool.available));
    }

    #[test]
    fn capabilities_drop_rows_when_a_tool_is_missing() {
        let mut tools = full_tools();
        tools.ffmpeg = None;
        let caps = capabilities_with(&tools);
        assert!(!caps.formats.iter().any(|format| format.kind == ConvertKind::Audio));
        assert!(!caps.formats.iter().any(|format| format.kind == ConvertKind::Video));
        assert!(caps.formats.iter().any(|format| format.kind == ConvertKind::Image));

        let mut tools = full_tools();
        tools.magick = None;
        let caps = capabilities_with(&tools);
        assert!(!caps.formats.iter().any(|format| format.kind == ConvertKind::Image));
        assert!(caps.formats.iter().any(|format| format.kind == ConvertKind::Pdf));
    }

    #[test]
    fn capabilities_skip_same_format_and_synonyms() {
        let caps = capabilities_with(&full_tools());
        assert!(!target_list(&caps.formats, "png").contains(&"png".to_string()));
        assert!(!target_list(&caps.formats, "jpeg").contains(&"jpg".to_string()));
        assert!(!target_list(&caps.formats, "tiff").contains(&"tif".to_string()));
        assert!(!target_list(&caps.formats, "oga").contains(&"ogg".to_string()));
        assert!(!target_list(&caps.formats, "m4v").contains(&"mp4".to_string()));
    }

    #[test]
    fn plan_rejects_unknown_and_missing_tool_pairs() {
        let tools = full_tools();
        assert!(matches!(plan_for("txt", "png", &tools), Err(AppError::Invalid(_))));
        assert!(matches!(plan_for("png", "exe", &tools), Err(AppError::Invalid(_))));
        assert!(matches!(plan_for("png", "png", &tools), Err(AppError::Invalid(_))));

        let mut no_magick = full_tools();
        no_magick.magick = None;
        let error = plan_for("png", "jpg", &no_magick).unwrap_err();
        assert!(error.to_string().contains("ImageMagick"));
    }

    #[test]
    fn args_keep_paths_as_single_arguments() {
        let tools = full_tools();
        let rule = plan_for("png", "jpg", &tools).unwrap();
        let args = args_for(rule, Path::new("/tmp/a b; rm -rf x.png"), Path::new("/tmp/out.jpg"));
        assert!(args.iter().any(|arg| arg == "/tmp/a b; rm -rf x.png[0]"));
        assert!(args.iter().any(|arg| arg == "-auto-orient"));
        assert_eq!(args.last().unwrap(), "/tmp/out.jpg");
        assert!(!args.iter().any(|arg| arg.to_string_lossy().contains("&&")));
    }

    #[test]
    fn claim_never_overwrites_and_cleans_up_on_drop() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("foto.jpg"), b"lama").unwrap();
        let (claimed, file) = claim_output(dir.path(), "foto", "jpg").unwrap();
        drop(file);
        assert_eq!(claimed.path.file_name().unwrap(), "foto (2).jpg");
        assert_eq!(fs::read(dir.path().join("foto.jpg")).unwrap(), b"lama");

        let partial = claimed.path.clone();
        drop(claimed);
        assert!(!partial.exists(), "uncommitted output must be removed");
    }

    #[test]
    fn guard_rejects_paths_outside_the_roots() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let file = outside.path().join("x.png");
        fs::write(&file, b"x").unwrap();
        assert!(convert_file(file.to_str().unwrap(), "jpg", &roots).is_err());
    }

    #[test]
    fn converts_png_to_jpg_with_magick_when_available() {
        let tools = probe_tools(std::env::var_os("PATH").as_deref());
        let Some(magick) = tools.magick else { return };
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let source = home.path().join("foto.png");
        Command::new(&magick)
            .args(["-size", "4x4", "xc:red"])
            .arg(&source)
            .status()
            .unwrap();

        let first = convert_file(source.to_str().unwrap(), "jpg", &roots).unwrap();
        assert!(first.path.ends_with("foto.jpg"));
        assert!(first.bytes > 0);
        assert_eq!(&fs::read(&first.path).unwrap()[..2], &[0xFF, 0xD8]);
        assert!(source.exists(), "source must stay untouched");

        let second = convert_file(source.to_str().unwrap(), "jpg", &roots).unwrap();
        assert!(second.path.ends_with("foto (2).jpg"));
    }

    #[test]
    fn converts_pdf_first_page_with_poppler_when_available() {
        let tools = probe_tools(std::env::var_os("PATH").as_deref());
        let (Some(magick), Some(_)) = (tools.magick.as_ref(), tools.pdftoppm.as_ref()) else {
            return;
        };
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let pdf = home.path().join("laporan.pdf");
        Command::new(magick)
            .args(["-size", "120x60", "xc:white", "-pointsize", "18", "-annotate", "+8+36", "halo"])
            .arg(&pdf)
            .status()
            .unwrap();

        let png = convert_file(pdf.to_str().unwrap(), "png", &roots).unwrap();
        assert!(png.path.ends_with("laporan.png"));
        assert!(png.bytes > 0);
        assert!(!home.path().join("laporan-2.png").exists(), "only the first page");
    }

    #[test]
    fn converts_wav_to_mp3_with_ffmpeg_when_available() {
        let tools = probe_tools(std::env::var_os("PATH").as_deref());
        let Some(ffmpeg) = tools.ffmpeg.as_ref() else { return };
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let wav = home.path().join("nada.wav");
        Command::new(ffmpeg)
            .args(["-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4"])
            .arg(&wav)
            .status()
            .unwrap();

        let mp3 = convert_file(wav.to_str().unwrap(), "mp3", &roots).unwrap();
        assert!(mp3.path.ends_with("nada.mp3"));
        assert!(mp3.bytes > 0);
        assert!(matches!(
            convert_file(wav.to_str().unwrap(), "mp4", &roots),
            Err(AppError::Invalid(_))
        ));
    }
}
