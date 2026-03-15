import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_DAEMON_PORT = Number(process.env.HARNESS_BROWSER_PORT || 4627);
const DEFAULT_DEBUG_PORT = Number(process.env.HARNESS_BROWSER_DEBUG_PORT || 9223);
const DEFAULT_PROFILE_DIR = path.resolve(process.env.HARNESS_BROWSER_PROFILE_DIR || path.join(ROOT, "tmp", "browser-runtime", "profile-default"));
const DEFAULT_STATE_FILE = path.resolve(path.join(ROOT, "tmp", "browser-runtime", "daemon.json"));
const DEFAULT_SCREENSHOT_DIR = path.resolve(path.join(ROOT, "tmp", "browser-runtime", "screenshots"));

function chromePath() {
  return (
    process.env.HARNESS_CHROME_BIN ||
    process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function isRiskyTarget(target = {}) {
  if (!target) return false;
  if (target.risk === "side_effect") return true;
  if (["button", "textbox", "searchbox", "combobox", "checkbox", "radio"].includes(target.role)) return true;
  const text = `${target.text || ""} ${target.ariaLabel || ""}`.toLowerCase();
  if (/(submit|sign in|log in|purchase|buy|save|delete|send|continue|next|apply|checkout)/.test(text)) return true;
  const href = String(target.href || "").toLowerCase();
  if (href.startsWith("javascript:")) return true;
  return false;
}

function buildSelectorScript() {
  return `(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const buildSelector = (el) => {
      if (el.id) return '#' + el.id;
      if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
      const parts = [];
      let current = el;
      while (current && current.nodeType === 1 && current !== document.body) {
        let part = current.tagName.toLowerCase();
        if (current.getAttribute('name')) {
          part += '[name="' + current.getAttribute('name') + '"]';
          parts.unshift(part);
          break;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
          if (siblings.length > 1) {
            part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
          }
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const roleFor = (el) => {
      const mapped = { A: 'link', BUTTON: 'button', TEXTAREA: 'textbox', SELECT: 'combobox' };
      if (el.getAttribute('role')) return el.getAttribute('role');
      if (el.tagName === 'INPUT') return (el.getAttribute('type') || 'textbox').toLowerCase();
      return mapped[el.tagName] || 'generic';
    };
    const classifyRisk = (el, role) => {
      if (['button','textbox','searchbox','combobox','checkbox','radio'].includes(role)) return 'side_effect';
      const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('href') || '')).toLowerCase();
      if (/(submit|sign in|log in|purchase|buy|save|delete|send|continue|next|apply|checkout)/.test(text)) return 'side_effect';
      if (role === 'link') {
        const href = (el.getAttribute('href') || '').toLowerCase();
        if (!href || href.startsWith('#')) return 'read_only';
        if (href.startsWith('javascript:')) return 'side_effect';
        return 'read_only';
      }
      return 'read_only';
    };
    const nodes = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],summary'));
    const actionable = [];
    for (const el of nodes) {
      if (!visible(el)) continue;
      const selector = buildSelector(el);
      const role = roleFor(el);
      const ref = 't' + (actionable.length + 1);
      el.setAttribute('data-harness-ref', ref);
      actionable.push({
        ref,
        selector,
        tag: el.tagName.toLowerCase(),
        role,
        text: (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 200),
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        href: el.getAttribute('href') || '',
        type: el.getAttribute('type') || '',
        risk: classifyRisk(el, role),
        bounds: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()
      });
    }
    return {
      title: document.title,
      url: location.href,
      textExcerpt: (document.body ? document.body.innerText : '').trim().replace(/\s+/g, ' ').slice(0, 2000),
      actionable: actionable.slice(0, 200),
      forms: Array.from(document.forms).map((form, index) => ({
        index,
        action: form.getAttribute('action') || '',
        method: (form.getAttribute('method') || 'get').toLowerCase()
      }))
    };
  })()`;
}

class CDPConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method) {
        const waiters = this.eventWaiters.get(message.method) || [];
        if (waiters.length > 0) {
          const waiter = waiters.shift();
          waiter(message.params || {});
        }
      }
    });
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify(payload));
    return promise;
  }

  once(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push(resolve);
      this.eventWaiters.set(method, waiters);
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    });
  }

  async close() {
    if (!this.socket) return;
    this.socket.close();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

export class HarnessBrowserRuntime {
  constructor(options = {}) {
    this.host = options.host || DEFAULT_HOST;
    this.daemonPort = options.daemonPort || DEFAULT_DAEMON_PORT;
    this.debugPort = options.debugPort || DEFAULT_DEBUG_PORT;
    this.profileDir = options.profileDir || DEFAULT_PROFILE_DIR;
    this.screenshotDir = options.screenshotDir || DEFAULT_SCREENSHOT_DIR;
    this.chromeBinary = options.chromeBinary || chromePath();
    this.chromeProcess = null;
    this.sessions = new Map();
  }

  debugBaseUrl() {
    return `http://${this.host}:${this.debugPort}`;
  }

  async startChrome() {
    try {
      await fetch(`${this.debugBaseUrl()}/json/version`);
      return { running: true, reused: true, debugPort: this.debugPort };
    } catch {}

    await ensureDir(this.profileDir);
    await ensureDir(path.dirname(DEFAULT_STATE_FILE));
    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${this.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=DialMediaRouteProvider",
      "about:blank"
    ];

    this.chromeProcess = spawn(this.chromeBinary, args, {
      detached: true,
      stdio: "ignore"
    });
    this.chromeProcess.unref();

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await fetch(`${this.debugBaseUrl()}/json/version`);
        return { running: true, reused: false, debugPort: this.debugPort };
      } catch {
        await sleep(250);
      }
    }
    throw new Error(`Failed to start Chrome at ${this.chromeBinary}`);
  }

  async listTargets() {
    return fetchJson(`${this.debugBaseUrl()}/json/list`);
  }

  async createSession(input = {}) {
    await this.startChrome();
    const sessionId = input.sessionId || `session-${Date.now()}`;
    const initialUrl = input.url || "about:blank";
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (initialUrl && initialUrl !== "about:blank") {
        await this.navigate(sessionId, { url: initialUrl });
      }
      return {
        sessionId,
        targetId: existing.targetId,
        url: initialUrl !== "about:blank" ? initialUrl : existing.lastSnapshot?.url || "about:blank",
        approvalMode: existing.approvalMode,
        reused: true
      };
    }
    const target = await fetchJson(`${this.debugBaseUrl()}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    const session = {
      sessionId,
      targetId: target.id,
      wsUrl: target.webSocketDebuggerUrl,
      lastSnapshot: null,
      approvalMode: input.approvalMode || "explicit"
    };
    this.sessions.set(sessionId, session);
    if (initialUrl && initialUrl !== "about:blank") {
      await this.navigate(sessionId, { url: initialUrl });
    }
    return {
      sessionId,
      targetId: session.targetId,
      url: initialUrl,
      approvalMode: session.approvalMode,
      reused: false
    };
  }

  async getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown browser session: ${sessionId}`);
    return session;
  }

  async withPage(sessionId, fn) {
    const session = await this.getSession(sessionId);
    const targets = await this.listTargets();
    const target = targets.find((item) => item.id === session.targetId) || session;
    const connection = new CDPConnection(target.webSocketDebuggerUrl || session.wsUrl);
    await connection.connect();
    await connection.send("Page.enable");
    await connection.send("Runtime.enable");
    await connection.send("DOM.enable");
    try {
      return await fn(connection, session);
    } finally {
      await connection.close();
    }
  }

  async navigate(sessionId, input) {
    const url = input.url;
    if (!url) throw new Error("navigate requires url");
    const result = await this.withPage(sessionId, async (page) => {
      const wait = page.once("Page.loadEventFired", 15000).catch(() => null);
      await page.send("Page.navigate", { url });
      await wait;
      return page.send("Runtime.evaluate", { expression: "location.href", returnByValue: true });
    });
    return { action: "navigate", url: result.result.value || url, approvalRequired: false };
  }

  async snapshot(sessionId) {
    const data = await this.withPage(sessionId, async (page, session) => {
      const result = await page.send("Runtime.evaluate", {
        expression: `JSON.stringify(${buildSelectorScript()})`,
        returnByValue: true,
        awaitPromise: true
      });
      const value = result.result.value ? JSON.parse(result.result.value) : null;
      if (!value) throw new Error("Failed to capture browser snapshot");
      session.lastSnapshot = value;
      return value;
    });
    return {
      action: "snapshot",
      page: data,
      actionableCount: data.actionable.length,
      approvalRequired: false
    };
  }

  async screenshot(sessionId, input = {}) {
    await ensureDir(this.screenshotDir);
    const filePath = input.path || path.join(this.screenshotDir, `${sessionId}-${Date.now()}.png`);
    const capture = await this.withPage(sessionId, async (page) => {
      const result = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      return result.data;
    });
    await fs.writeFile(filePath, Buffer.from(capture, "base64"));
    return { action: "screenshot", path: filePath, approvalRequired: false };
  }

  async extract(sessionId, input = {}) {
    const selector = input.selector;
    const ref = input.ref;
    const session = await this.getSession(sessionId);
    const target = ref ? (session.lastSnapshot?.actionable || []).find((item) => item.ref === ref) : null;
    const effectiveSelector = selector || target?.selector;
    if (!effectiveSelector) throw new Error("extract requires selector or known ref");
    const result = await this.withPage(sessionId, async (page) => {
      return page.send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(effectiveSelector)}); if (!el) return null; return { text: (el.innerText || el.textContent || '').trim(), html: el.outerHTML.slice(0, 4000), href: el.getAttribute('href') || '', value: el.value || '' }; })()`,
        returnByValue: true,
        awaitPromise: true
      });
    });
    return { action: "extract", selector: effectiveSelector, value: result.result.value, approvalRequired: false };
  }

  async assertCheck(sessionId, input = {}) {
    const selector = input.selector;
    const textIncludes = input.textIncludes;
    if (!selector) throw new Error("assert requires selector");
    const result = await this.withPage(sessionId, async (page) => {
      return page.send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { exists: false, text: '' }; return { exists: true, text: (el.innerText || el.textContent || '').trim() }; })()`,
        returnByValue: true,
        awaitPromise: true
      });
    });
    const value = result.result.value || { exists: false, text: "" };
    const passed = value.exists && (!textIncludes || value.text.includes(textIncludes));
    return { action: "assert", passed, selector, details: value, approvalRequired: false };
  }

  async click(sessionId, input = {}) {
    const session = await this.getSession(sessionId);
    const snapshot = session.lastSnapshot || (await this.snapshot(sessionId)).page;
    const target = (snapshot.actionable || []).find((item) => item.ref === input.ref);
    if (!target) throw new Error(`Unknown target ref: ${input.ref}`);
    const risky = isRiskyTarget(target);
    if (risky && input.approved !== true) {
      return {
        action: "click",
        executed: false,
        approvalRequired: true,
        target,
        nextStep: "Retry with approved:true after explicit user approval."
      };
    }
    await this.withPage(sessionId, async (page) => {
      await page.send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(target.selector)}); if (!el) throw new Error('Element not found'); el.click(); return true; })()`,
        returnByValue: true,
        awaitPromise: true
      });
      await sleep(250);
    });
    return { action: "click", executed: true, approvalRequired: false, target };
  }

  async fill(sessionId, input = {}) {
    const session = await this.getSession(sessionId);
    const snapshot = session.lastSnapshot || (await this.snapshot(sessionId)).page;
    const target = (snapshot.actionable || []).find((item) => item.ref === input.ref);
    if (!target) throw new Error(`Unknown target ref: ${input.ref}`);
    if (input.approved !== true) {
      return {
        action: "fill",
        executed: false,
        approvalRequired: true,
        target,
        nextStep: "Retry with approved:true after explicit user approval."
      };
    }
    await this.withPage(sessionId, async (page) => {
      await page.send("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(target.selector)}); if (!el) throw new Error('Element not found'); el.focus(); el.value = ${JSON.stringify(input.text || "")}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
        returnByValue: true,
        awaitPromise: true
      });
    });
    return { action: "fill", executed: true, approvalRequired: false, target };
  }

  async perform(sessionId, input = {}) {
    const action = input.action;
    if (action === "navigate") return this.navigate(sessionId, input);
    if (action === "snapshot" || action === "inspect") return this.snapshot(sessionId);
    if (action === "screenshot") return this.screenshot(sessionId, input);
    if (action === "extract") return this.extract(sessionId, input);
    if (action === "assert") return this.assertCheck(sessionId, input);
    if (action === "click") return this.click(sessionId, input);
    if (action === "fill" || action === "type") return this.fill(sessionId, input);
    throw new Error(`Unsupported browser action: ${action}`);
  }

  status() {
    return {
      host: this.host,
      daemonPort: this.daemonPort,
      debugPort: this.debugPort,
      profileDir: this.profileDir,
      sessions: Array.from(this.sessions.values()).map((session) => ({
        sessionId: session.sessionId,
        targetId: session.targetId,
        url: session.lastSnapshot?.url || "",
        title: session.lastSnapshot?.title || "",
        actionableCount: session.lastSnapshot?.actionable?.length || 0
      }))
    };
  }
}

export async function readDaemonState() {
  try {
    return JSON.parse(await fs.readFile(DEFAULT_STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export async function writeDaemonState(state) {
  await ensureDir(path.dirname(DEFAULT_STATE_FILE));
  await fs.writeFile(DEFAULT_STATE_FILE, JSON.stringify(state, null, 2));
}

async function request(method, route, body) {
  const state = (await readDaemonState()) || { host: DEFAULT_HOST, port: DEFAULT_DAEMON_PORT };
  const response = await fetch(`http://${state.host}:${state.port}${route}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function ensureBrowserDaemon() {
  const state = (await readDaemonState()) || { host: DEFAULT_HOST, port: DEFAULT_DAEMON_PORT };
  try {
    const response = await fetch(`http://${state.host}:${state.port}/health`);
    if (response.ok) return state;
  } catch {}

  await ensureDir(path.dirname(DEFAULT_STATE_FILE));
  const daemonPath = path.resolve(ROOT, "scripts", "browser-runtime-daemon.mjs");
  const child = spawn(process.execPath, [daemonPath], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const health = await fetch(`http://${state.host}:${state.port}/health`);
      if (health.ok) return state;
    } catch {}
    await sleep(250);
  }

  throw new Error("Failed to start browser runtime daemon");
}

export async function startBrowserRuntime(input = {}) {
  await ensureBrowserDaemon();
  return request("POST", "/runtime/start", input);
}

export async function browserRuntimeStatus() {
  await ensureBrowserDaemon();
  return request("GET", "/status");
}

export async function createBrowserSession(input = {}) {
  await ensureBrowserDaemon();
  return request("POST", "/sessions", input);
}

export async function performBrowserAction(sessionId, input = {}) {
  await ensureBrowserDaemon();
  return request("POST", `/sessions/${encodeURIComponent(sessionId)}/actions`, input);
}
