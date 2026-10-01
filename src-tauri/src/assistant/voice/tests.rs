use super::{
    catalog::import_voice,
    settings::VoiceParams,
    speak::{Programs, speak, split_sentences},
};
use super::{
    download::Download,
    process::{Recorder, find_whisper, transcribe},
};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !path.is_file() {
        assert!(
            Instant::now() < deadline,
            "Missing fixture file: {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn record_uses_pipewire_arguments_and_stops_with_sigint() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(
        dir.path(),
        "pw-record",
        "trap 'printf stopped > \"$0.stopped\"; exit 0' INT\nprintf '%s\\n' \"$@\" > \"$0.args\"\nfor wav do :; done\nprintf RIFF > \"$wav\"\nprintf ready > \"$0.ready\"\nwhile :; do sleep 0.02; done",
    );
    let mut recorder = Recorder::start(
        &binary,
        dir.path(),
        Duration::from_secs(60),
        Duration::from_secs(2),
    )
    .unwrap();
    wait_file(&dir.path().join("pw-record.ready"));
    let wav = recorder.wav().to_path_buf();
    assert_eq!(
        fs::read_to_string(dir.path().join("pw-record.args")).unwrap(),
        format!(
            "--rate\n16000\n--channels\n1\n--format\ns16\n{}\n",
            wav.display()
        )
    );
    recorder.stop().unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("pw-record.stopped")).unwrap(),
        "stopped"
    );
    assert!(wav.is_file());
    drop(recorder);
    assert!(!wav.exists());
}

#[test]
fn transcribe_uses_whisper_arguments_and_trims_text() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(
        dir.path(),
        "whisper-cli",
        "printf '%s\\n' \"$@\" > \"$0.args\"\nprintf '  Halo teri.  \\n'\nprintf log >&2",
    );
    let model = dir.path().join("base.bin");
    let wav = dir.path().join("input.wav");
    fs::write(&model, b"model").unwrap();
    fs::write(&wav, b"RIFF").unwrap();
    assert_eq!(transcribe(&binary, &model, &wav).unwrap(), "Halo teri.");
    assert_eq!(
        fs::read_to_string(dir.path().join("whisper-cli.args")).unwrap(),
        format!(
            "-m\n{}\n-l\nid\n-nt\n-f\n{}\n",
            model.display(),
            wav.display()
        )
    );
}

#[test]
fn find_whisper_returns_none_when_missing_and_prefers_cli() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(find_whisper(dir.path().as_os_str()), None);
    let fallback = script(dir.path(), "whisper-cpp", "exit 0");
    assert_eq!(find_whisper(dir.path().as_os_str()), Some(fallback));
    let cli = script(dir.path(), "whisper-cli", "exit 0");
    assert_eq!(find_whisper(dir.path().as_os_str()), Some(cli));
}

fn download_server(body: &'static [u8]) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/model", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "No download request");
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .unwrap();
        stream.write_all(body).unwrap();
    });
    (url, handle)
}

#[test]
fn wrong_hash_deletes_part_and_errors() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("model.bin");
    fs::write(&dest, b"previous verified model").unwrap();
    let (url, server) = download_server(b"corrupt");
    let error = Download {
        url: &url,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        dest: &dest,
    }
    .run(|_| {})
    .unwrap_err();
    assert!(error.to_string().contains("SHA-256"));
    assert!(!dir.path().join("model.bin.part").exists());
    assert_eq!(fs::read(dest).unwrap(), b"previous verified model");
    server.join().unwrap();
}

#[test]
fn matching_hash_renames_part_and_reports_progress() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("models/model.bin");
    let (url, server) = download_server(b"abc");
    let mut events = Vec::new();
    Download {
        url: &url,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        dest: &dest,
    }
    .run(|event| events.push(event))
    .unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"abc");
    assert!(!dest.with_file_name("model.bin.part").exists());
    let last = events.last().unwrap();
    assert!(last.verified);
    assert_eq!(last.done_bytes, 3);
    assert_eq!(last.total_bytes, Some(3));
    server.join().unwrap();
}

#[test]
fn hash_writer_rejects_corruption_and_truncated_bodies_without_sockets() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("model.onnx");
    fs::write(&dest, b"previous").unwrap();
    let download = Download {
        url: "unused",
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        dest: &dest,
    };
    assert!(
        download
            .store(&b"corrupt"[..], None, |_| {})
            .unwrap_err()
            .to_string()
            .contains("SHA-256")
    );
    assert!(!dir.path().join("model.onnx.part").exists());
    assert_eq!(fs::read(&dest).unwrap(), b"previous");
    assert!(download.store(&b"abc"[..], Some(10), |_| {}).is_err());
    assert!(!dir.path().join("model.onnx.part").exists());
    let mut events = Vec::new();
    download
        .store(&b"abc"[..], Some(3), |event| events.push(event))
        .unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"abc");
    assert!(events.last().unwrap().verified);
}

#[test]
fn recording_time_limit_interrupts_and_kills_an_unresponsive_recorder() {
    let dir = tempfile::tempdir().unwrap();
    let binary = script(
        dir.path(),
        "pw-record",
        "trap '' INT\nfor wav do :; done\nprintf RIFF > \"$wav\"\nwhile :; do sleep 0.02; done",
    );
    let mut recorder = Recorder::start(
        &binary,
        dir.path(),
        Duration::from_millis(80),
        Duration::from_millis(80),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while recorder.is_recording() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    recorder.stop().unwrap();
}

#[test]
fn splits_sentences_with_abbreviations_and_decimals() {
    assert_eq!(
        split_sentences("  Halo. Apa kabar? Baik! Harga 3.14 rupiah, dll. tersedia.\nSelesai  "),
        [
            "Halo.",
            "Apa kabar?",
            "Baik!",
            "Harga 3.14 rupiah, dll. tersedia.",
            "Selesai"
        ]
    );
    assert_eq!(
        split_sentences("Dr. Amy berkata, \"Halo!\" Lalu pergi... Oke?!"),
        ["Dr. Amy berkata, \"Halo!\"", "Lalu pergi...", "Oke?!"]
    );
    assert!(split_sentences("  \n").is_empty());
}

fn fake_speech(dir: &Path) -> Programs {
    let piper = script(
        dir,
        "piper",
        "IFS= read -r text\nprintf '%s\\n' \"$@\" >> \"$0.args\"\nprintf 'synth:%s\\n' \"$text\" >> \"$(dirname \"$0\")/events\"\nwhile [ \"$#\" -gt 0 ]; do\n if [ \"$1\" = --output_file ]; then shift; printf RIFF > \"$1\"; fi\n shift\ndone",
    );
    let pw_play = script(
        dir,
        "pw-play",
        "printf '%s\\n' \"$@\" >> \"$0.args\"\nprintf 'play\\n' >> \"$(dirname \"$0\")/events\"\nif [ -f \"$0.block\" ]; then\n printf started > \"$0.started\"\n sleep 30\nfi",
    );
    Programs { piper, pw_play }
}

#[test]
fn piper_arguments_and_parameter_clamping() {
    let dir = tempfile::tempdir().unwrap();
    let programs = fake_speech(dir.path());
    let model = dir.path().join("model.onnx");
    fs::write(&model, b"model").unwrap();
    let params = VoiceParams {
        length_scale: 99.0,
        noise_scale: -1.0,
        noise_w: 5.0,
    };
    assert_eq!(
        params.clamped().unwrap(),
        VoiceParams {
            length_scale: 1.3,
            noise_scale: 0.3,
            noise_w: 1.0
        }
    );
    assert_eq!(
        VoiceParams::default(),
        VoiceParams {
            length_scale: 1.0,
            noise_scale: 0.667,
            noise_w: 0.8
        }
    );
    speak(
        "Halo.",
        &model,
        params,
        &programs,
        dir.path(),
        &std::sync::atomic::AtomicBool::new(false),
    )
    .unwrap();
    let args = fs::read_to_string(dir.path().join("piper.args")).unwrap();
    assert!(args.starts_with(&format!(
        "--model\n{}\n--length_scale\n1.3\n--noise_scale\n0.3\n--noise_w\n1\n--output_file\n",
        model.display()
    )));
    assert!(
        fs::read_to_string(dir.path().join("pw-play.args"))
            .unwrap()
            .contains("sentence.wav")
    );
}

#[test]
fn import_rejects_missing_or_invalid_json() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let onnx = dir.path().join("Natural voice.onnx");
    let json = dir.path().join("Natural voice.onnx.json");
    fs::write(&onnx, b"dummy model").unwrap();
    assert!(import_voice(&data, &onnx).is_err());
    for invalid in [
        "{",
        "{}",
        "{\"audio\":{}}",
        "{\"audio\":{\"sample_rate\":0}}",
        "{\"audio\":{\"sample_rate\":\"22050\"}}",
    ] {
        fs::write(&json, invalid).unwrap();
        assert!(import_voice(&data, &onnx).is_err());
    }
    fs::write(&json, "{\"audio\":{\"sample_rate\":22050}}").unwrap();
    let id = import_voice(&data, &onnx).unwrap();
    assert!(id.starts_with("custom-"));
    assert_eq!(
        fs::read(
            data.join("piper/voices/custom")
                .join(&id)
                .join("voice.onnx")
        )
        .unwrap(),
        b"dummy model"
    );
    assert!(onnx.is_file() && json.is_file());
}

#[test]
fn speak_calls_fake_binaries_sequentially_and_stops() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let dir = tempfile::tempdir().unwrap();
    let programs = fake_speech(dir.path());
    let model = dir.path().join("model.onnx");
    fs::write(&model, b"model").unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    speak(
        "Satu. Dua?",
        &model,
        VoiceParams::default(),
        &programs,
        dir.path(),
        &cancel,
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("events")).unwrap(),
        "synth:Satu.\nplay\nsynth:Dua?\nplay\n"
    );
    fs::write(dir.path().join("events"), "").unwrap();
    fs::write(dir.path().join("pw-play.block"), "").unwrap();
    let root = dir.path().to_path_buf();
    let cancelled = cancel.clone();
    let worker = thread::spawn(move || {
        speak(
            "Pertama. Kedua.",
            &model,
            VoiceParams::default(),
            &programs,
            &root,
            &cancelled,
        )
    });
    wait_file(&dir.path().join("pw-play.started"));
    let stopped = Instant::now();
    cancel.store(true, Ordering::SeqCst);
    worker.join().unwrap().unwrap();
    assert!(stopped.elapsed() < Duration::from_secs(2));
    assert_eq!(
        fs::read_to_string(dir.path().join("events")).unwrap(),
        "synth:Pertama.\nplay\n"
    );
}

#[test]
fn voice_settings_persist_clamped_controls_per_voice_and_serialize_for_the_api() {
    use super::settings;
    let conn = crate::db::open_in_memory();
    assert_eq!(settings::get(&conn).unwrap().id, "id_ID-news_tts-medium");
    let first = settings::set(
        &conn,
        "id_ID-news_tts-medium",
        VoiceParams {
            length_scale: 0.1,
            noise_scale: 5.0,
            noise_w: 0.1,
        },
    )
    .unwrap();
    assert_eq!(
        first.params,
        VoiceParams {
            length_scale: 0.8,
            noise_scale: 0.9,
            noise_w: 0.5
        }
    );
    let second = settings::set(&conn, "en_US-amy-medium", VoiceParams::default()).unwrap();
    assert_eq!(settings::get(&conn).unwrap(), second);
    assert_eq!(settings::for_voice(&conn, &first.id).unwrap(), first.params);
    let json = serde_json::to_value(first).unwrap();
    assert_eq!(
        json["params"],
        serde_json::json!({"lengthScale":0.8,"noiseScale":0.9,"noiseW":0.5})
    );
    assert!(
        settings::set(
            &conn,
            "en_US-amy-medium",
            VoiceParams {
                noise_w: f64::NAN,
                ..VoiceParams::default()
            }
        )
        .is_err()
    );
    assert_eq!(settings::get(&conn).unwrap(), second);
}

#[test]
fn voice_status_and_catalog_work_without_installed_binaries_and_show_imports() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    let state = super::VoiceState::with_path(
        data.clone(),
        dir.path().join("missing-bin").into_os_string(),
    );
    let db = crate::db::Db::open_at(dir.path().join("db.sqlite"));
    let status = state.status(&db).unwrap();
    assert!(!status.pw_record && !status.pw_play && !status.whisper_model && !status.piper);
    assert!(status.whisper.is_none());
    assert_eq!(status.voices.len(), 4);
    assert!(
        status
            .voices
            .iter()
            .all(|voice| !voice.installed && !voice.imported)
    );
    assert!(
        state
            .record_start()
            .unwrap_err()
            .to_string()
            .contains("pw-record")
    );
    assert!(state.record_stop().is_err());
    let onnx = dir.path().join("My Voice.onnx");
    fs::write(&onnx, "dummy").unwrap();
    fs::write(
        super::catalog::config_path(&onnx),
        r#"{"audio":{"sample_rate":22050}}"#,
    )
    .unwrap();
    let id = import_voice(&data, &onnx).unwrap();
    let voice = state
        .voices(&db)
        .unwrap()
        .into_iter()
        .find(|voice| voice.id == id)
        .unwrap();
    assert_eq!(voice.label, "My Voice");
    assert!(voice.imported && voice.installed);
    assert!(state.validate_id(&id).is_ok());
    assert!(state.validate_id("../../outside").is_err());
    assert!(state.validate_id("custom-../../outside").is_err());
    assert!(state.install("voice:../../outside", |_| {}).is_err());
    assert!(state.install("unknown", |_| {}).is_err());
}

#[test]
fn voice_state_stop_cancels_the_reserved_run_and_error_releases_it() {
    use super::{VoiceSettings, VoiceState};
    use std::sync::atomic::Ordering;
    let dir = tempfile::tempdir().unwrap();
    let state = VoiceState::with_path(dir.path().to_path_buf(), dir.path().as_os_str().to_owned());
    let run = state.begin_speech().unwrap();
    assert!(state.begin_speech().is_err());
    state.stop().unwrap();
    assert!(run.cancel.load(Ordering::SeqCst));
    drop(run);
    let run = state.begin_speech().unwrap();
    assert!(
        state
            .speak(
                "Halo.",
                VoiceSettings {
                    id: "id_ID-news_tts-medium".into(),
                    params: VoiceParams::default()
                },
                run
            )
            .is_err()
    );
    assert!(state.begin_speech().is_ok());
}

#[test]
fn import_rejects_oversized_models_and_non_model_paths() {
    let dir = tempfile::tempdir().unwrap();
    let onnx = dir.path().join("oversize.onnx");
    fs::File::create(&onnx)
        .unwrap()
        .set_len(super::catalog::MAX_VOICE_BYTES)
        .unwrap();
    fs::write(
        super::catalog::config_path(&onnx),
        r#"{"audio":{"sample_rate":22050}}"#,
    )
    .unwrap();
    assert!(import_voice(dir.path(), &onnx).is_err());
    assert!(!dir.path().join("piper/voices/custom").exists());
    assert!(import_voice(dir.path(), dir.path()).is_err());
}

#[test]
fn piper_install_keeps_libraries_and_rolls_back_failed_extraction() {
    let dir = tempfile::tempdir().unwrap();
    let tar = script(
        dir.path(),
        "tar",
        "printf '%s\\n' \"$@\" > \"$0.args\"\nshift 3\nroot=\"$1\"\nmkdir -p \"$root/piper/espeak-ng-data\"\nprintf '#!/bin/sh\\nexit 0\\n' > \"$root/piper/piper\"\nchmod +x \"$root/piper/piper\"\nprintf library > \"$root/piper/libonnxruntime.so\"\nprintf library > \"$root/piper/libpiper_phonemize.so\"\nprintf library > \"$root/piper/libespeak-ng.so\"\nprintf data > \"$root/piper/espeak-ng-data/data\"",
    );
    let data = dir.path().join("data");
    let archive = dir.path().join("verified.tar.gz");
    super::install::extract_piper(&data, &archive, &tar).unwrap();
    for file in [
        "piper",
        "libonnxruntime.so",
        "libpiper_phonemize.so",
        "libespeak-ng.so",
        "espeak-ng-data/data",
    ] {
        assert!(data.join("piper/bin").join(file).is_file());
    }
    assert!(
        fs::read_to_string(dir.path().join("tar.args"))
            .unwrap()
            .starts_with(&format!("-xzf\n{}\n-C\n", archive.display()))
    );
    let failed = script(dir.path(), "tar-failed", "exit 1");
    assert!(super::install::extract_piper(&data, &archive, &failed).is_err());
    assert_eq!(
        fs::read(data.join("piper/bin/libonnxruntime.so")).unwrap(),
        b"library"
    );
    assert_eq!(fs::read_dir(data.join("piper")).unwrap().count(), 1);
}

#[test]
fn download_constants_match_the_plan() {
    use super::catalog;
    let plan =
        include_str!("../../../../docs/superpowers/plans/2026-10-01-anchoa-fase5-asisten.md");
    let section = plan.split("## Konstanta unduhan").nth(1).unwrap();
    for (url, hash) in [
        (catalog::WHISPER_URL, catalog::WHISPER_SHA256),
        (catalog::PIPER_URL, catalog::PIPER_SHA256),
    ] {
        assert!(section.contains(url) && section.contains(hash));
        assert_eq!(hash.len(), 64);
    }
    for voice in catalog::VOICES {
        assert!(
            section.contains(voice.url_onnx)
                && section.contains(voice.sha_onnx)
                && section.contains(voice.sha_json)
        );
        assert_eq!(voice.url_json, format!("{}.json", voice.url_onnx));
    }
}

#[test]
fn speak_normalizes_line_breaks_into_one_piper_utterance_per_sentence() {
    let dir = tempfile::tempdir().unwrap();
    let programs = fake_speech(dir.path());
    let model = dir.path().join("model.onnx");
    fs::write(&model, b"model").unwrap();
    speak(
        "Halo\nsemua.\n\nSelamat\tpagi!",
        &model,
        VoiceParams::default(),
        &programs,
        dir.path(),
        &std::sync::atomic::AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("events")).unwrap(),
        "synth:Halo semua.\nplay\nsynth:Selamat pagi!\nplay\n"
    );
}

#[test]
fn download_writer_replaces_stale_parts_without_following_symlinks() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("model.bin");
    let other = dir.path().join("other.bin");
    let part = dir.path().join("model.bin.part");
    fs::write(&other, b"leave untouched").unwrap();
    symlink(&other, &part).unwrap();
    Download {
        url: "unused",
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        dest: &dest,
    }
    .store(&b"abc"[..], Some(3), |_| {})
    .unwrap();
    assert_eq!(fs::read(dest).unwrap(), b"abc");
    assert_eq!(fs::read(other).unwrap(), b"leave untouched");
    assert!(!part.exists());
}

#[test]
fn cancelling_synthesis_unblocks_stdin_and_removes_scratch_files() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let dir = tempfile::tempdir().unwrap();
    let mut programs = fake_speech(dir.path());
    programs.piper = script(
        dir.path(),
        "piper-blocked",
        "printf ready > \"$0.ready\"\nsleep 30",
    );
    let model = dir.path().join("model.onnx");
    fs::write(&model, b"model").unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let cancelled = cancel.clone();
    let root = dir.path().join("scratch");
    let scratch = root.clone();
    let worker = thread::spawn(move || {
        speak(
            &"a".repeat(256 * 1024),
            &model,
            VoiceParams::default(),
            &programs,
            &root,
            &cancelled,
        )
    });
    wait_file(&dir.path().join("piper-blocked.ready"));
    let stopped = Instant::now();
    cancel.store(true, Ordering::SeqCst);
    worker.join().unwrap().unwrap();
    assert!(stopped.elapsed() < Duration::from_secs(2));
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 0);
    assert!(!dir.path().join("pw-play.args").exists());
}

#[test]
fn synthesis_errors_stop_playback_and_report_stderr() {
    let dir = tempfile::tempdir().unwrap();
    let mut programs = fake_speech(dir.path());
    programs.piper = script(
        dir.path(),
        "piper-failed",
        "printf 'model rusak' >&2\nexit 1",
    );
    let model = dir.path().join("model.onnx");
    fs::write(&model, b"model").unwrap();
    let scratch = dir.path().join("scratch");
    let error = speak(
        "Satu. Dua.",
        &model,
        VoiceParams::default(),
        &programs,
        &scratch,
        &std::sync::atomic::AtomicBool::new(false),
    )
    .unwrap_err();
    assert!(error.to_string().contains("model rusak"));
    assert!(!dir.path().join("pw-play.args").exists());
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 0);
}
