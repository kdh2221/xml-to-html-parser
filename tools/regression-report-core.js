/**
 * 변환 회귀 리포트 순수함수 — fs/jsdom 비의존.
 *
 * diffLines: 근사 라인 변동 (set 기반, LCS 아님 — 변동 규모 표시용).
 * buildReportModel: prev/curr 파일맵 → 요약 + 파일별 행.
 * renderReportHtml: 모델 → HTML 대시보드 문자열.
 */
function diffLines(prevText, currText) {
  const prev = (prevText || '').split(/\r?\n/);
  const curr = (currText || '').split(/\r?\n/);
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  let added = 0, removed = 0;
  for (const l of curr) if (!prevSet.has(l)) added++;
  for (const l of prev) if (!currSet.has(l)) removed++;
  return { added, removed };
}

function buildReportModel(prevMap, currMap) {
  const files = new Set([...Object.keys(prevMap), ...Object.keys(currMap)]);
  const rows = [];
  let unchanged = 0, changed = 0, added = 0, removed = 0;
  for (const file of [...files].sort()) {
    const inPrev = Object.prototype.hasOwnProperty.call(prevMap, file);
    const inCurr = Object.prototype.hasOwnProperty.call(currMap, file);
    if (!inPrev && inCurr) {
      added++;
      const d = diffLines('', currMap[file]);
      rows.push({ file, status: 'added', addedLines: d.added, removedLines: 0 });
    } else if (inPrev && !inCurr) {
      removed++;
      const d = diffLines(prevMap[file], '');
      rows.push({ file, status: 'removed', addedLines: 0, removedLines: d.removed });
    } else {
      const d = diffLines(prevMap[file], currMap[file]);
      if (d.added === 0 && d.removed === 0) {
        unchanged++;
        rows.push({ file, status: 'unchanged', addedLines: 0, removedLines: 0 });
      } else {
        changed++;
        rows.push({ file, status: 'changed', addedLines: d.added, removedLines: d.removed });
      }
    }
  }
  return { summary: { total: files.size, unchanged, changed, added, removed }, rows };
}

function renderReportHtml(model) {
  const { summary, rows } = model;
  const color = { unchanged: '#16a34a', changed: '#d97706', added: '#2563eb', removed: '#dc2626' };
  const rowsHtml = rows.map(r =>
    `<tr><td>${r.file}</td><td style="color:${color[r.status] || '#000'}">${r.status}</td><td>+${r.addedLines}</td><td>-${r.removedLines}</td></tr>`
  ).join('\n');
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>변환 회귀 리포트</title>
<style>body{font-family:sans-serif;padding:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style></head>
<body>
<h1>변환 회귀 리포트</h1>
<p>총 ${summary.total} · 변동없음 ${summary.unchanged} · 변경 ${summary.changed} · 신규 ${summary.added} · 삭제 ${summary.removed}</p>
<table>
<thead><tr><th>파일</th><th>상태</th><th>+라인</th><th>-라인</th></tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</body></html>`;
}

module.exports = { diffLines, buildReportModel, renderReportHtml };
