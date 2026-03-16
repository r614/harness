/**
 * Minimal CDP client backed by Chrome's DevToolsActivePort discovery.
 * Keeps the existing helper-script API used by Harness utilities.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

function getWsUrl() {
  const home = homedir();
  const macBrowsers = [
    "Google/Chrome",
    "Google/Chrome Beta",
    "Google/Chrome for Testing",
    "Chromium",
    "BraveSoftware/Brave-Browser",
    "Microsoft Edge",
  ];
  const linuxBrowsers = [
    "google-chrome",
    "google-chrome-beta",
    "chromium",
    "vivaldi",
    "vivaldi-snapshot",
    "BraveSoftware/Brave-Browser",
    "microsoft-edge",
  ];
  const windowsBrowsers = [
    "Google/Chrome",
    "BraveSoftware/Brave-Browser",
    "Microsoft/Edge",
  ];

  const candidates = [
    process.env.CDP_PORT_FILE,
    ...macBrowsers.flatMap((browser) => [
      resolve(home, "Library/Application Support", browser, "DevToolsActivePort"),
      resolve(home, "Library/Application Support", browser, "Default/DevToolsActivePort"),
    ]),
    ...linuxBrowsers.flatMap((browser) => [
      resolve(home, ".config", browser, "DevToolsActivePort"),
      resolve(home, ".config", browser, "Default/DevToolsActivePort"),
    ]),
    ...windowsBrowsers.flatMap((browser) => [
      resolve(home, "AppData/Local", browser, "User Data/DevToolsActivePort"),
      resolve(home, "AppData/Local", browser, "User Data/Default/DevToolsActivePort"),
    ]),
  ].filter(Boolean);

  const portFile = candidates.find((candidate) => existsSync(candidate));
  if (!portFile) {
    throw new Error(
      "No DevToolsActivePort found. Enable remote debugging in chrome://inspect/#remote-debugging or set CDP_PORT_FILE."
    );
  }

  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  if (!port || !path) {
    throw new Error(`Invalid DevToolsActivePort file: ${portFile}`);
  }
  return `ws://127.0.0.1:${port}${path}`;
}

export async function connect(timeout = 5000) {
  const wsUrl = getWsUrl();

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeoutId = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connect timeout"));
    }, timeout);

    ws.onopen = () => {
      clearTimeout(timeoutId);
      resolve(new CDP(ws));
    };
    ws.onerror = (event) => {
      clearTimeout(timeoutId);
      reject(new Error(`WebSocket error: ${event.message || event.type || "unknown"}`));
    };
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.callbacks = new Map();
    this.eventHandlers = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject, timeoutId } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        clearTimeout(timeoutId);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }

      if (!msg.method) return;
      const handlers = this.eventHandlers.get(msg.method);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(msg.params || {}, msg.sessionId || null);
        } catch {
          // Ignore handler errors to keep the session alive.
        }
      }
    };
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    this.eventHandlers.get(method).add(handler);
    return () => this.off(method, handler);
  }

  off(method, handler) {
    const handlers = this.eventHandlers.get(method);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) this.eventHandlers.delete(method);
  }

  send(method, params = {}, sessionId = null, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const msgId = ++this.id;
      const payload = { id: msgId, method, params };
      if (sessionId) payload.sessionId = sessionId;

      const timeoutId = setTimeout(() => {
        this.callbacks.delete(msgId);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);

      this.callbacks.set(msgId, { resolve, reject, timeoutId });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async getPages() {
    const { targetInfos } = await this.send("Target.getTargets");
    return targetInfos.filter((target) => target.type === "page" && !target.url.startsWith("chrome://"));
  }

  async attachToPage(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return sessionId;
  }

  async evaluate(sessionId, expression, timeout = 30000) {
    await this.send("Runtime.enable", {}, sessionId).catch(() => {});
    const result = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
      timeout
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  async screenshot(sessionId, timeout = 10000) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" }, sessionId, timeout);
    return Buffer.from(data, "base64");
  }

  async navigate(sessionId, url, timeout = 30000) {
    await this.send("Page.enable", {}, sessionId).catch(() => {});
    return await this.send("Page.navigate", { url }, sessionId, timeout);
  }

  async getFrameTree(sessionId) {
    const { frameTree } = await this.send("Page.getFrameTree", {}, sessionId);
    return frameTree;
  }

  async evaluateInFrame(sessionId, frameId, expression, timeout = 30000) {
    const { executionContextId } = await this.send(
      "Page.createIsolatedWorld",
      { frameId, worldName: "cdp-eval" },
      sessionId,
      timeout
    );
    const result = await this.send(
      "Runtime.evaluate",
      { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true },
      sessionId,
      timeout
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}
