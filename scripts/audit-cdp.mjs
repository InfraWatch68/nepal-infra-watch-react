import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const baseUrl = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:8080';
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.CDP_PORT ?? 9223);
const maxRoutes = Number(process.env.AUDIT_MAX_ROUTES ?? 60);

const staticRoutes = [
  '/',
  '/projects',
  '/map',
  '/compare',
  '/analytics',
  '/analytics/ratings',
  '/dashboard',
  '/dashboard/submit',
  '/admin',
  '/admin/guide',
  '/auth',
];

const ignoredNetwork = [
  'https://unpkg.com/leaflet@',
  '/favicon.ico',
  '/manifest.webmanifest',
];

const findings = {
  routes: [],
  consoleErrors: [],
  pageErrors: [],
  networkErrors: [],
  overflow: [],
  brokenLinks: [],
  missingImages: [],
  forms: [],
  visibleErrors: [],
  blankSections: [],
};

let nextId = 1;
const callbacks = new Map();
const eventHandlers = [];

function normalizePath(href) {
  try {
    const url = new URL(href, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) return null;
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return null;
  }
}

function wsRequest(ws, method, params = {}, sessionId) {
  const id = nextId++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    callbacks.set(id, { resolve, reject });
    setTimeout(() => {
      if (callbacks.has(id)) {
        callbacks.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 15000);
  });
}

function addFinding(bucket, route, payload) {
  findings[bucket].push({ route, ...payload });
}

async function waitForChrome() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      await delay(250);
    }
  }
  throw new Error('Chrome CDP endpoint did not become ready');
}

async function getPageTargetWs() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find(target => target.type === 'page' && target.url === 'about:blank' && target.webSocketDebuggerUrl)
        ?? targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      await delay(250);
    }
  }
  throw new Error('Chrome page target did not become ready');
}

async function waitForLoad(ws, sessionId) {
  await Promise.race([
    new Promise(resolve => {
      const handler = event => {
        if (event.method === 'Page.loadEventFired' && (!sessionId || event.sessionId === sessionId)) {
          eventHandlers.splice(eventHandlers.indexOf(handler), 1);
          resolve();
        }
      };
      eventHandlers.push(handler);
    }),
    delay(8000),
  ]);
  await delay(1200);
}

async function evaluate(ws, sessionId, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.result?.value;
}

const domAuditExpression = `(() => {
  const isVisible = el => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const labelText = el => {
    const id = el.getAttribute('id');
    const labels = [];
    if (id) document.querySelectorAll('label[for="' + CSS.escape(id) + '"]').forEach(label => labels.push(label.textContent.trim()));
    if (el.closest('label')) labels.push(el.closest('label').textContent.trim());
    return labels.filter(Boolean).join(' ');
  };
  const selectorFor = el => {
    if (el.id) return '#' + el.id;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        const cls = node.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (cls) part += '.' + cls;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const overflow = Array.from(document.querySelectorAll('body *'))
    .filter(el => isVisible(el) && el.scrollWidth > el.clientWidth + 2)
    .slice(0, 30)
    .map(el => ({ selector: selectorFor(el), text: el.textContent.trim().slice(0, 120), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  const missingImages = Array.from(document.images)
    .filter(img => isVisible(img) && (!img.complete || img.naturalWidth === 0))
    .map(img => ({ src: img.currentSrc || img.src, alt: img.alt || '', selector: selectorFor(img) }));
  const links = Array.from(document.querySelectorAll('a[href]'))
    .filter(a => isVisible(a))
    .map(a => ({ href: a.href, text: a.textContent.trim().slice(0, 80), target: a.target || '' }));
  const fields = Array.from(document.querySelectorAll('input, textarea, select, [role="combobox"]'))
    .filter(el => isVisible(el) && el.type !== 'hidden')
    .map(el => ({
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      placeholder: el.getAttribute('placeholder') || '',
      name: el.getAttribute('name') || '',
      id: el.getAttribute('id') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      ariaLabelledby: el.getAttribute('aria-labelledby') || '',
      label: labelText(el),
      role: el.getAttribute('role') || '',
    }))
    .filter(el => !el.label && !el.ariaLabel && !el.ariaLabelledby);
  const badAria = Array.from(document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]'))
    .flatMap(el => ['aria-controls', 'aria-labelledby', 'aria-describedby'].flatMap(attr => {
      const value = el.getAttribute(attr);
      if (!value) return [];
      return value.split(/\\s+/).filter(id => id && !document.getElementById(id)).map(id => ({ selector: selectorFor(el), attr, id }));
    }));
  const visibleErrors = Array.from(document.querySelectorAll('body *'))
    .filter(el => isVisible(el))
    .map(el => ({ selector: selectorFor(el), text: el.textContent.trim() }))
    .filter(x => /\\b(error|failed|not found|could not|unable|invalid|crash|exception)\\b/i.test(x.text))
    .filter(x => x.text.length < 300)
    .slice(0, 20);
  const blankSections = Array.from(document.querySelectorAll('main, section, article, [data-radix-scroll-area-viewport], .card, [class*="Card"]'))
    .filter(el => isVisible(el))
    .filter(el => el.getBoundingClientRect().height > 80 && el.textContent.trim().length === 0 && !el.querySelector('img,svg,canvas,iframe,input,textarea,button'))
    .slice(0, 20)
    .map(el => ({ selector: selectorFor(el), height: Math.round(el.getBoundingClientRect().height) }));
  return { overflow, missingImages, links, fields, badAria, visibleErrors, blankSections, title: document.title, bodyTextLength: document.body.innerText.trim().length };
})()`;

async function main() {
    const chrome = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
    '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
    '--user-data-dir=C:\\Users\\Acer\\.codex\\memories\\chrome-audit-profile',
      'about:blank',
    ], { stdio: 'ignore' });

  try {
    await waitForChrome();
    const pageWs = await getPageTargetWs();
    const ws = new WebSocket(pageWs);
    ws.on('message', message => {
      const data = JSON.parse(message.toString());
      if (data.id && callbacks.has(data.id)) {
        const cb = callbacks.get(data.id);
        callbacks.delete(data.id);
        if (data.error) cb.reject(new Error(data.error.message));
        else cb.resolve(data);
        return;
      }
      for (const handler of [...eventHandlers]) handler(data);
    });
    await new Promise(resolve => ws.once('open', resolve));

    const sessionId = undefined;
    await wsRequest(ws, 'Page.enable', {}, sessionId);
    await wsRequest(ws, 'Runtime.enable', {}, sessionId);
    await wsRequest(ws, 'Network.enable', {}, sessionId);
    await wsRequest(ws, 'Log.enable', {}, sessionId);
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    }, sessionId);

    let currentRoute = '/';
    eventHandlers.push(event => {
      if (sessionId && event.sessionId !== sessionId) return;
      if (event.method === 'Runtime.exceptionThrown') {
        addFinding('pageErrors', currentRoute, { text: event.params.exceptionDetails?.text, details: event.params.exceptionDetails?.exception?.description });
      }
      if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type)) {
        const args = event.params.args?.map(arg => arg.value ?? arg.description ?? arg.type).join(' ');
        if (event.params.type === 'error') addFinding('consoleErrors', currentRoute, { text: args });
      }
      if (event.method === 'Log.entryAdded' && ['error'].includes(event.params.entry.level)) {
        addFinding('consoleErrors', currentRoute, { text: event.params.entry.text, source: event.params.entry.source });
      }
      if (event.method === 'Network.responseReceived') {
        const { response } = event.params;
        if (response.status >= 400 && !ignoredNetwork.some(part => response.url.includes(part))) {
          addFinding('networkErrors', currentRoute, { status: response.status, url: response.url });
        }
      }
    });

    const queue = [...staticRoutes];
    const seen = new Set();
    for (let i = 0; i < queue.length && seen.size < maxRoutes; i += 1) {
      const route = queue[i];
      if (seen.has(route)) continue;
      seen.add(route);
      currentRoute = route;
      const url = new URL(route, baseUrl).href;
      await wsRequest(ws, 'Page.navigate', { url }, sessionId);
      await waitForLoad(ws, sessionId);
      const dom = await evaluate(ws, sessionId, domAuditExpression);
      findings.routes.push({ route, title: dom.title, bodyTextLength: dom.bodyTextLength });
      for (const item of dom.overflow) addFinding('overflow', route, item);
      for (const item of dom.missingImages) addFinding('missingImages', route, item);
      for (const item of dom.fields) addFinding('forms', route, item);
      for (const item of dom.badAria) addFinding('forms', route, item);
      for (const item of dom.visibleErrors) addFinding('visibleErrors', route, item);
      for (const item of dom.blankSections) addFinding('blankSections', route, item);
      for (const link of dom.links) {
        const path = normalizePath(link.href);
        if (!path) continue;
        if (!seen.has(path) && !queue.includes(path) && !path.startsWith('/auth?')) queue.push(path);
      }
    }

    for (const route of [...seen]) {
      const url = new URL(route, baseUrl).href;
      const res = await fetch(url, { redirect: 'manual' }).catch(error => ({ status: 0, error }));
      if (res.status >= 400 || res.status === 0) addFinding('brokenLinks', route, { href: url, status: res.status || 'fetch failed' });
    }

    console.log(JSON.stringify(findings, null, 2));
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
