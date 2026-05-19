/**
 * test-xml-to-html.js
 * jsdom 환경에서 ../js/xml-to-html.js 를 평가하고 reference-pairs 의 _pub.xml 들을 변환.
 * 결과는 tools/_out/*.html 에 기록한다.
 *
 * 실행: cd tools && node test-xml-to-html.js
 *      cd tools && node test-xml-to-html.js KFA04011Z02   # 특정 화면만
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SAMPLES_DIR = path.resolve(__dirname, '..', 'samples', 'reference-pairs');
const SRC = path.resolve(__dirname, '..', 'js', 'xml-to-html.js');
const OUT_DIR = path.resolve(__dirname, '_out');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// jsdom 안에서 xml-to-html.js 평가 — DOMParser 가 필요하므로 브라우저 환경 시뮬레이션
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const window = dom.window;
const source = fs.readFileSync(SRC, 'utf8');

// IIFE 를 brower context 에서 평가
const sandboxFn = new Function(
  'window', 'document', 'DOMParser', 'module',
  source + '\nreturn XmlToHtml;'
);
const XmlToHtml = sandboxFn(window, window.document, window.DOMParser, {});

// reference-pairs 에서 _pub.xml 만 수집
const files = fs.readdirSync(SAMPLES_DIR)
  .filter(f => /_pub\.xml$/i.test(f))
  .sort();

const filterArg = process.argv[2];
const targets = filterArg ? files.filter(f => f.includes(filterArg)) : files;

console.log(`변환 대상: ${targets.length}개 (필터: ${filterArg || '(전체)'})`);

let ok = 0, fail = 0;
const errors = [];

for (const fname of targets) {
  const fullPath = path.join(SAMPLES_DIR, fname);
  const xml = fs.readFileSync(fullPath, 'utf8');
  try {
    // 출력이 tools/_out/ 에 떨어지므로 ../../css/ 가 프로젝트 루트의 css/ 를 가리킴
    const html = XmlToHtml.convert(xml, {
      fileName: fname,
      inlineCss: false,
      preserveAttrs: true,
      preserveScript: false,
      dataPlaceholder: true,
      cssHrefs: ['../../css/base.css', '../../css/product.css', '../../css/bridge.css'],
    });
    const outName = fname.replace(/\.xml$/i, '.html');
    fs.writeFileSync(path.join(OUT_DIR, outName), html, 'utf8');
    ok++;
    process.stdout.write(`  OK  ${fname} → _out/${outName} (${html.length} bytes)\n`);
  } catch (e) {
    fail++;
    errors.push({ file: fname, error: e.message });
    process.stdout.write(`  FAIL ${fname}: ${e.message}\n`);
  }
}

console.log(`\n=== 결과: 성공 ${ok}건, 실패 ${fail}건 ===`);
if (errors.length) {
  console.log('\n실패 상세:');
  errors.forEach(({ file, error }) => console.log(`  - ${file}: ${error}`));
  process.exit(1);
}
