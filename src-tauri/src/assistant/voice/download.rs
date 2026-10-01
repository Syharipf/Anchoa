use crate::error::AppError;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

pub struct Download<'a> {
    pub url: &'a str,
    pub sha256: &'a str,
    pub dest: &'a Path,
}

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub done_bytes: u64,
    pub total_bytes: Option<u64>,
    pub verified: bool,
}

impl Download<'_> {
    pub fn run(&self, progress: impl FnMut(DownloadProgress)) -> Result<(), AppError> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(5)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .timeout_global(Some(Duration::from_secs(30 * 60)))
            .build()
            .into();
        let mut response = agent
            .get(self.url)
            .header("User-Agent", "Anchoa")
            .call()
            .map_err(|error| AppError::Other(format!("Gagal mengunduh model: {error}")))?;
        if response.status().as_u16() != 200 {
            return Err(AppError::Other(format!(
                "Status unduhan model tidak valid: {}",
                response.status()
            )));
        }
        let total = response
            .headers()
            .get("content-length")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok());
        self.store(response.body_mut().as_reader(), total, progress)
    }

    /// The HTTP body and test readers use exactly the same atomic writer.
    pub(super) fn store(
        &self,
        mut reader: impl Read,
        total: Option<u64>,
        mut progress: impl FnMut(DownloadProgress),
    ) -> Result<(), AppError> {
        if self.sha256.len() != 64 || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(AppError::Invalid("SHA-256 unduhan tidak valid".into()));
        }
        let parent = self
            .dest
            .parent()
            .ok_or_else(|| AppError::Invalid("Lokasi unduhan tidak valid".into()))?;
        fs::create_dir_all(parent)?;
        let part = part_path(self.dest);
        // Installs are serialized. Remove a crashed download's file (or link),
        // then create_new ensures a symlink is never opened for writing.
        match fs::remove_file(&part) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)?;
        let result = (|| {
            let mut hash = Sha256::new();
            let mut done = 0;
            let mut buffer = [0; 64 * 1024];
            progress(DownloadProgress {
                done_bytes: 0,
                total_bytes: total,
                verified: false,
            });
            loop {
                let count = match reader.read(&mut buffer) {
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    result => result?,
                };
                if count == 0 {
                    break;
                }
                file.write_all(&buffer[..count])?;
                hash.update(&buffer[..count]);
                done += count as u64;
                progress(DownloadProgress {
                    done_bytes: done,
                    total_bytes: total,
                    verified: false,
                });
            }
            if total.is_some_and(|expected| done != expected) {
                return Err(AppError::Other(
                    "Unduhan model terputus sebelum selesai".into(),
                ));
            }
            let actual = format!("{:x}", hash.finalize());
            if !actual.eq_ignore_ascii_case(self.sha256) {
                return Err(AppError::Other(
                    "SHA-256 model tidak cocok; unduhan dibuang".into(),
                ));
            }
            file.sync_all()?;
            fs::rename(&part, self.dest)?;
            progress(DownloadProgress {
                done_bytes: done,
                total_bytes: total,
                verified: true,
            });
            Ok(())
        })();
        drop(file);
        if result.is_err() {
            let _ = fs::remove_file(&part);
        }
        result
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
}
