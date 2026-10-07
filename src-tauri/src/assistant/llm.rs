use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;
use ureq::unversioned::transport::{
    Buffers, ConnectionDetails, Connector, DefaultConnector, NextTimeout, Transport,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const MAX_EVENT_BYTES: usize = 1024 * 1024;

impl Default for Endpoint {
    fn default() -> Self {
        Self {
            base_url: std::env::var("ANCHOA_AI_BASE")
                .unwrap_or_else(|_| "http://127.0.0.1:11434/v1".into()),
            api_key: None,
        }
    }
}

#[derive(Clone)]
pub struct Endpoint {
    pub base_url: String,
    pub api_key: Option<String>,
}

impl Endpoint {
    fn clear_key(&mut self) {
        use zeroize::Zeroize;
        if let Some(key) = &mut self.api_key { key.zeroize(); }
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        self.clear_key();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolFunction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl ChatMessage {
    pub fn text(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            tool_calls: vec![],
            tool_call_id: None,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<Value>,
}

pub fn stream_chat(
    cfg: &Endpoint,
    req: &ChatRequest,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str),
) -> Result<ChatMessage, AppError> {
    stream_with_timeout(cfg, req, cancel, on_delta, IDLE_TIMEOUT)
}

fn stopped() -> AppError {
    AppError::Other("Permintaan asisten dihentikan".into())
}

fn idle_error() -> AppError {
    AppError::Other("Model tidak mengirim token selama batas waktu tunggu".into())
}

fn http_error(error: ureq::Error, base: &str) -> AppError {
    let message = match error {
        ureq::Error::StatusCode(401 | 403) => "Autentikasi penyedia AI gagal; periksa API key".into(),
        ureq::Error::StatusCode(429) => "Quota atau batas permintaan penyedia AI tercapai".into(),
        ureq::Error::StatusCode(400 | 422) => "Penyedia AI menolak format permintaan; pastikan model mendukung tools".into(),
        ureq::Error::StatusCode(status) => format!("Penyedia AI menolak permintaan (HTTP {status})"),
        ureq::Error::Timeout(_) => "Waktu tunggu penyedia AI habis".into(),
        ureq::Error::Io(ref e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
            let _ = base;
            "Ollama belum berjalan atau penyedia Kustom tidak dapat dihubungi".into()
        }
        _ => "Tidak dapat menghubungi penyedia AI; periksa alamat dan koneksinya".into(),
    };
    AppError::Other(message)
}

/// Poll the underlying transport so cancellation also closes a silent stream.
/// ureq's recv_body timeout is a *total* budget, so it cannot implement token
/// inactivity: the consumer below keeps that deadline instead.
#[derive(Debug)]
struct InterruptibleConnector(Arc<AtomicBool>);

#[derive(Debug)]
struct InterruptibleTransport<T> {
    inner: T,
    abort: Arc<AtomicBool>,
}

impl<T: Transport> Connector<T> for InterruptibleConnector {
    type Out = InterruptibleTransport<T>;

    fn connect(
        &self,
        _: &ConnectionDetails<'_>,
        chained: Option<T>,
    ) -> Result<Option<Self::Out>, ureq::Error> {
        Ok(chained.map(|inner| InterruptibleTransport {
            inner,
            abort: self.0.clone(),
        }))
    }
}

impl<T: Transport> Transport for InterruptibleTransport<T> {
    fn buffers(&mut self) -> &mut dyn Buffers {
        self.inner.buffers()
    }
    fn transmit_output(&mut self, amount: usize, timeout: NextTimeout) -> Result<(), ureq::Error> {
        self.inner.transmit_output(amount, timeout)
    }
    fn await_input(&mut self, timeout: NextTimeout) -> Result<bool, ureq::Error> {
        let started = Instant::now();
        loop {
            if self.abort.load(Ordering::Relaxed) {
                return Err(std::io::Error::new(
                    // BufRead retries Interrupted, which would spin forever.
                    std::io::ErrorKind::ConnectionAborted,
                    "Asisten dihentikan",
                )
                .into());
            }
            let remaining = timeout
                .not_zero()
                .map(|duration| (*duration).saturating_sub(started.elapsed()));
            if remaining == Some(Duration::ZERO) {
                return Err(ureq::Error::Timeout(timeout.reason));
            }
            let slice = NextTimeout {
                after: remaining.unwrap_or(POLL_INTERVAL).min(POLL_INTERVAL).into(),
                reason: timeout.reason,
            };
            match self.inner.await_input(slice) {
                Err(ureq::Error::Timeout(_)) => continue,
                result => return result,
            }
        }
    }
    fn is_open(&mut self) -> bool {
        !self.abort.load(Ordering::Relaxed) && self.inner.is_open()
    }
    fn is_tls(&self) -> bool {
        self.inner.is_tls()
    }
}

struct AbortOnDrop(Arc<AtomicBool>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

fn agent(abort: Arc<AtomicBool>, idle: Duration) -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .timeout_resolve(Some(CONNECT_TIMEOUT))
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_send_request(Some(CONNECT_TIMEOUT))
        .timeout_send_body(Some(CONNECT_TIMEOUT))
        .timeout_recv_response(Some(idle))
        .build();
    ureq::Agent::with_parts(
        config,
        DefaultConnector::default().chain(InterruptibleConnector(abort)),
        ureq::unversioned::resolver::DefaultResolver::default(),
    )
}

fn stream_with_timeout(
    cfg: &Endpoint,
    req: &ChatRequest,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str),
    idle: Duration,
) -> Result<ChatMessage, AppError> {
    if cancel.load(Ordering::Relaxed) {
        return Err(stopped());
    }
    let cfg = cfg.clone();
    let req = req.clone();
    let abort = Arc::new(AtomicBool::new(false));
    let _abort_on_drop = AbortOnDrop(abort.clone());
    let (tx, rx) = mpsc::sync_channel(8);
    std::thread::Builder::new()
        .name("assistant-http".into())
        .spawn(move || {
            let result = receive_stream(&cfg, &req, abort, idle, |data| {
                tx.send(Ok(Some(data))).map_err(|_| stopped())
            });
            let _ = tx.send(result.map(|()| None));
        })?;

    let mut content = String::new();
    let mut calls = BTreeMap::new();
    let mut last_token = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(stopped());
        }
        let remaining = idle.saturating_sub(last_token.elapsed());
        if remaining.is_zero() {
            return Err(idle_error());
        }
        match rx.recv_timeout(remaining.min(POLL_INTERVAL)) {
            Ok(Ok(Some(chunk))) => {
                if assemble_delta(&chunk, &mut content, &mut calls, &mut on_delta)? {
                    last_token = Instant::now();
                }
            }
            Ok(Ok(None)) => {
                for call in calls.values() {
                    if call.id.is_empty()
                        || call.kind != "function"
                        || call.function.name.is_empty()
                    {
                        return Err(AppError::Other(
                            "Panggilan tool dari model tidak lengkap".into(),
                        ));
                    }
                }
                return Ok(ChatMessage {
                    role: "assistant".into(),
                    content,
                    tool_calls: calls.into_values().collect(),
                    tool_call_id: None,
                });
            }
            Ok(Err(error)) => return Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(AppError::Other("Stream asisten terputus".into()));
            }
        }
    }
}

fn assemble_delta(
    chunk: &Value,
    content: &mut String,
    calls: &mut BTreeMap<u64, ToolCall>,
    on_delta: &mut impl FnMut(&str),
) -> Result<bool, AppError> {
    if chunk.get("error").is_some() {
        return Err(AppError::Other("Model mengembalikan kesalahan".into()));
    }
    let Some(delta) = chunk.pointer("/choices/0/delta") else {
        // Some providers send a usage-only chunk before [DONE].
        if chunk.get("usage").is_some() {
            return Ok(false);
        }
        return Err(AppError::Other("Format stream model tidak valid".into()));
    };
    let mut progress = false;
    if let Some(text) = delta
        .get("content")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        content.push_str(text);
        on_delta(text);
        progress = true;
    }
    if let Some(parts) = delta.get("tool_calls").and_then(Value::as_array) {
        for part in parts {
            let index = part
                .get("index")
                .and_then(Value::as_u64)
                .filter(|n| *n < 128)
                .ok_or_else(|| AppError::Other("Indeks tool dari model tidak valid".into()))?;
            let call = calls.entry(index).or_insert_with(|| ToolCall {
                id: String::new(),
                kind: "function".into(),
                function: ToolFunction {
                    name: String::new(),
                    arguments: String::new(),
                },
            });
            if let Some(id) = part.get("id").and_then(Value::as_str) {
                progress |= !id.is_empty();
                call.id.push_str(id);
            }
            if let Some(kind) = part.get("type").and_then(Value::as_str) {
                call.kind = kind.into();
            }
            if let Some(name) = part.pointer("/function/name").and_then(Value::as_str) {
                progress |= !name.is_empty();
                call.function.name.push_str(name);
            }
            if let Some(args) = part.pointer("/function/arguments").and_then(Value::as_str) {
                progress |= !args.is_empty();
                call.function.arguments.push_str(args);
            }
        }
    }
    Ok(progress)
}

fn receive_stream(
    cfg: &Endpoint,
    req: &ChatRequest,
    abort: Arc<AtomicBool>,
    idle: Duration,
    on_chunk: impl FnMut(Value) -> Result<(), AppError>,
) -> Result<(), AppError> {
    #[derive(Serialize)]
    struct StreamingRequest<'a> {
        #[serde(flatten)]
        request: &'a ChatRequest,
        stream: bool,
    }
    let client = agent(abort, idle);
    let mut request = client
        .post(format!(
            "{}/chat/completions",
            cfg.base_url.trim_end_matches('/')
        ))
        .header("Accept", "text/event-stream");
    if let Some(key) = &cfg.api_key {
        request = request.header("Authorization", format!("Bearer {key}"));
    }
    let mut response = request
        .send_json(StreamingRequest {
            request: req,
            stream: true,
        })
        .map_err(|e| http_error(e, &cfg.base_url))?;
    parse_sse(BufReader::new(response.body_mut().as_reader()), on_chunk)
}

fn parse_sse(
    mut reader: impl BufRead,
    mut on_chunk: impl FnMut(Value) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let mut data = String::new();
    let mut finished = false;
    loop {
        let mut line = String::new();
        let bytes = (&mut reader)
            .take((MAX_EVENT_BYTES + 1) as u64)
            .read_line(&mut line)
            .map_err(|_| AppError::Other("Gagal membaca stream Ollama".into()))?;
        if line.len() > MAX_EVENT_BYTES {
            return Err(AppError::Other("Event model terlalu besar".into()));
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() || bytes == 0 {
            if data.trim() == "[DONE]" {
                return Ok(());
            }
            if !data.is_empty() {
                let chunk: Value = serde_json::from_str(&data)
                    .map_err(|_| AppError::Other("JSON stream model tidak valid".into()))?;
                finished |= chunk
                    .pointer("/choices/0/finish_reason")
                    .is_some_and(|v| !v.is_null());
                on_chunk(chunk)?;
                data.clear();
            }
            if bytes == 0 {
                return if finished {
                    Ok(())
                } else {
                    Err(AppError::Other(
                        "Stream Ollama terputus sebelum selesai".into(),
                    ))
                };
            }
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
            if data.len() > MAX_EVENT_BYTES {
                return Err(AppError::Other("Event model terlalu besar".into()));
            }
        }
    }
}

pub fn list_models(base: &str) -> Result<Vec<String>, AppError> {
    let root = base
        .trim_end_matches('/')
        .strip_suffix("/v1")
        .unwrap_or(base.trim_end_matches('/'));
    let client = agent(Arc::new(AtomicBool::new(false)), CONNECT_TIMEOUT);
    let mut response = client
        .get(format!("{root}/api/tags"))
        .config()
        .timeout_global(Some(CONNECT_TIMEOUT))
        .build()
        .call()
        .map_err(|e| http_error(e, base))?;
    let data: Value = response
        .body_mut()
        .read_json()
        .map_err(|_| AppError::Other("Daftar model Ollama tidak valid".into()))?;
    let models = data
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Other("Daftar model Ollama tidak valid".into()))?;
    let mut names = models
        .iter()
        .map(|model| {
            model
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| AppError::Other("Nama model Ollama tidak valid".into()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    names.sort();
    names.dedup();
    Ok(names)
}

pub fn list_custom_models(endpoint: &Endpoint) -> Result<Vec<String>, AppError> {
    list_custom_models_with(&endpoint.base_url, endpoint.api_key.as_deref())
}

/// Lists models from an OpenAI-compatible `GET {base_url}/models` endpoint using a
/// draft key that has not been saved; the key never reaches logs or errors.
pub fn list_custom_models_draft(base_url: &str, api_key: &str) -> Result<Vec<String>, AppError> {
    list_custom_models_with(base_url, Some(api_key))
}

fn list_custom_models_with(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, AppError> {
    let client = agent(Arc::new(AtomicBool::new(false)), CONNECT_TIMEOUT);
    let mut request = client.get(format!("{}/models", base_url.trim_end_matches('/')));
    if let Some(key) = api_key {
        request = request.header("Authorization", format!("Bearer {key}"));
    }
    let mut response = request.config().timeout_global(Some(CONNECT_TIMEOUT)).build().call()
        .map_err(|error| http_error(error, base_url))?;
    let mut bytes = Vec::new();
    response.body_mut().as_reader().take((MAX_EVENT_BYTES + 1) as u64).read_to_end(&mut bytes)
        .map_err(|_| AppError::Other("Gagal membaca daftar model".into()))?;
    if bytes.len() > MAX_EVENT_BYTES { return Err(AppError::Other("Daftar model terlalu besar".into())); }
    let invalid = || AppError::Other("Daftar model penyedia AI tidak valid".into());
    let data: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let rows = data.get("data").and_then(Value::as_array).ok_or_else(invalid)?;
    let mut names = rows.iter().map(|row| {
        row.get("id").and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
            .map(str::to_owned).ok_or_else(invalid)
    }).collect::<Result<Vec<_>, _>>()?;
    names.sort();
    names.dedup();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assistant::test_server::{Server, response, sse};
    use serde_json::json;
    use std::sync::atomic::Ordering;

    fn request() -> ChatRequest {
        ChatRequest {
            model: "qwen2.5:3b".into(),
            messages: vec![ChatMessage::text("user", "Halo")],
            tools: vec![],
        }
    }

    fn endpoint(base_url: String) -> Endpoint {
        Endpoint {
            base_url,
            api_key: None,
        }
    }

    #[test]
    fn streams_content_deltas() {
        let server = Server::new(vec![sse(&[
            json!({"choices":[{"delta":{"role":"assistant","content":"Halo "}}]}),
            json!({"choices":[{"delta":{"content":"Dewi 🐟"},"finish_reason":"stop"}]}),
        ])]);
        let mut deltas = Vec::new();
        let result = stream_chat(
            &endpoint(server.base.clone()),
            &request(),
            &AtomicBool::new(false),
            |s| deltas.push(s.to_owned()),
        )
        .unwrap();
        assert_eq!(result.content, "Halo Dewi 🐟");
        assert_eq!(deltas, ["Halo ", "Dewi 🐟"]);
        let (headers, body) = server.requests.recv().unwrap();
        assert!(headers.starts_with("POST /v1/chat/completions "));
        assert_eq!(body["stream"], true);
        assert_eq!(body["model"], "qwen2.5:3b");
        server.finish();
    }

    #[test]
    fn assembles_split_tool_call_arguments() {
        let server = Server::new(vec![sse(&[
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"create_task","arguments":"{\"title\":"}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"Beli teri\"}"}}]},"finish_reason":"tool_calls"}]}),
        ])]);
        let result = stream_chat(
            &endpoint(server.base.clone()),
            &request(),
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(
            result.tool_calls,
            vec![ToolCall {
                id: "call_1".into(),
                kind: "function".into(),
                function: ToolFunction {
                    name: "create_task".into(),
                    arguments: "{\"title\":\"Beli teri\"}".into()
                }
            }]
        );
        server.finish();
    }

    #[test]
    fn connection_refused_returns_sanitized_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        drop(listener);
        let error =
            stream_chat(&endpoint(base), &request(), &AtomicBool::new(false), |_| {}).unwrap_err();
        assert!(matches!(error, AppError::Other(_)));
        assert!(!error.to_string().contains("http://"));
    }

    #[test]
    fn http_error_status_is_an_error() {
        for status in ["400 Bad Request", "401 Unauthorized", "429 Too Many Requests", "500 Internal Server Error"] {
            let server = Server::new(vec![response(status, "SECRET_PROVIDER_BODY")]);
            let error = stream_chat(
                &endpoint(server.base.clone()),
                &request(),
                &AtomicBool::new(false),
                |_| {},
            )
            .unwrap_err();
            assert!(matches!(error, AppError::Other(_)));
            assert!(!error.to_string().contains("SECRET_PROVIDER_BODY"));
            if status.starts_with("500") {
                assert!(error.to_string().contains("500"));
            }
            server.finish();
        }
    }

    #[test]
    fn cancel_stops_reading() {
        let server = Server::new(vec![sse(&[
            json!({"choices":[{"delta":{"content":"Pertama"}}]}),
            json!({"choices":[{"delta":{"content":"Kedua"}}]}),
        ])]);
        let cancel = AtomicBool::new(false);
        let mut deltas = Vec::new();
        let result = stream_chat(&endpoint(server.base.clone()), &request(), &cancel, |s| {
            deltas.push(s.to_owned());
            cancel.store(true, Ordering::Relaxed);
        });
        assert!(result.is_err());
        assert_eq!(deltas, ["Pertama"]);
        server.finish();
    }

    #[test]
    fn parses_sse_without_network() {
        let input = concat!(
            ": keepalive\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Halo 🐟\"}}]}\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"create_task\",\"arguments\":\"{\\\"title\\\":\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"Teri\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: [DONE]\n\n",
        );
        let mut content = String::new();
        let mut calls = BTreeMap::new();
        let mut deltas = Vec::new();
        parse_sse(std::io::Cursor::new(input), |chunk| {
            assemble_delta(&chunk, &mut content, &mut calls, &mut |s| {
                deltas.push(s.to_owned())
            })?;
            Ok(())
        })
        .unwrap();
        assert_eq!(content, "Halo 🐟");
        assert_eq!(deltas, ["Halo 🐟"]);
        assert_eq!(calls[&0].function.arguments, "{\"title\":\"Teri\"}");
    }

    #[test]
    fn malformed_and_truncated_sse_are_errors() {
        for input in [
            "data: invalid\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
            "",
        ] {
            assert!(parse_sse(std::io::Cursor::new(input), |_| Ok(())).is_err());
        }
        let error = http_error(
            ureq::Error::Io(std::io::ErrorKind::ConnectionRefused.into()),
            "https://user:SECRET_URL@example.com/v1",
        );
        assert!(matches!(error, AppError::Other(_)));
        assert!(!error.to_string().contains("SECRET_URL"));
        assert!(!error.to_string().contains("example.com"));
        let auth = http_error(ureq::Error::StatusCode(401), "https://example.com/v1");
        let rate_limit = http_error(ureq::Error::StatusCode(429), "https://example.com/v1");
        let unsupported = http_error(ureq::Error::StatusCode(400), "https://example.com/v1");
        assert_ne!(auth.to_string(), rate_limit.to_string());
        assert_ne!(auth.to_string(), error.to_string());
        assert_ne!(unsupported.to_string(), auth.to_string());
    }

    #[test]
    fn empty_tool_deltas_are_not_token_progress() {
        let mut content = String::new();
        let mut calls = BTreeMap::new();
        assert!(!assemble_delta(
            &json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":""}}]}}]}),
            &mut content, &mut calls, &mut |_| {}
        ).unwrap());
        assert!(assemble_delta(
            &json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}),
            &mut content, &mut calls, &mut |_| {}
        ).unwrap());
    }

    #[test]
    fn cancellation_closes_a_blocked_reader_without_network() {
        use ureq::unversioned::transport::{LazyBuffers, TransportAdapter};

        #[derive(Debug)]
        struct SilentTransport {
            buffers: LazyBuffers,
            entered_read: mpsc::Sender<()>,
        }
        impl Transport for SilentTransport {
            fn buffers(&mut self) -> &mut dyn Buffers {
                &mut self.buffers
            }
            fn transmit_output(&mut self, _: usize, _: NextTimeout) -> Result<(), ureq::Error> {
                Ok(())
            }
            fn await_input(&mut self, timeout: NextTimeout) -> Result<bool, ureq::Error> {
                let _ = self.entered_read.send(());
                std::thread::sleep(*timeout.after);
                Err(ureq::Error::Timeout(timeout.reason))
            }
            fn is_open(&mut self) -> bool {
                true
            }
        }
        let (entered_read, ready) = mpsc::channel();
        let (result, finished) = mpsc::channel();
        let abort = Arc::new(AtomicBool::new(false));
        let transport = InterruptibleTransport {
            inner: SilentTransport {
                buffers: LazyBuffers::new(1024, 1024),
                entered_read,
            },
            abort: abort.clone(),
        };
        let reader = std::thread::spawn(move || {
            result
                .send(parse_sse(
                    BufReader::new(TransportAdapter::new(transport)),
                    |_| Ok(()),
                ))
                .unwrap();
        });
        ready.recv_timeout(Duration::from_secs(1)).unwrap();
        abort.store(true, Ordering::Relaxed);
        assert!(
            finished
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .is_err()
        );
        reader.join().unwrap();
    }

    #[test]
    fn list_models_uses_ollama_tags_endpoint() {
        let server = Server::new(vec![response(
            "200 OK",
            r#"{"models":[{"name":"qwen2.5:3b"},{"name":"other"},{"name":"other"}]}"#,
        )]);
        assert_eq!(
            list_models(&format!("{}/", server.base)).unwrap(),
            ["other", "qwen2.5:3b"]
        );
        assert!(
            server
                .requests
                .recv()
                .unwrap()
                .0
                .starts_with("GET /api/tags ")
        );
        server.finish();
    }

    #[test]
    fn silent_stream_times_out_even_with_heartbeats() {
        use std::io::Write;
        let (release, wait) = mpsc::channel();
        let server = Server::with_handler(1, move |_, stream| {
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            while wait.recv_timeout(Duration::from_millis(20)).is_err() {
                if stream.write_all(b": heartbeat\n\n").is_err() {
                    break;
                }
            }
        });
        let error = stream_with_timeout(
            &endpoint(server.base.clone()),
            &request(),
            &AtomicBool::new(false),
            |_| {},
            Duration::from_millis(300),
        )
        .unwrap_err();
        assert!(error.to_string().contains("token"), "{error}");
        let _ = release.send(());
        server.finish();
    }

    #[test]
    fn cancel_interrupts_a_silent_server() {
        use std::io::Write;
        let (release, wait) = mpsc::channel();
        let (ready, started) = mpsc::channel();
        let server = Server::with_handler(1, move |_, stream| {
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            ready.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(3)).unwrap();
        });
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let canceller = std::thread::spawn(move || {
            started.recv_timeout(Duration::from_secs(3)).unwrap();
            flag.store(true, Ordering::Relaxed);
        });
        let before = Instant::now();
        let error =
            stream_chat(&endpoint(server.base.clone()), &request(), &cancel, |_| {}).unwrap_err();
        assert!(error.to_string().contains("dihentikan"));
        assert!(before.elapsed() < Duration::from_secs(2));
        release.send(()).unwrap();
        canceller.join().unwrap();
        server.finish();
    }

    #[test]
    fn endpoint_secret_is_zeroized_on_cleanup() {
        let mut endpoint = Endpoint { base_url: "http://localhost/v1".into(), api_key: Some("SECRET_SENTINEL".into()) };
        endpoint.clear_key();
        assert!(endpoint.api_key.as_ref().unwrap().is_empty());
    }
}
