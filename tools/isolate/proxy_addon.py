import json
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mitmproxy import http
from upstream_rules import classify

LOG_PATH = os.environ["ISOLATE_PROXY_LOG"]
MODE = os.environ.get("ISOLATE_PROXY_MODE", "block-upstream")
BODY_PREVIEW = 4000
lock = threading.Lock()


def record(entry):
    entry = {"ts": round(time.time(), 3), **entry}
    with lock, open(LOG_PATH, "a", encoding="utf-8") as log:
        log.write(json.dumps(entry, sort_keys=True) + "\n")


def refused(flow, status, reason):
    flow.response = http.Response.make(status, reason.encode(), {"Content-Type": "text/plain", "X-Isolate-Proxy": "refused"})


class IsolateLogger:
    def http_connect(self, flow):
        host = flow.request.pretty_host
        verdict, why = classify(host, None)
        record({"event": "connect", "host": host, "port": flow.request.port, "verdict": verdict, "why": why})

    def request(self, flow):
        request = flow.request
        verdict, why = classify(request.pretty_host, request.path)
        action = "forwarded"
        if MODE == "offline":
            action = "refused"
            refused(flow, 503, "isolate proxy: offline mode")
        elif MODE == "block-upstream" and verdict == "upstream":
            action = "refused"
            refused(flow, 451, "isolate proxy: upstream destination refused")
        entry = {
            "event": "request",
            "method": request.method,
            "scheme": request.scheme,
            "host": request.pretty_host,
            "port": request.port,
            "path": request.path,
            "user_agent": request.headers.get("user-agent", ""),
            "verdict": verdict,
            "why": why,
            "action": action,
        }
        if verdict == "upstream" and request.content:
            entry["body_bytes"] = len(request.content)
            entry["body_preview"] = request.get_text(strict=False)[:BODY_PREVIEW] if request.content else ""
        record(entry)

    def response(self, flow):
        if flow.response is None or flow.response.headers.get("X-Isolate-Proxy") == "refused":
            return
        record({"event": "response", "host": flow.request.pretty_host, "path": flow.request.path, "status": flow.response.status_code})

    def error(self, flow):
        record({"event": "error", "host": flow.request.pretty_host if flow.request else "", "path": flow.request.path if flow.request else "", "error": str(flow.error)})

    def tls_failed_client(self, data):
        server = data.context.server
        sni = data.conn.sni or (server.address[0] if server and server.address else "")
        record({"event": "tls-failed-client", "host": sni, "error": str(data.conn.error), "verdict": classify(sni, None)[0]})


addons = [IsolateLogger()]
