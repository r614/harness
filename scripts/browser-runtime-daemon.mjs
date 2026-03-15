import http from "node:http";
import { HarnessBrowserRuntime, writeDaemonState } from "./browser-runtime.mjs";

const runtime = new HarnessBrowserRuntime();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return sendJson(res, 200, runtime.status());
    }
    if (req.method === "POST" && url.pathname === "/runtime/start") {
      const body = await readBody(req);
      const result = await runtime.startChrome(body);
      return sendJson(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/sessions") {
      const body = await readBody(req);
      const session = await runtime.createSession(body);
      return sendJson(res, 200, session);
    }

    const match = /^\/sessions\/([^/]+)\/actions$/.exec(url.pathname);
    if (req.method === "POST" && match) {
      const body = await readBody(req);
      const result = await runtime.perform(decodeURIComponent(match[1]), body);
      return sendJson(res, 200, result);
    }

    sendJson(res, 404, { error: `Unknown route: ${req.method} ${url.pathname}` });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(runtime.daemonPort, runtime.host, async () => {
  await writeDaemonState({ host: runtime.host, port: runtime.daemonPort, debugPort: runtime.debugPort, pid: process.pid });
});
