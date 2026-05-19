// 단일 파일 변환 후 reference와 정확한 diff 위치/내용 확인
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

const ROOT = path.resolve(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'js/sample-converter.js'), 'utf8') + '\nglobalThis.SC = SampleConverter;');

const srcPath = process.argv[2];
const refPath = process.argv[3];

const srcXml = fs.readFileSync(srcPath, 'utf8');
const refXml = fs.readFileSync(refPath, 'utf8');
const cur = SC.convert(srcXml, { responsive: false }).convertedXml;

const norm = s => s.replace(/\r\n/g, '\n').replace(/\bns1:/g, 'ev:').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();
const a = norm(refXml).split('\n');
const b = norm(cur).split('\n');

let printed = 0;
for (let i = 0; i < Math.max(a.length, b.length) && printed < 10; i++) {
  if (a[i] !== b[i]) {
    console.log(`\nL${i + 1}:`);
    console.log(`  ref: ${JSON.stringify(a[i])}`);
    console.log(`  cur: ${JSON.stringify(b[i])}`);
    printed++;
  }
}
if (printed === 0) console.log('IDENTICAL after normalize');
