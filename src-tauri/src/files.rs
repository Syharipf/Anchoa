use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const TEXT_PREVIEW_LIMIT: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Folder,
    Image,
    Video,
    Pdf,
    Text,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PasteMode {
    Copy,
    Move,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnConflict {
    Replace,
    Skip,
    Rename,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    pub path: String,
    pub icon: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlaces {
    pub places: Vec<Place>,
    pub devices: Vec<Place>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub modified: i64,
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Crumb {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub parent: Option<String>,
    pub crumbs: Vec<Crumb>,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteRequest {
    pub sources: Vec<String>,
    pub dest: String,
    pub mode: PasteMode,
    pub on_conflict: Option<OnConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpReport {
    pub done: Vec<String>,
    pub failed: Vec<Failure>,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPreview {
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct Roots {
    pub home: PathBuf,
    pub devices: Vec<PathBuf>,
}

impl Roots {
    pub fn new(home: PathBuf, devices: Vec<PathBuf>) -> Self {
        let home = fs::canonicalize(&home).unwrap_or(home);
        let devices = devices
            .into_iter()
            .map(|d| fs::canonicalize(&d).unwrap_or(d))
            .collect();
        Self { home, devices }
    }
}

pub fn guard(path: &str, roots: &Roots) -> Result<PathBuf, AppError> {
    let p = Path::new(path);
    let canonical = match fs::canonicalize(p) {
        Ok(c) => c,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Err(AppError::Invalid("Berkas tidak ditemukan".into()));
        }
        Err(e) => return Err(AppError::Io(e)),
    };

    if canonical.starts_with(&roots.home) || roots.devices.iter().any(|d| canonical.starts_with(d)) {
        Ok(canonical)
    } else {
        Err(AppError::Invalid("Di luar folder yang diizinkan".into()))
    }
}

pub fn guard_entry(path: &str, roots: &Roots) -> Result<PathBuf, AppError> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.ends_with("/.")
        || trimmed.ends_with("/..")
    {
        return Err(AppError::Invalid("Nama file tidak valid".into()));
    }

    let p = Path::new(path);
    let file_name = match p.file_name() {
        Some(name) if name != "." && name != ".." && !name.is_empty() => name,
        _ => return Err(AppError::Invalid("Nama file tidak valid".into())),
    };

    if fs::symlink_metadata(p).is_ok_and(|m| !m.is_symlink())
        && let Some(canon) = fs::canonicalize(p)
            .ok()
            .filter(|c| *c == roots.home || roots.devices.contains(c))
    {
        return Ok(canon);
    }

    let parent = match p.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => return Err(AppError::Invalid("Nama file tidak valid".into())),
    };

    let parent_str = match parent.to_str() {
        Some(s) => s,
        None => return Err(AppError::Invalid("Nama file tidak valid".into())),
    };

    let parent_canonical = guard(parent_str, roots)?;
    let entry = parent_canonical.join(file_name);

    match fs::symlink_metadata(&entry) {
        Ok(_) => Ok(entry),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            Err(AppError::Invalid("Berkas tidak ditemukan".into()))
        }
        Err(e) => Err(AppError::Io(e)),
    }
}

pub fn xdg_dir(home: &Path, user_dirs_text: Option<&str>, key: &str, default_sub: &str) -> PathBuf {
    if let Some(text) = user_dirs_text {
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once('=') {
                if k.trim() != key {
                    continue;
                }
                let mut val = v.trim();
                if ((val.starts_with('"') && val.ends_with('"'))
                    || (val.starts_with('\'') && val.ends_with('\'')))
                    && val.len() >= 2
                {
                    val = &val[1..val.len() - 1];
                }
                let expanded = if val == "$HOME" {
                    home.to_path_buf()
                } else if let Some(rel) = val.strip_prefix("$HOME/") {
                    home.join(rel)
                } else {
                    PathBuf::from(val)
                };
                return expanded;
            }
        }
    }
    home.join(default_sub)
}

pub fn xdg_places(home: &Path, user_dirs_text: Option<&str>, data_dir: &Path) -> Vec<Place> {
    let mut places = Vec::new();

    if home.exists() {
        places.push(Place {
            name: "Home".to_string(),
            path: home.to_string_lossy().to_string(),
            icon: "home".to_string(),
        });
    }

    let specs = [
        ("XDG_DOCUMENTS_DIR", "Dokumen", "doc", "Documents"),
        ("XDG_DOWNLOAD_DIR", "Unduhan", "download", "Downloads"),
        ("XDG_PICTURES_DIR", "Gambar", "image", "Pictures"),
        ("XDG_VIDEOS_DIR", "Video", "video", "Videos"),
        ("XDG_MUSIC_DIR", "Musik", "music", "Music"),
    ];

    for (key, name, icon, default_sub) in specs {
        let dir_path = xdg_dir(home, user_dirs_text, key, default_sub);

        if dir_path.is_dir() {
            places.push(Place {
                name: name.to_string(),
                path: dir_path.to_string_lossy().to_string(),
                icon: icon.to_string(),
            });
        }
    }

    if data_dir.exists() {
        places.push(Place {
            name: "Data Anchoa".to_string(),
            path: data_dir.to_string_lossy().to_string(),
            icon: "app".to_string(),
        });
    }

    places
}

fn decode_octal(s: &str) -> String {
    let mut bytes = Vec::new();
    let chars: Vec<u8> = s.bytes().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == b'\\'
            && i + 3 < chars.len()
            && chars[i + 1].is_ascii_digit()
            && chars[i + 2].is_ascii_digit()
            && chars[i + 3].is_ascii_digit()
        {
            let d1 = chars[i + 1] - b'0';
            let d2 = chars[i + 2] - b'0';
            let d3 = chars[i + 3] - b'0';
            if d1 <= 3 && d2 < 8 && d3 < 8 {
                let oct = (d1 << 6) | (d2 << 3) | d3;
                bytes.push(oct);
                i += 4;
                continue;
            }
        }
        bytes.push(chars[i]);
        i += 1;
    }
    String::from_utf8_lossy(&bytes).to_string()
}

pub fn parse_mounts(proc_mounts: &str, user: &str) -> Vec<Place> {
    let prefix = format!("/run/media/{user}/");
    let mut mounts = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in proc_mounts.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let raw_mount = parts[1];
        let decoded = decode_octal(raw_mount);
        if decoded.starts_with(&prefix) && decoded.len() > prefix.len() && seen.insert(decoded.clone()) {
            let p = Path::new(&decoded);
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| decoded.clone());
            mounts.push(Place {
                name,
                path: decoded,
                icon: "drive".to_string(),
            });
        }
    }
    mounts
}

pub fn kind_of(path: &Path) -> FileKind {
    if path.is_dir() {
        return FileKind::Folder;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
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

pub fn list_dir(path: &str, hidden: bool, roots: &Roots) -> Result<Listing, AppError> {
    let canonical = guard(path, roots)?;
    if !canonical.is_dir() {
        return Err(AppError::Invalid("Bukan sebuah folder".into()));
    }

    let (root, root_name) = if canonical.starts_with(&roots.home) {
        (&roots.home, "Home".to_string())
    } else if let Some(d) = roots.devices.iter().find(|d| canonical.starts_with(d)) {
        let name = d
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Perangkat".to_string());
        (d, name)
    } else {
        (&roots.home, "Home".to_string())
    };

    let parent = if canonical == *root {
        None
    } else {
        canonical.parent().map(|p| p.to_string_lossy().to_string())
    };

    let mut crumbs = Vec::new();
    crumbs.push(Crumb {
        name: root_name,
        path: root.to_string_lossy().to_string(),
    });
    if let Ok(rel) = canonical.strip_prefix(root) {
        let mut cur = root.to_path_buf();
        for comp in rel.components() {
            let comp_str = comp.as_os_str().to_string_lossy().to_string();
            cur.push(&comp_str);
            crumbs.push(Crumb {
                name: comp_str,
                path: cur.to_string_lossy().to_string(),
            });
        }
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&canonical)?;
    for item in read_dir.flatten() {
        let file_name = item.file_name().to_string_lossy().to_string();
        let hidden_entry = file_name.starts_with('.');
        if hidden_entry && !hidden {
            continue;
        }
        let entry_path = item.path();
        let meta = match fs::metadata(&entry_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let kind = if is_dir {
            FileKind::Folder
        } else {
            kind_of(&entry_path)
        };
        let size = if is_dir {
            fs::read_dir(&entry_path).map(|r| r.count() as u64).unwrap_or(0)
        } else {
            meta.len()
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        entries.push(Entry {
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            kind,
            size,
            modified,
            hidden: hidden_entry,
        });
    }

    entries.sort_by(|a, b| {
        let a_is_folder = a.kind == FileKind::Folder;
        let b_is_folder = b.kind == FileKind::Folder;
        match (a_is_folder, b_is_folder) {
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
        path: canonical.to_string_lossy().to_string(),
        parent,
        crumbs,
        entries,
    })
}

pub fn read_text(path: &str, roots: &Roots) -> Result<TextPreview, AppError> {
    let canonical = guard(path, roots)?;
    let meta = fs::metadata(&canonical)?;
    if !meta.is_file() {
        return Err(AppError::Invalid(
            "Hanya berkas biasa yang bisa dipratinjau".into(),
        ));
    }
    let file = fs::File::open(&canonical)?;
    let len = meta.len();
    let mut buf = Vec::new();
    file.take(TEXT_PREVIEW_LIMIT as u64).read_to_end(&mut buf)?;
    let truncated = len > TEXT_PREVIEW_LIMIT as u64;
    let text = String::from_utf8_lossy(&buf).to_string();
    Ok(TextPreview { text, truncated })
}

pub fn unique_name(dest_dir: &Path, name: &str) -> PathBuf {
    let is_dir = dest_dir.join(name).is_dir();
    let (stem, ext) = if is_dir || name.starts_with('.') {
        (name.to_string(), String::new())
    } else {
        let p = Path::new(name);
        match p.extension().and_then(|e| e.to_str()) {
            Some(ext) if !ext.is_empty() => {
                let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
                (stem.to_string(), format!(".{ext}"))
            }
            _ => (name.to_string(), String::new()),
        }
    };

    let mut counter = 2;
    loop {
        let candidate = format!("{stem} ({counter}){ext}");
        let target = dest_dir.join(&candidate);
        if fs::symlink_metadata(&target).is_err() {
            return target;
        }
        counter += 1;
    }
}

fn copy_recursive(src: &Path, dst: &Path, overwrite: bool) -> io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        if let Ok(dst_meta) = fs::symlink_metadata(dst) {
            if !overwrite {
                return Ok(());
            }
            if !dst_meta.is_dir() {
                fs::remove_file(dst)?;
            }
        }
        let target = fs::read_link(src)?;
        // ponytail: unix symlinks only, Fase 9 adds Windows
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, dst)?;
        #[cfg(not(unix))]
        let _ = (&target, dst);
        Ok(())
    } else if meta.is_dir() {
        if let Ok(dst_meta) = fs::symlink_metadata(dst) {
            if dst_meta.file_type().is_symlink() {
                if !overwrite {
                    return Ok(());
                }
                fs::remove_file(dst)?;
                fs::create_dir_all(dst)?;
            }
        } else {
            fs::create_dir_all(dst)?;
        }
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let entry_path = entry.path();
            let dest_child = dst.join(entry.file_name());
            copy_recursive(&entry_path, &dest_child, overwrite)?;
        }
        Ok(())
    } else {
        if let Ok(dst_meta) = fs::symlink_metadata(dst) {
            if !overwrite {
                return Ok(());
            }
            if !dst_meta.is_dir() {
                fs::remove_file(dst)?;
            }
        }
        fs::copy(src, dst)?;
        Ok(())
    }
}

fn execute_paste(
    src_str: &str,
    src: &Path,
    dst: &Path,
    mode: PasteMode,
    overwrite: bool,
    done: &mut Vec<String>,
    failed: &mut Vec<Failure>,
) {
    match mode {
        PasteMode::Copy => match copy_recursive(src, dst, overwrite) {
            Ok(()) => done.push(dst.to_string_lossy().to_string()),
            Err(e) => failed.push(Failure {
                path: src_str.to_string(),
                error: e.to_string(),
            }),
        },
        PasteMode::Move => {
            let src_is_dir = fs::symlink_metadata(src).map(|m| m.is_dir()).unwrap_or(false);
            let dst_is_dir = fs::symlink_metadata(dst).map(|m| m.is_dir()).unwrap_or(false);
            let rename_res = if dst_is_dir && src_is_dir {
                Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "Folder tujuan sudah ada",
                ))
            } else {
                fs::rename(src, dst)
            };

            match rename_res {
                Ok(()) => done.push(dst.to_string_lossy().to_string()),
                Err(_) => match copy_recursive(src, dst, overwrite) {
                    Ok(()) => {
                        let remove_res = if src_is_dir {
                            fs::remove_dir_all(src)
                        } else {
                            fs::remove_file(src)
                        };
                        match remove_res {
                            Ok(()) => done.push(dst.to_string_lossy().to_string()),
                            Err(e) => failed.push(Failure {
                                path: src_str.to_string(),
                                error: format!("Gagal menghapus berkas asal: {e}"),
                            }),
                        }
                    }
                    Err(e) => failed.push(Failure {
                        path: src_str.to_string(),
                        error: e.to_string(),
                    }),
                },
            }
        }
    }
}

pub fn paste(req: &PasteRequest, roots: &Roots) -> Result<OpReport, AppError> {
    let dest_canonical = guard(&req.dest, roots)?;
    if !dest_canonical.is_dir() {
        return Err(AppError::Invalid("Tujuan harus berupa folder".into()));
    }

    let mut sources = Vec::new();
    for src_str in &req.sources {
        let src_entry = guard_entry(src_str, roots)?;
        let src_is_dir = fs::symlink_metadata(&src_entry)
            .map(|m| m.is_dir())
            .unwrap_or(false);
        if src_is_dir
            && (src_entry == dest_canonical || dest_canonical.starts_with(&src_entry))
        {
            return Err(AppError::Invalid(
                "Folder tidak bisa masuk ke dalam dirinya sendiri".into(),
            ));
        }
        sources.push((src_str.clone(), src_entry));
    }

    if req.on_conflict.is_none() {
        let mut conflicts = Vec::new();
        for (_src_str, src_entry) in &sources {
            if req.mode == PasteMode::Move
                && (*src_entry == roots.home || roots.devices.contains(src_entry))
            {
                continue;
            }
            if let Some(file_name) = src_entry.file_name() {
                let target_path = dest_canonical.join(file_name);
                if req.mode == PasteMode::Move && target_path == *src_entry {
                    continue;
                }
                if fs::symlink_metadata(&target_path).is_ok() {
                    conflicts.push(file_name.to_string_lossy().to_string());
                }
            }
        }
        if !conflicts.is_empty() {
            return Ok(OpReport {
                done: vec![],
                failed: vec![],
                conflicts,
            });
        }
    }

    let mut done = Vec::new();
    let mut failed = Vec::new();

    for (src_str, src_entry) in sources {
        if req.mode == PasteMode::Move
            && (src_entry == roots.home || roots.devices.contains(&src_entry))
        {
            failed.push(Failure {
                path: src_str,
                error: "Folder akar tidak bisa dipindah".into(),
            });
            continue;
        }

        let file_name = match src_entry.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => {
                failed.push(Failure {
                    path: src_str,
                    error: "Nama file tidak valid".into(),
                });
                continue;
            }
        };

        let target_path = dest_canonical.join(&file_name);
        let same_folder = src_entry == target_path;

        if same_folder {
            match req.mode {
                PasteMode::Move => {
                    done.push(target_path.to_string_lossy().to_string());
                }
                PasteMode::Copy => match req.on_conflict {
                    Some(OnConflict::Replace) | Some(OnConflict::Skip) => {
                        done.push(target_path.to_string_lossy().to_string());
                    }
                    Some(OnConflict::Rename) => {
                        let actual_target = unique_name(&dest_canonical, &file_name);
                        match copy_recursive(&src_entry, &actual_target, false) {
                            Ok(()) => done.push(actual_target.to_string_lossy().to_string()),
                            Err(e) => failed.push(Failure {
                                path: src_str,
                                error: e.to_string(),
                            }),
                        }
                    }
                    None => {}
                },
            }
            continue;
        }

        let target_exists = fs::symlink_metadata(&target_path).is_ok();
        if target_exists {
            match req.on_conflict {
                Some(OnConflict::Skip) => {}
                Some(OnConflict::Rename) => {
                    let actual_target = unique_name(&dest_canonical, &file_name);
                    execute_paste(
                        &src_str,
                        &src_entry,
                        &actual_target,
                        req.mode,
                        false,
                        &mut done,
                        &mut failed,
                    );
                }
                Some(OnConflict::Replace) => {
                    let src_is_dir = fs::symlink_metadata(&src_entry)
                        .map(|m| m.is_dir())
                        .unwrap_or(false);
                    let dst_is_dir = fs::symlink_metadata(&target_path)
                        .map(|m| m.is_dir())
                        .unwrap_or(false);
                    if src_is_dir != dst_is_dir {
                        failed.push(Failure {
                            path: src_str,
                            error: "Jenis file dan folder tidak cocok".into(),
                        });
                        continue;
                    }
                    execute_paste(
                        &src_str,
                        &src_entry,
                        &target_path,
                        req.mode,
                        true,
                        &mut done,
                        &mut failed,
                    );
                }
                None => {}
            }
        } else {
            execute_paste(
                &src_str,
                &src_entry,
                &target_path,
                req.mode,
                false,
                &mut done,
                &mut failed,
            );
        }
    }

    Ok(OpReport {
        done,
        failed,
        conflicts: vec![],
    })
}

pub fn trash(
    paths: &[String],
    roots: &Roots,
    run: impl Fn(&Path) -> io::Result<()>,
) -> Result<OpReport, AppError> {
    let mut done = Vec::new();
    let mut failed = Vec::new();

    for path_str in paths {
        let canonical = match guard_entry(path_str, roots) {
            Ok(p) => p,
            Err(e) => {
                failed.push(Failure {
                    path: path_str.clone(),
                    error: e.to_string(),
                });
                continue;
            }
        };

        if canonical == roots.home || roots.devices.contains(&canonical) {
            failed.push(Failure {
                path: path_str.clone(),
                error: "Folder akar tidak bisa dihapus".into(),
            });
            continue;
        }

        match run(&canonical) {
            Ok(()) => done.push(canonical.to_string_lossy().to_string()),
            Err(e) => failed.push(Failure {
                path: path_str.clone(),
                error: e.to_string(),
            }),
        }
    }

    Ok(OpReport {
        done,
        failed,
        conflicts: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::tempdir;

    #[test]
    fn xdg_dirs_come_from_user_dirs_or_defaults() {
        let home = tempdir().unwrap();
        let home_path = home.path();
        let data = tempdir().unwrap();
        let data_path = data.path();

        // 1. Defaults when user_dirs_text is None
        fs::create_dir(home_path.join("Documents")).unwrap();
        fs::create_dir(home_path.join("Downloads")).unwrap();
        fs::create_dir(home_path.join("Pictures")).unwrap();
        fs::create_dir(home_path.join("Videos")).unwrap();
        fs::create_dir(home_path.join("Music")).unwrap();

        let places = xdg_places(home_path, None, data_path);
        let names: Vec<&str> = places.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["Home", "Dokumen", "Unduhan", "Gambar", "Video", "Musik", "Data Anchoa"]
        );

        // 2. Custom parsing from user_dirs_text
        fs::create_dir(home_path.join("KoleksiDokumen")).unwrap();
        let user_dirs_content = r#"
# comment
XDG_DOCUMENTS_DIR="$HOME/KoleksiDokumen"
XDG_DOWNLOAD_DIR="$HOME/Downloads"
XDG_PICTURES_DIR="$HOME/Pictures"
XDG_VIDEOS_DIR="$HOME/Videos"
XDG_MUSIC_DIR="$HOME/NonExistentMusic"
"#;
        let places2 = xdg_places(home_path, Some(user_dirs_content), data_path);
        let names2: Vec<&str> = places2.iter().map(|p| p.name.as_str()).collect();
        // Music does not exist, so it should be skipped
        assert_eq!(
            names2,
            vec!["Home", "Dokumen", "Unduhan", "Gambar", "Video", "Data Anchoa"]
        );
        let dok = places2.iter().find(|p| p.name == "Dokumen").unwrap();
        assert_eq!(dok.path, home_path.join("KoleksiDokumen").to_string_lossy());
    }

    #[test]
    fn mounts_under_run_media_only() {
        let sample = r#"
/dev/sda1 / ext4 rw,relatime 0 0
/dev/sdb1 /home ext4 rw,relatime 0 0
/dev/sdc1 /run/media/syharipf/USB\040Drive vfat rw,nosuid 0 0
/dev/sdd1 /run/media/syharipf/Flashdisk ext4 rw,nosuid 0 0
/dev/sde1 /run/media/otheruser/Disk ntfs rw,nosuid 0 0
"#;
        let mounts = parse_mounts(sample, "syharipf");
        assert_eq!(mounts.len(), 2);
        assert_eq!(mounts[0].name, "USB Drive");
        assert_eq!(mounts[0].path, "/run/media/syharipf/USB Drive");
        assert_eq!(mounts[0].icon, "drive");
        assert_eq!(mounts[1].name, "Flashdisk");
        assert_eq!(mounts[1].path, "/run/media/syharipf/Flashdisk");
    }

    #[test]
    fn guard_rejects_paths_outside_the_roots() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        // Valid inside home
        let valid_file = home.path().join("file.txt");
        fs::write(&valid_file, "hello").unwrap();
        assert!(guard(valid_file.to_str().unwrap(), &roots).is_ok());

        // Non-existent
        let res_missing = guard(home.path().join("missing.txt").to_str().unwrap(), &roots);
        assert!(matches!(res_missing, Err(AppError::Invalid(msg)) if msg == "Berkas tidak ditemukan"));

        // Path outside root (parent navigation or outside directory)
        let outside_file = outside.path().join("secret.txt");
        fs::write(&outside_file, "secret").unwrap();
        let res_outside = guard(outside_file.to_str().unwrap(), &roots);
        assert!(matches!(res_outside, Err(AppError::Invalid(msg)) if msg == "Di luar folder yang diizinkan"));

        // Symlink pointing outside
        let symlink_path = home.path().join("symlink_out");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside_file, &symlink_path).unwrap();
            let res_symlink = guard(symlink_path.to_str().unwrap(), &roots);
            assert!(matches!(res_symlink, Err(AppError::Invalid(msg)) if msg == "Di luar folder yang diizinkan"));
        }
    }

    #[test]
    fn listing_sorts_folders_first_and_hides_dotfiles() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        fs::create_dir(home.path().join("folder_b")).unwrap();
        fs::create_dir(home.path().join("Folder_a")).unwrap();
        fs::create_dir(home.path().join(".hidden_folder")).unwrap();
        fs::write(home.path().join("file_z.txt"), "z").unwrap();
        fs::write(home.path().join("File_a.txt"), "a").unwrap();
        fs::write(home.path().join(".hidden_file"), "h").unwrap();

        // Without hidden
        let listing = list_dir(home.path().to_str().unwrap(), false, &roots).unwrap();
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Folder_a", "folder_b", "File_a.txt", "file_z.txt"]);

        // With hidden
        let listing_hidden = list_dir(home.path().to_str().unwrap(), true, &roots).unwrap();
        let names_hidden: Vec<&str> = listing_hidden.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names_hidden,
            vec![
                ".hidden_folder",
                "Folder_a",
                "folder_b",
                ".hidden_file",
                "File_a.txt",
                "file_z.txt"
            ]
        );
    }

    #[test]
    fn crumbs_walk_up_to_the_root() {
        let home = tempdir().unwrap();
        let sub = home.path().join("sub1").join("sub2");
        fs::create_dir_all(&sub).unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        let listing = list_dir(sub.to_str().unwrap(), false, &roots).unwrap();
        assert_eq!(listing.crumbs.len(), 3);
        assert_eq!(listing.crumbs[0].name, "Home");
        assert_eq!(listing.crumbs[0].path, roots.home.to_string_lossy());
        assert_eq!(listing.crumbs[1].name, "sub1");
        assert_eq!(listing.crumbs[2].name, "sub2");
        assert_eq!(
            listing.parent,
            Some(home.path().join("sub1").canonicalize().unwrap().to_string_lossy().to_string())
        );

        let root_listing = list_dir(home.path().to_str().unwrap(), false, &roots).unwrap();
        assert_eq!(root_listing.parent, None);
        assert_eq!(root_listing.crumbs.len(), 1);
        assert_eq!(root_listing.crumbs[0].name, "Home");
    }

    #[test]
    fn kind_by_extension() {
        let dir = tempdir().unwrap();
        assert_eq!(kind_of(dir.path()), FileKind::Folder);
        assert_eq!(kind_of(Path::new("photo.png")), FileKind::Image);
        assert_eq!(kind_of(Path::new("photo.JPG")), FileKind::Image);
        assert_eq!(kind_of(Path::new("clip.mp4")), FileKind::Video);
        assert_eq!(kind_of(Path::new("clip.mkv")), FileKind::Video);
        assert_eq!(kind_of(Path::new("doc.pdf")), FileKind::Pdf);
        assert_eq!(kind_of(Path::new("code.rs")), FileKind::Text);
        assert_eq!(kind_of(Path::new("data.json")), FileKind::Text);
        assert_eq!(kind_of(Path::new("binary.bin")), FileKind::Other);
    }

    #[test]
    fn copy_and_move_files_and_folders() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        let src_file = home.path().join("doc.txt");
        fs::write(&src_file, "hello").unwrap();
        let dest_dir = home.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();

        // 1. Copy file
        let copy_req = PasteRequest {
            sources: vec![src_file.to_str().unwrap().to_string()],
            dest: dest_dir.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: None,
        };
        let rep = paste(&copy_req, &roots).unwrap();
        assert_eq!(rep.done.len(), 1);
        assert!(src_file.exists());
        assert!(dest_dir.join("doc.txt").exists());

        // 2. Move file
        let src_file2 = home.path().join("doc2.txt");
        fs::write(&src_file2, "move me").unwrap();
        let move_req = PasteRequest {
            sources: vec![src_file2.to_str().unwrap().to_string()],
            dest: dest_dir.to_str().unwrap().to_string(),
            mode: PasteMode::Move,
            on_conflict: None,
        };
        let rep_move = paste(&move_req, &roots).unwrap();
        assert_eq!(rep_move.done.len(), 1);
        assert!(!src_file2.exists());
        assert!(dest_dir.join("doc2.txt").exists());

        // 3. Copy folder recursively
        let folder = home.path().join("src_folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("nested.txt"), "nested").unwrap();
        let copy_f_req = PasteRequest {
            sources: vec![folder.to_str().unwrap().to_string()],
            dest: dest_dir.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: None,
        };
        let rep_f = paste(&copy_f_req, &roots).unwrap();
        assert_eq!(rep_f.done.len(), 1);
        assert!(folder.exists());
        assert!(dest_dir.join("src_folder").join("nested.txt").exists());
    }

    #[test]
    fn conflicts_are_reported_before_anything_is_written() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let dest = home.path().join("dest");
        fs::create_dir(&dest).unwrap();

        fs::write(dest.join("catatan.txt"), "dest content").unwrap();
        let src = home.path().join("catatan.txt");
        fs::write(&src, "source content").unwrap();

        let req = PasteRequest {
            sources: vec![src.to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: None,
        };
        let rep = paste(&req, &roots).unwrap();
        assert_eq!(rep.conflicts, vec!["catatan.txt"]);
        assert!(rep.done.is_empty());
        assert_eq!(fs::read_to_string(dest.join("catatan.txt")).unwrap(), "dest content");
    }

    #[test]
    fn replace_skip_and_rename_resolve_conflicts() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let dest = home.path().join("dest");
        fs::create_dir(&dest).unwrap();

        // 1. Skip
        fs::write(dest.join("file.txt"), "original").unwrap();
        let src = home.path().join("file.txt");
        fs::write(&src, "replacement").unwrap();
        let skip_req = PasteRequest {
            sources: vec![src.to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: Some(OnConflict::Skip),
        };
        let rep_skip = paste(&skip_req, &roots).unwrap();
        assert!(rep_skip.done.is_empty());
        assert_eq!(fs::read_to_string(dest.join("file.txt")).unwrap(), "original");

        // 2. Replace
        let rep_req = PasteRequest {
            sources: vec![src.to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: Some(OnConflict::Replace),
        };
        let rep_rep = paste(&rep_req, &roots).unwrap();
        assert_eq!(rep_rep.done.len(), 1);
        assert_eq!(fs::read_to_string(dest.join("file.txt")).unwrap(), "replacement");

        // 3. Rename
        let ren_req = PasteRequest {
            sources: vec![src.to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: Some(OnConflict::Rename),
        };
        let rep_ren = paste(&ren_req, &roots).unwrap();
        assert_eq!(rep_ren.done.len(), 1);
        assert!(dest.join("file (2).txt").exists());

        // Rename again => file (3).txt
        let rep_ren2 = paste(&ren_req, &roots).unwrap();
        assert_eq!(rep_ren2.done.len(), 1);
        assert!(dest.join("file (3).txt").exists());
    }

    #[test]
    fn a_folder_cannot_go_inside_itself() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let folder = home.path().join("parent_folder");
        let sub = folder.join("child_folder");
        fs::create_dir_all(&sub).unwrap();

        // Folder into itself
        let req1 = PasteRequest {
            sources: vec![folder.to_str().unwrap().to_string()],
            dest: folder.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: None,
        };
        let err1 = paste(&req1, &roots).unwrap_err();
        assert!(matches!(err1, AppError::Invalid(msg) if msg == "Folder tidak bisa masuk ke dalam dirinya sendiri"));

        // Folder into child
        let req2 = PasteRequest {
            sources: vec![folder.to_str().unwrap().to_string()],
            dest: sub.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: None,
        };
        let err2 = paste(&req2, &roots).unwrap_err();
        assert!(matches!(err2, AppError::Invalid(msg) if msg == "Folder tidak bisa masuk ke dalam dirinya sendiri"));
    }

    #[test]
    fn read_text_truncates_at_64_kb() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        // Small text
        let small = home.path().join("small.txt");
        fs::write(&small, "hello world").unwrap();
        let res_small = read_text(small.to_str().unwrap(), &roots).unwrap();
        assert_eq!(res_small.text, "hello world");
        assert!(!res_small.truncated);

        // Large text > 64 KB
        let large = home.path().join("large.txt");
        let content = "a".repeat(70 * 1024);
        fs::write(&large, &content).unwrap();
        let res_large = read_text(large.to_str().unwrap(), &roots).unwrap();
        assert_eq!(res_large.text.len(), 64 * 1024);
        assert!(res_large.truncated);

        // Directory
        let dir = home.path().join("somedir");
        fs::create_dir(&dir).unwrap();
        let res_dir = read_text(dir.to_str().unwrap(), &roots);
        assert!(res_dir.is_err());
    }

    #[test]
    fn trash_uses_the_injected_runner() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let file = home.path().join("delete_me.txt");
        fs::write(&file, "bye").unwrap();

        let recorded = Mutex::new(Vec::new());
        let runner = |p: &Path| {
            recorded.lock().unwrap().push(p.to_path_buf());
            Ok(())
        };

        // Normal file
        let rep = trash(&[file.to_str().unwrap().to_string()], &roots, runner).unwrap();
        assert_eq!(rep.done.len(), 1);
        assert_eq!(recorded.lock().unwrap().len(), 1);

        // Refuse root
        let rep_root = trash(&[home.path().to_str().unwrap().to_string()], &roots, runner).unwrap();
        assert_eq!(rep_root.failed.len(), 1);
        assert_eq!(rep_root.failed[0].error, "Folder akar tidak bisa dihapus");
    }

    #[test]
    #[cfg(unix)]
    fn trashing_symlink_passes_link_path_not_target() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let target = home.path().join("target.txt");
        fs::write(&target, "content").unwrap();
        let link = home.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let recorded = Mutex::new(Vec::new());
        let runner = |p: &Path| {
            recorded.lock().unwrap().push(p.to_path_buf());
            Ok(())
        };

        let rep = trash(&[link.to_str().unwrap().to_string()], &roots, runner).unwrap();
        assert_eq!(rep.done, vec![link.to_string_lossy().to_string()]);
        let recorded = recorded.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0], link);
        assert_ne!(recorded[0], target);
        assert!(target.exists());
    }

    #[test]
    #[cfg(unix)]
    fn moving_symlink_moves_link_and_leaves_target() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let target = home.path().join("target.txt");
        fs::write(&target, "hello").unwrap();
        let link = home.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let dest = home.path().join("dest");
        fs::create_dir(&dest).unwrap();

        let req = PasteRequest {
            sources: vec![link.to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Move,
            on_conflict: None,
        };

        let rep = paste(&req, &roots).unwrap();
        let dest_link = dest.join("link.txt");
        assert_eq!(rep.done, vec![dest_link.to_string_lossy().to_string()]);
        assert!(!link.exists());
        assert!(fs::symlink_metadata(&dest_link).unwrap().file_type().is_symlink());
        assert!(target.exists());
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
    }

    #[test]
    #[cfg(unix)]
    fn symlink_inside_roots_pointing_outside_can_be_trashed() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        let outside_file = outside.path().join("outside.txt");
        fs::write(&outside_file, "secret").unwrap();
        let link = home.path().join("link_to_outside.txt");
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();

        let recorded = Mutex::new(Vec::new());
        let runner = |p: &Path| {
            recorded.lock().unwrap().push(p.to_path_buf());
            Ok(())
        };

        let rep = trash(&[link.to_str().unwrap().to_string()], &roots, runner).unwrap();
        assert_eq!(rep.done, vec![link.to_string_lossy().to_string()]);
        assert!(rep.failed.is_empty());
        let recorded = recorded.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0], link);
        assert!(outside_file.exists());
    }

    #[test]
    fn move_refuses_roots_but_copy_allows() {
        let home = tempdir().unwrap();
        let device = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![device.path().to_path_buf()]);

        let dest = device.path().join("backup");
        fs::create_dir(&dest).unwrap();

        // 1. Move home -> refused with "Folder akar tidak bisa dipindah"
        let move_home_req = PasteRequest {
            sources: vec![home.path().to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Move,
            on_conflict: None,
        };
        let rep_move_home = paste(&move_home_req, &roots).unwrap();
        assert_eq!(rep_move_home.failed.len(), 1);
        assert_eq!(rep_move_home.failed[0].path, home.path().to_str().unwrap());
        assert_eq!(rep_move_home.failed[0].error, "Folder akar tidak bisa dipindah");
        assert!(rep_move_home.done.is_empty());

        // 2. Move device root -> refused with "Folder akar tidak bisa dipindah"
        let home_dest = home.path().join("from_device");
        fs::create_dir(&home_dest).unwrap();
        let move_device_req = PasteRequest {
            sources: vec![device.path().to_str().unwrap().to_string()],
            dest: home_dest.to_str().unwrap().to_string(),
            mode: PasteMode::Move,
            on_conflict: None,
        };
        let rep_move_device = paste(&move_device_req, &roots).unwrap();
        assert_eq!(rep_move_device.failed.len(), 1);
        assert_eq!(rep_move_device.failed[0].path, device.path().to_str().unwrap());
        assert_eq!(rep_move_device.failed[0].error, "Folder akar tidak bisa dipindah");
        assert!(rep_move_device.done.is_empty());

        // 3. Copy home -> allowed
        let copy_home_req = PasteRequest {
            sources: vec![home.path().to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: None,
        };
        let rep_copy = paste(&copy_home_req, &roots).unwrap();
        assert_eq!(rep_copy.done.len(), 1);
        assert!(rep_copy.failed.is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn copy_folder_with_symlink_loop_finishes_and_recreates_link() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        let src_folder = home.path().join("loop_dir");
        fs::create_dir(&src_folder).unwrap();
        fs::write(src_folder.join("file.txt"), "data").unwrap();
        let loop_link = src_folder.join("parent_loop");
        std::os::unix::fs::symlink(&src_folder, &loop_link).unwrap();

        let dest = home.path().join("dest");
        fs::create_dir(&dest).unwrap();

        let req = PasteRequest {
            sources: vec![src_folder.to_str().unwrap().to_string()],
            dest: dest.to_str().unwrap().to_string(),
            mode: PasteMode::Copy,
            on_conflict: None,
        };

        let rep = paste(&req, &roots).unwrap();
        let copied_folder = dest.join("loop_dir");
        assert_eq!(rep.done, vec![copied_folder.to_string_lossy().to_string()]);
        let copied_link = copied_folder.join("parent_loop");
        assert!(fs::symlink_metadata(&copied_link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_link(&copied_link).unwrap(), src_folder);
    }

    #[test]
    fn guard_entry_validates_path_and_rejects_missing_or_dot() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);

        let file = home.path().join("test.txt");
        fs::write(&file, "abc").unwrap();
        assert_eq!(
            guard_entry(file.to_str().unwrap(), &roots).unwrap(),
            file.canonicalize().unwrap()
        );

        let missing = home.path().join("missing.txt");
        let res_missing = guard_entry(missing.to_str().unwrap(), &roots);
        assert!(matches!(res_missing, Err(AppError::Invalid(msg)) if msg == "Berkas tidak ditemukan"));

        assert!(matches!(guard_entry("", &roots), Err(AppError::Invalid(msg)) if msg == "Nama file tidak valid"));
        assert!(matches!(guard_entry(".", &roots), Err(AppError::Invalid(msg)) if msg == "Nama file tidak valid"));
        assert!(matches!(guard_entry("..", &roots), Err(AppError::Invalid(msg)) if msg == "Nama file tidak valid"));
        assert!(matches!(guard_entry(home.path().join(".").to_str().unwrap(), &roots), Err(AppError::Invalid(msg)) if msg == "Nama file tidak valid"));
        assert!(matches!(guard_entry(home.path().join("..").to_str().unwrap(), &roots), Err(AppError::Invalid(msg)) if msg == "Nama file tidak valid"));
    }

    #[test]
    fn decode_octal_handles_valid_and_out_of_range_escapes() {
        assert_eq!(decode_octal(r"\040"), " ");
        assert_eq!(decode_octal(r"\777"), r"\777");
    }

    #[test]
    #[cfg(unix)]
    fn read_text_rejects_fifo() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let fifo_path = home.path().join("test_fifo");

        let status = std::process::Command::new("mkfifo")
            .arg(&fifo_path)
            .status()
            .expect("mkfifo failed");
        assert!(status.success());

        let fifo_str = fifo_path.to_str().unwrap().to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let res = read_text(&fifo_str, &roots);
            let _ = tx.send(res);
        });

        match rx.recv_timeout(std::time::Duration::from_millis(300)) {
            Ok(Err(AppError::Invalid(msg))) => {
                assert_eq!(msg, "Hanya berkas biasa yang bisa dipratinjau");
            }
            Ok(other) => panic!("expected Invalid error, got {other:?}"),
            Err(_) => panic!("read_text blocked on FIFO instead of rejecting it immediately"),
        }
    }

    #[test]
    #[cfg(unix)]
    fn unique_name_treats_dangling_symlink_as_taken() {
        let dir = tempdir().unwrap();
        let dangling = dir.path().join("a (2).txt");
        std::os::unix::fs::symlink(dir.path().join("nonexistent.txt"), &dangling).unwrap();

        let name = unique_name(dir.path(), "a.txt");
        assert_eq!(name, dir.path().join("a (3).txt"));
    }

    #[test]
    #[cfg(unix)]
    fn copy_recursive_folder_symlink_destination_leaves_outside_folder_untouched() {
        let home = tempdir().unwrap();
        let outside = tempdir().unwrap();

        let outside_dir = outside.path().join("outside_folder");
        fs::create_dir(&outside_dir).unwrap();
        let outside_file = outside_dir.join("outside.txt");
        fs::write(&outside_file, "original").unwrap();

        let src_dir = home.path().join("src");
        let src_sub = src_dir.join("sub");
        fs::create_dir_all(&src_sub).unwrap();
        fs::write(src_sub.join("file.txt"), "new").unwrap();

        let dst_dir = home.path().join("dst");
        fs::create_dir(&dst_dir).unwrap();
        let dst_sub = dst_dir.join("sub");
        std::os::unix::fs::symlink(&outside_dir, &dst_sub).unwrap();

        copy_recursive(&src_sub, &dst_sub, true).unwrap();

        assert!(!outside_dir.join("file.txt").exists());
        assert_eq!(fs::read_to_string(&outside_file).unwrap(), "original");

        let meta = fs::symlink_metadata(&dst_sub).unwrap();
        assert!(meta.is_dir());
        assert!(!meta.file_type().is_symlink());
        assert!(dst_sub.join("file.txt").exists());
    }

    #[test]
    fn paste_move_into_own_folder_has_no_conflict() {
        let home = tempdir().unwrap();
        let roots = Roots::new(home.path().to_path_buf(), vec![]);
        let file = home.path().join("file.txt");
        fs::write(&file, "content").unwrap();

        let req = PasteRequest {
            sources: vec![file.to_str().unwrap().to_string()],
            dest: home.path().to_str().unwrap().to_string(),
            mode: PasteMode::Move,
            on_conflict: None,
        };

        let rep = paste(&req, &roots).unwrap();
        assert!(rep.conflicts.is_empty(), "conflicts should be empty, got {:?}", rep.conflicts);
        assert_eq!(rep.done, vec![file.to_str().unwrap().to_string()]);
        assert!(file.exists());
        assert_eq!(fs::read_to_string(&file).unwrap(), "content");
    }
}

