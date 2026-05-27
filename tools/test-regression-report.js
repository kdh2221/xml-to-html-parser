/**
 * regression-report-core 테스트 (순수함수 — jsdom 불필요)
 * 실행: cd tools && node test-regression-report.js
 */
const { diffLines, buildReportModel, renderReportHtml } = require('./regression-report-core.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.error(`FAIL  ${label}`); fail++; }
}

const d1 = diffLines('a\nb\nc', 'a\nb\nc');
check(d1.added === 0 && d1.removed === 0, 'diffLines 동일 → 0/0');
const d2 = diffLines('a\nb', 'a\nb\nc');
check(d2.added === 1 && d2.removed === 0, 'diffLines 1줄 추가 → +1/-0');
const d3 = diffLines('a\nb\nc', 'a\nc');
check(d3.added === 0 && d3.removed === 1, 'diffLines 1줄 삭제 → +0/-1');
const dCrlf = diffLines('a\r\nb\r\nc', 'a\nb\nc');
check(dCrlf.added === 0 && dCrlf.removed === 0, 'diffLines CRLF/LF 혼용 → 0/0');

const m1 = buildReportModel({ 'x.html': 'a\nb' }, { 'x.html': 'a\nb' });
check(m1.summary.total === 1 && m1.summary.unchanged === 1 && m1.summary.changed === 0, 'model: 변동 없음');
check(m1.rows[0].status === 'unchanged', 'model: row unchanged');

const m2 = buildReportModel({ 'x.html': 'a\nb' }, { 'x.html': 'a\nb\nc' });
check(m2.summary.changed === 1 && m2.rows[0].addedLines === 1, 'model: 변경 +1');

const m3 = buildReportModel({}, { 'new.html': 'a\nb' });
check(m3.summary.added === 1 && m3.rows[0].status === 'added', 'model: 신규 파일');

const m4 = buildReportModel({ 'gone.html': 'a\nb' }, {});
check(m4.summary.removed === 1 && m4.rows[0].status === 'removed', 'model: 삭제 파일');

const html = renderReportHtml(m2);
check(html.includes('<table') && html.includes('x.html') && html.includes('변경'), 'render: 테이블+파일명+요약 포함');

console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
