use mail_parser::{MessageParser, PartType};

use crate::error::AppError;

#[derive(Debug)]
pub struct PlainBody {
    pub text: String,
    pub has_html: bool,
}

pub fn parse(raw: &[u8]) -> Result<PlainBody, AppError> {
    let message = MessageParser::default()
        .parse(raw)
        .ok_or_else(|| AppError::Invalid("Isi email tidak dapat dibaca".into()))?;
    let has_html = message.html_body.iter().any(|id| {
        message
            .part(*id)
            .is_some_and(|p| matches!(p.body, PartType::Html(_)))
    });
    // Inspect the actual MIME type: body_text() also converts HTML automatically.
    let plain = message
        .text_body
        .iter()
        .find_map(|id| match &message.part(*id)?.body {
            PartType::Text(text) => Some(text.as_ref()),
            _ => None,
        });
    let text = if let Some(text) = plain {
        text.to_owned()
    } else {
        message
            .html_body
            .iter()
            .find_map(|id| match &message.part(*id)?.body {
                PartType::Html(html) => Some(html_to_text(html)),
                _ => None,
            })
            .unwrap_or_default()
    };
    Ok(PlainBody {
        text: text
            .chars()
            .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
            .collect(),
        has_html,
    })
}

fn decode_entities(input: &str) -> String {
    let mut out = String::new();
    let mut remaining = input;
    while let Some(start) = remaining.find('&') {
        out.push_str(&remaining[..start]);
        remaining = &remaining[start..];
        let entity = remaining
            .find(';')
            .filter(|end| *end <= 12)
            .and_then(|end| {
                let name = &remaining[1..end];
                let character = match name {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" | "#39" => Some('\''),
                    "nbsp" => Some(' '),
                    "eacute" => Some('é'),
                    "ndash" => Some('–'),
                    "mdash" => Some('—'),
                    "hellip" => Some('…'),
                    "copy" => Some('©'),
                    _ => name
                        .strip_prefix("#x")
                        .or_else(|| name.strip_prefix("#X"))
                        .and_then(|n| u32::from_str_radix(n, 16).ok())
                        .or_else(|| name.strip_prefix('#').and_then(|n| n.parse().ok()))
                        .and_then(char::from_u32),
                }?;
                Some((end, character))
            });
        if let Some((end, character)) = entity {
            out.push(character);
            remaining = &remaining[end + 1..];
        } else {
            out.push('&');
            remaining = &remaining[1..];
        }
    }
    out.push_str(remaining);
    out
}

fn attribute(tag: &str, target: &str) -> Option<String> {
    let mut rest = tag.trim_start_matches('/').trim_start();
    rest = &rest[rest.find(char::is_whitespace).unwrap_or(rest.len())..];
    while !rest.trim().is_empty() {
        rest = rest.trim_start();
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '=')
            .unwrap_or(rest.len());
        let name = &rest[..end];
        rest = rest[end..].trim_start();
        if !rest.starts_with('=') {
            if rest.is_empty() {
                break;
            }
            continue;
        }
        rest = rest[1..].trim_start();
        let (value, tail) = if rest.starts_with(['\'', '"']) {
            let quote = rest.chars().next()?;
            rest = &rest[1..];
            let end = rest.find(quote)?;
            (&rest[..end], &rest[end + 1..])
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            (&rest[..end], &rest[end..])
        };
        if name.eq_ignore_ascii_case(target) {
            return Some(decode_entities(value));
        }
        rest = tail;
    }
    None
}

pub fn html_to_text(html: &str) -> String {
    let mut output = String::new();
    let mut rest = html;
    let mut suppressed: Option<String> = None;
    let mut link: Option<String> = None;
    while let Some(start) = rest.find('<') {
        if suppressed.is_none() {
            output.push_str(&decode_entities(&rest[..start]));
        }
        rest = &rest[start..];
        if rest.starts_with("<!--") {
            if let Some(end) = rest.find("-->") {
                rest = &rest[end + 3..];
                continue;
            }
            rest = "";
            break;
        }
        let mut quote = None;
        let end = rest.char_indices().skip(1).find_map(|(i, c)| {
            if let Some(q) = quote {
                if c == q {
                    quote = None;
                }
            } else if matches!(c, '\'' | '"') {
                quote = Some(c);
            } else if c == '>' {
                return Some(i);
            }
            None
        });
        let Some(end) = end else {
            rest = "";
            break;
        };
        let tag = &rest[1..end];
        let closing = tag.trim_start().starts_with('/');
        let name = tag
            .trim_start()
            .trim_start_matches('/')
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if let Some(ignored) = &suppressed {
            if closing && &name == ignored {
                suppressed = None;
            }
        } else if !closing && matches!(name.as_str(), "script" | "style" | "head" | "template") {
            suppressed = Some(name);
        } else {
            if matches!(
                name.as_str(),
                "p" | "div" | "br" | "li" | "tr" | "h1" | "h2" | "h3" | "blockquote"
            ) {
                output.push('\n');
            }
            if name == "a" {
                if closing {
                    if let Some(url) = link.take() {
                        output.push_str(" (");
                        output.push_str(&url);
                        output.push(')');
                    }
                } else {
                    link = attribute(tag, "href")
                        .filter(|url| url.starts_with("https://") || url.starts_with("http://"));
                }
            }
        }
        rest = &rest[end + 1..];
    }
    if suppressed.is_none() {
        output.push_str(&decode_entities(rest));
    }
    output
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
