/**
 * 변환 회귀 리포트 생성기.
 * 전(prev) = 디스크의 커밋된 tools/_out/*.html, 후(curr) = 새로 생성한 변환.
 * 결과를 tools/_out/regression-report.html 로 기록.
 *
 * 실행: cd tools && node regression-report.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { buildReportModel, renderReportHtml } = require('./regression-report-core.js');

const SAMPLES_DIR = path.resolve(__dirname, '..', 'samples', 'reference-pairs');
const SRC = path.resolve(__dirname, '..', 'js', 'xml-to-html.js');
const OUT_DIR = path.resolve(__dirname, '_out');

// 1) prev = 디스크의 기존 _out/*.html
const prevMap = {};
if (fs.existsSync(OUT_DIR)) {
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (/_pub\.html$/i.test(f)) prevMap[f] = fs.readFileSync(path.join(OUT_DIR, f), 'utf8');
  }
}

// 2) curr = 새로 생성 (test-xml-to-html.js 와 동일 변환 경로, 메모리에만)
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const window = dom.window;
const source = fs.readFileSync(SRC, 'utf8');
const XmlToHtml = new Function('window', 'document', 'DOMParser', 'module',
  source + '\nreturn XmlToHtml;')(window, window.document, window.DOMParser, {});

const currMap = {};
for (const fname of fs.readdirSync(SAMPLES_DIR).filter(f => /_pub\.xml$/i.test(f)).sort()) {
  const xml = fs.readFileSync(path.join(SAMPLES_DIR, fname), 'utf8');
  const outName = fname.replace(/_pub\.xml$/i, '_pub.html');
  try {
    currMap[outName] = XmlToHtml.convert(xml, { fileName: fname });
  } catch (e) {
    currMap[outName] = `<!-- 변환 실패: ${e.message} -->`;
  }
}

// 3) 모델 + 리포트
const model = buildReportModel(prevMap, currMap);
const html = renderReportHtml(model);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'regression-report.html'), html, 'utf8');

console.log(`리포트 생성: tools/_out/regression-report.html`);
console.log(`요약 — 총 ${model.summary.total} · 변동없음 ${model.summary.unchanged} · 변경 ${model.summary.changed} · 신규 ${model.summary.added} · 삭제 ${model.summary.removed}`);
