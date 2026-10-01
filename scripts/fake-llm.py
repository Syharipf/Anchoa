#!/usr/bin/env python3
"""Fake OpenAI-compatible LLM for the E2E check (no Ollama needed).

GET  /api/tags              -> one model, qwen2.5:3b
POST /v1/chat/completions   -> SSE stream. The first turn asks for create_task("Beli teri");
                               after the tool result comes back it answers with plain text.
Usage: fake-llm.py <port>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


def chunk(delta):
    return "data: " + json.dumps({"choices": [{"index": 0, "delta": delta}]}) + "\n\n"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path != "/api/tags":
            self.send_error(404)
            return
        body = json.dumps({"models": [{"name": "qwen2.5:3b"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        last = request["messages"][-1]
        if last["role"] == "tool":
            parts = [chunk({"role": "assistant", "content": "Siap, "}), chunk({"content": "tugasnya sudah dibuat."})]
        else:
            call = {
                "index": 0,
                "id": "call_1",
                "type": "function",
                "function": {"name": "create_task", "arguments": json.dumps({"title": "Beli teri"})},
            }
            parts = [chunk({"role": "assistant", "content": "Aku buatkan tugasnya. "}), chunk({"tool_calls": [call]})]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for part in parts + ["data: [DONE]\n\n"]:
            self.wfile.write(part.encode())
            self.wfile.flush()


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
