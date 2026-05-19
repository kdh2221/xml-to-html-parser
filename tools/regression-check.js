// Regression check: 변환기 수정 후 기존 변환 결과와 diff
// Usage: node regression-check.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const KB_ROOT = 'D:/AI_KB/KB_ABS_REL_test/WebContent/pub';

// 페어 정의: { srcDir, refDir, refSuffix } — srcDir의 foo.xml ↔ refDir의 foo_rel_v*.xml
const PAIRS = [
  { srcDir: path.join(KB_ROOT, 'exc_verify/default'),  refDir: path.join(KB_ROOT, 'exc_verify/default_ver') },
  { srcDir: path.join(KB_ROOT, 'kb_21'),                refDir: path.join(KB_ROOT, 'kb_21_ver') },
];

// jsdom 컨텍스트 준비 — DOMParser/XMLSerializer/document 제공
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.Node = dom.window.Node;
global.Element = dom.window.Element;

// 컨버터 로드 (전역에 SampleConverter 노출)
const converterCode = fs.readFileSync(path.join(ROOT, 'js/sample-converter.js'), 'utf8');
// IIFE가 const SampleConverter = (() => {...})() 패턴이므로 eval로 불러와 globalThis에 할당
eval(converterCode + '\nglobalThis.SampleConverter = SampleConverter;');

function findRefFile(refDir, baseName) {
  const files = fs.readdirSync(refDir);
  return files.find(f => f.startsWith(baseName + '_rel_v') && f.endsWith('.xml'));
}

function normalize(s) {
  // 들여쓰기/공백/줄끝 차이 무시
  let n = s.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();
  // jsdom 직렬화 노이즈 제거 (구조와 무관)
  // 1) ev:* → ns1:* (jsdom의 알 수 없는 네임스페이스 prefix 처리)
  n = n.replace(/\bns1:/g, 'ev:');
  // 2) CDATA 보존 차이: <![CDATA[X]]> ↔ X (텍스트 노드)
  n = n.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // 3) 빈 self-close 형태 차이는 라인수 동일하면 무시 (구조적이지 않음)
  return n;
}

function lineDiff(a, b, max = 5) {
  const al = a.split('\n'), bl = b.split('\n');
  const diffs = [];
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n && diffs.length < max; i++) {
    if (al[i] !== bl[i]) diffs.push({ line: i + 1, ref: al[i] || '<EOF>', cur: bl[i] || '<EOF>' });
  }
  return diffs;
}

const results = { identical: [], changed: [], failed: [], skipped: [] };

for (const { srcDir, refDir } of PAIRS) {
  if (!fs.existsSync(srcDir) || !fs.existsSync(refDir)) {
    console.log(`[skip] ${srcDir} or ${refDir} not found`);
    continue;
  }
  const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.xml') && !/_rel_v\d+\.xml$/.test(f));
  for (const srcFile of srcFiles) {
    const baseName = srcFile.replace(/\.xml$/, '');
    const refFile = findRefFile(refDir, baseName);
    if (!refFile) { results.skipped.push({ srcFile, reason: 'no ref' }); continue; }

    const srcPath = path.join(srcDir, srcFile);
    const refPath = path.join(refDir, refFile);
    const srcXml = fs.readFileSync(srcPath, 'utf8');
    const refXml = fs.readFileSync(refPath, 'utf8');

    let curXml;
    try {
      const res = SampleConverter.convert(srcXml, { responsive: false });
      curXml = res?.convertedXml || '';
    } catch (e) {
      results.failed.push({ srcFile, error: e.message });
      continue;
    }

    const a = normalize(refXml), b = normalize(curXml);
    if (a === b) {
      results.identical.push(srcFile);
    } else {
      const diffs = lineDiff(a, b, 3);
      results.changed.push({ srcFile, refLines: a.split('\n').length, curLines: b.split('\n').length, sample: diffs });
    }
  }
}

console.log('\n=== REGRESSION SUMMARY ===');
console.log(`identical: ${results.identical.length}`);
console.log(`changed:   ${results.changed.length}`);
console.log(`failed:    ${results.failed.length}`);
console.log(`skipped:   ${results.skipped.length}`);

if (results.changed.length) {
  console.log('\n--- CHANGED FILES ---');
  results.changed.forEach(c => {
    console.log(`\n[${c.srcFile}]  ref=${c.refLines}L cur=${c.curLines}L  Δ=${c.curLines - c.refLines}`);
    c.sample.forEach(d => {
      console.log(`  L${d.line}`);
      console.log(`    ref: ${d.ref.substring(0, 200)}`);
      console.log(`    cur: ${d.cur.substring(0, 200)}`);
    });
  });
}

if (results.failed.length) {
  console.log('\n--- FAILED ---');
  results.failed.forEach(f => console.log(`  ${f.srcFile}: ${f.error}`));
}
