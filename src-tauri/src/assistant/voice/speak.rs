use super::process::{self, ProcessControl};
use super::settings::VoiceParams;
use crate::error::AppError;
use std::{
    path::{Path, PathBuf},
    process::Command,
};

pub struct Programs {
    pub piper: PathBuf,
    pub pw_play: PathBuf,
}

pub fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut cursor = 0;
    while cursor < chars.len() {
        let (offset, ch) = chars[cursor];
        if !matches!(ch, '.' | '?' | '!') {
            cursor += 1;
            continue;
        }
        if ch == '.' {
            let decimal = cursor > 0
                && chars[cursor - 1].1.is_ascii_digit()
                && chars
                    .get(cursor + 1)
                    .is_some_and(|(_, ch)| ch.is_ascii_digit());
            let token = text[start..offset]
                .split_whitespace()
                .next_back()
                .unwrap_or("")
                .trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '.')
                .to_lowercase();
            let abbreviation = [
                "dll", "dsb", "dst", "dr", "drs", "prof", "mr", "mrs", "ms", "no", "jl", "s.d",
                "e.g", "i.e",
            ]
            .contains(&token.as_str());
            let within_word = chars
                .get(cursor + 1)
                .is_some_and(|(_, ch)| ch.is_alphanumeric());
            if decimal || abbreviation || within_word {
                cursor += 1;
                continue;
            }
        }
        let mut end = cursor + 1;
        while end < chars.len()
            && matches!(
                chars[end].1,
                '.' | '?' | '!' | '"' | '\'' | '”' | '’' | ')' | ']'
            )
        {
            end += 1;
        }
        let boundary = chars.get(end).map_or(text.len(), |(offset, _)| *offset);
        let sentence = text[start..boundary].trim();
        if !sentence.is_empty() {
            sentences.push(sentence.into());
        }
        start = boundary;
        cursor = end;
    }
    let rest = text[start..].trim();
    if !rest.is_empty() {
        sentences.push(rest.into());
    }
    sentences
}

pub fn speak(
    text: &str,
    model: &Path,
    params: VoiceParams,
    programs: &Programs,
    root: &Path,
    control: &ProcessControl,
) -> Result<(), AppError> {
    let params = params.clamped()?;
    let sentences = split_sentences(text);
    if sentences.is_empty() {
        return Err(AppError::Empty);
    }
    if control.is_cancelled() {
        return Ok(());
    }
    let scratch = control.scratch(root)?;
    let wav = scratch.0.join("sentence.wav");
    let log = scratch.0.join("process.log");
    for sentence in sentences {
        if control.is_cancelled() {
            break;
        }
        let mut synth = Command::new(&programs.piper);
        // Piper treats each stdin line as a separate utterance and can
        // overwrite --output_file. Send exactly one line for this sentence.
        let sentence = sentence.split_whitespace().collect::<Vec<_>>().join(" ");
        synth
            .arg("--model")
            .arg(model)
            .args([
                "--length_scale",
                &params.length_scale.to_string(),
                "--noise_scale",
                &params.noise_scale.to_string(),
                "--noise_w",
                &params.noise_w.to_string(),
                "--output_file",
            ])
            .arg(&wav);
        if !process::run(synth, Some(format!("{sentence}\n")), control, &log)? {
            break;
        }
        let mut play = Command::new(&programs.pw_play);
        play.arg(&wav);
        if !process::run(play, None, control, &log)? {
            break;
        }
        std::fs::remove_file(&wav)?;
    }
    Ok(())
}
