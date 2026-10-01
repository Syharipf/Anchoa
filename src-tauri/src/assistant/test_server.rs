//! Local HTTP fixture: captures real requests and serves scripted responses.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::Value;

pub struct Server {
    pub base: String,
    pub requests: Receiver<(String, Value)>,
    thread: JoinHandle<()>,
}

impl Server {
    pub fn new(responses: Vec<String>) -> Self {
        Self::with_handler(responses.len(), move |index, stream| {
            stream.write_all(responses[index].as_bytes()).unwrap();
        })
    }

    pub fn with_handler(
        count: usize,
        handler: impl Fn(usize, &mut TcpStream) + Send + 'static,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let (tx, requests) = mpsc::channel();
        let thread = thread::spawn(move || {
            for index in 0..count {
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(
                                std::time::Instant::now() < deadline,
                                "HTTP fixture did not receive request"
                            );
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(e) => panic!("HTTP fixture: {e}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut data = Vec::new();
                loop {
                    let mut byte = [0];
                    stream.read_exact(&mut byte).unwrap();
                    data.push(byte[0]);
                    if data.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                let headers = String::from_utf8(data).unwrap();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                let mut body = vec![0; length];
                stream.read_exact(&mut body).unwrap();
                tx.send((
                    headers,
                    serde_json::from_slice(&body).unwrap_or(Value::Null),
                ))
                .unwrap();
                handler(index, &mut stream);
            }
        });
        Self {
            base,
            requests,
            thread,
        }
    }

    pub fn finish(self) {
        self.thread.join().unwrap();
    }
}

pub fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

pub fn sse(chunks: &[Value]) -> String {
    let mut body = String::new();
    for chunk in chunks {
        body.push_str(&format!("data: {chunk}\n\n"));
    }
    body.push_str("data: [DONE]\n\n");
    response("200 OK", &body)
}
