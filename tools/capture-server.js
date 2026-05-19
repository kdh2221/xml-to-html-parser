/**
 * WebSquare Publishing Editor — 배치 비교 캡처 서비스
 *
 * WebSquare iframe은 브라우저 보안상 cross-origin 캡처가 불가능하므로,
 * 로컬에서 headless Chrome(Puppeteer)으로 페이지를 열고 PNG를 찍어 base64 반환한다.
 *
 * 실행:
 *   cd tools && npm install && node capture-server.js
 *   또는 프로젝트 루트의 start-editor.bat 를 더블클릭
 *
 * 엔드포인트:
 *   GET  /health       → 서비스 살아있는지 확인
 *   POST /capture      → { url, waitMs?, viewport? } → { ok, pngBase64, width, height }
 *
 * 포트: 5678 (고정)
 *
 * 보안:
 *   - 127.0.0.1에만 바인딩 (LAN 노출 차단)
 *   - CORS는 file:// / localhost 출처만 허용
 *   - URL 스킴 http/https만 허용 (file:// / javascript: 등 차단)
 *   - 호스트는 ALLOWED_HOSTS_FILE(JSON)에 명시된 것만 허용 — 첫 호출 시 허용 여부 콘솔에서 확인하도록 안내
 *   - 동시 캡처는 MAX_CONCURRENCY로 제한 (메모리 폭주 방지)
 */

const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = 5678;
const BIND_HOST = '127.0.0.1';
const DEFAULT_WAIT_MS = 3000;
const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const MAX_CONCURRENCY = 4;
const ALLOWED_HOSTS_FILE = path.join(__dirname, 'allowed-hosts.json');

let browser = null;

// ─── 호스트 화이트리스트 ───
function loadAllowedHosts() {
  try {
    if (fs.existsSync(ALLOWED_HOSTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALLOWED_HOSTS_FILE, 'utf8'));
      return new Set(Array.isArray(data.hosts) ? data.hosts : []);
    }
  } catch (e) {
    console.warn('[capture] allowed-hosts.json 파싱 실패:', e.message);
  }
  return new Set();
}
function saveAllowedHosts(set) {
  try {
    fs.writeFileSync(ALLOWED_HOSTS_FILE, JSON.stringify({ hosts: [...set] }, null, 2));
  } catch (e) {
    console.warn('[capture] allowed-hosts.json 저장 실패:', e.message);
  }
}
let allowedHosts = loadAllowedHosts();
// localhost / 127.0.0.1은 항상 허용
['localhost', '127.0.0.1'].forEach(h => allowedHosts.add(h));

function isUrlAllowed(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'URL 형식 오류' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `허용되지 않은 스킴: ${u.protocol}` };
  }
  if (!allowedHosts.has(u.hostname)) {
    return { ok: false, reason: `허용되지 않은 호스트: ${u.hostname}`, host: u.hostname };
  }
  return { ok: true };
}

// ─── CORS 출처 검사 ───
function isOriginAllowed(origin) {
  if (!origin) return true; // file:// 또는 same-origin
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (u.protocol === 'file:') return true;
  } catch {}
  return false;
}

// ─── 동시성 제한 세마포어 ───
let activeCaptures = 0;
const captureQueue = [];
function acquireCaptureSlot() {
  return new Promise(resolve => {
    if (activeCaptures < MAX_CONCURRENCY) {
      activeCaptures++; resolve();
    } else {
      captureQueue.push(() => { activeCaptures++; resolve(); });
    }
  });
}
function releaseCaptureSlot() {
  activeCaptures--;
  const next = captureQueue.shift();
  if (next) next();
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await puppeteer.launch({
    headless: 'new',
    // --disable-web-security는 의도적으로 제거: 캡처 대상이 어차피 자체 도메인이므로 불필요.
    // --no-sandbox는 Windows에서 일부 환경 호환을 위해 유지 (서비스가 127.0.0.1 전용이므로 외부 노출 없음)
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  console.log('[capture] Chrome 인스턴스 기동');
  return browser;
}

// 렌더된 모든 프레임에서 요소 카운트 + 보이는 텍스트 추출
async function extractMetrics(page) {
  const frames = page.frames();
  const merged = { counts: {}, text: '', frameCount: frames.length, frameOk: 0 };
  const textParts = [];

  for (const frame of frames) {
    let data;
    try {
      data = await frame.evaluate(() => {
        const SELECTORS = {
          input: 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea',
          button: 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
          link: 'a[href]',
          image: 'img',
          table: 'table',
          tableRow: 'tr',
          tableCell: 'td, th',
          // WebSquare / 공통 추정 선택자
          wsqGrid: '[class*="gvw"], [class*="gridview"], [class*="GridView"]',
          wsqTab: '[class*="tbc"], [class*="tabControl"]',
          wsqPanel: '[class*="pageFrame"], [class*="panel"]',
        };

        function isVisible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          const cs = window.getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
          return true;
        }

        const counts = {};
        for (const [key, sel] of Object.entries(SELECTORS)) {
          try {
            const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
            counts[key] = els.length;
          } catch { counts[key] = 0; }
        }

        // 보이는 텍스트 노드만 수집
        const parts = [];
        try {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
              const t = n.textContent && n.textContent.trim();
              if (!t) return NodeFilter.FILTER_REJECT;
              if (!isVisible(n.parentElement)) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          });
          let n; while ((n = walker.nextNode())) parts.push(n.textContent.trim());
        } catch {}
        return { counts, text: parts.join(' ').replace(/\s+/g, ' ').trim() };
      });
    } catch (e) {
      continue; // 접근 불가한 프레임은 스킵
    }
    merged.frameOk += 1;
    for (const [k, v] of Object.entries(data.counts || {})) {
      merged.counts[k] = (merged.counts[k] || 0) + v;
    }
    if (data.text) textParts.push(data.text);
  }
  merged.text = textParts.join(' ').replace(/\s+/g, ' ').trim();
  return merged;
}

async function capture(url, waitMs, viewport, opts) {
  const br = await getBrowser();
  const page = await br.newPage();
  try {
    await page.setViewport({
      width: viewport?.width || DEFAULT_VIEWPORT.width,
      height: viewport?.height || DEFAULT_VIEWPORT.height,
      deviceScaleFactor: 1,
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // WebSquare 초기 렌더 대기
    await new Promise((r) => setTimeout(r, typeof waitMs === 'number' ? waitMs : DEFAULT_WAIT_MS));

    const format = (opts?.format || 'jpeg').toLowerCase() === 'png' ? 'png' : 'jpeg';
    const shotOpts = { type: format, fullPage: !!opts?.fullPage };
    if (format === 'jpeg') shotOpts.quality = Math.min(100, Math.max(1, opts?.quality || 80));
    const buf = await page.screenshot(shotOpts);

    const metrics = await extractMetrics(page);
    console.log(`[capture] ${url} format=${format} bytes=${buf.length} frames=${metrics.frameCount}/ok=${metrics.frameOk} counts=${JSON.stringify(metrics.counts)} textLen=${metrics.text.length}`);
    return {
      ok: true,
      imageBase64: buf.toString('base64'),
      format,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      // 호환성: 예전 클라이언트가 pngBase64 를 기대하면 그대로 채워 넣음
      pngBase64: buf.toString('base64'),
      width: viewport?.width || DEFAULT_VIEWPORT.width,
      height: viewport?.height || DEFAULT_VIEWPORT.height,
      metrics,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Express 서버 ───
const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS — file:// / http://localhost:* / http://127.0.0.1:* 만 허용
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    return res.status(403).json({ ok: false, error: '허용되지 않은 출처' });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'wsq-editor-capture', version: '1.1.0', allowedHosts: [...allowedHosts] });
});

// 호스트 허용 추가 — 로컬 콘솔에서 운영자가 직접 호출하거나, 에디터에서 사용자 확인 후 호출
app.post('/allow-host', (req, res) => {
  const { host } = req.body || {};
  if (!host || typeof host !== 'string') return res.status(400).json({ ok: false, error: 'host 필수' });
  allowedHosts.add(host);
  saveAllowedHosts(allowedHosts);
  console.log(`[capture] 호스트 허용 추가: ${host}`);
  res.json({ ok: true, allowedHosts: [...allowedHosts] });
});

app.post('/capture', async (req, res) => {
  const { url, waitMs, viewport, format, quality, fullPage } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'url 필수' });

  // URL 검증 (스킴/호스트)
  const chk = isUrlAllowed(url);
  if (!chk.ok) {
    console.warn(`[capture] 거부: ${url} — ${chk.reason}`);
    return res.status(403).json({
      ok: false,
      error: chk.reason,
      hostToAllow: chk.host || null,
      hint: chk.host ? `이 호스트를 허용하려면: POST /allow-host {"host":"${chk.host}"}` : undefined,
    });
  }

  const t0 = Date.now();
  await acquireCaptureSlot();
  try {
    const result = await capture(url, waitMs, viewport, { format, quality, fullPage });
    console.log(`[capture] ${url} → ${Date.now() - t0}ms`);
    res.json(result);
  } catch (e) {
    console.error('[capture] 실패:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    releaseCaptureSlot();
  }
});

// ─── 시작 ───
const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`[capture] 서비스 ${BIND_HOST}:${PORT} 대기 중 (LAN 노출 안 됨)`);
  console.log(`[capture] 헬스체크: http://${BIND_HOST}:${PORT}/health`);
  console.log(`[capture] 허용 호스트: ${[...allowedHosts].join(', ')}`);
  console.log(`[capture] 동시 캡처 제한: ${MAX_CONCURRENCY}`);
});

// ─── 종료 처리 ───
async function shutdown() {
  console.log('[capture] 종료 중...');
  server.close();
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
