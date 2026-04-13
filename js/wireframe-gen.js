/**
 * WebSquare Wireframe MD Generator (wireframe-gen.js)
 *
 * xml-parser.js 공통 모듈 사용.
 * 변환기(abs-to-rel-converter.js)와 동일한 섹션 분류 결과를 와이어프레임 MD로 보여준다.
 *
 * 브라우저: WireframeGen.generate(xmlStr, fileName) → MD 문자열
 * Node CLI: node wireframe-gen.js input.xml [-o output_dir]
 */
const WireframeGen = (() => {

  // ─── 컴포넌트 아이콘 ───

  function compIcon(comp) {
    const c = comp.ctype || '';
    const label = comp.label || comp.id || '';
    switch (c) {
      case 'Text': return label;
      case 'Desc': return label;
      case 'Edit': return `[${label || '입력'}]`;
      case 'Calendar': return `[📅${label ? ' ' + label : ''}]`;
      case 'SelectBox': case 'Combo': return `[▼${label || '선택'}]`;
      case 'CheckBox': return `☑${label}`;
      case 'Button': case 'Trigger': return `{${label || 'btn'}}`;
      case 'GridView': return `Grid: ${comp.id}`;
      default: return label || `<${c}>`;
    }
  }

  // ─── 그리드 버튼 판별 (변환기와 동일) ───

  const GRID_BTN_RE = /행추가|행삭제|행복사|엑셀|excel|다운로드|download|업로드|upload|인쇄|print|보고서|초기화|reset|copy|row_add|row_del/i;

  function isGridBtn(c) {
    return ['Button', 'Trigger'].includes(c.ctype) &&
      (GRID_BTN_RE.test(c.label || '') || GRID_BTN_RE.test(c.id || '') || GRID_BTN_RE.test(c.attributes?.text || ''));
  }


  // ─── 섹션 → outputItems 변환 (변환기와 동일 로직) ───

  function buildOutputItems(sections, analysis) {
    const items = []; // [{ type:'tblbox'|'gvwbox'|'titbox'|'btngroup'|'title', ... }]
    const hiddenComps = [];

    let i = 0;
    while (i < sections.length) {
      const section = sections[i];

      if (section.hidden) {
        section.comps.forEach(c => hiddenComps.push(c));
        i++; continue;
      }

      if (section.type === 'grid') {
        const g = section.comps.find(c => c.ctype === 'GridView');
        if (g) items.push({ type: 'gvwbox', grid: g, comps: section.comps });
        i++;

      } else if (section.type === 'groupbox') {
        const visComps = section.comps.filter(c => !c.hidden);
        if (!visComps.length) { i++; continue; }

        const isSearchBox = analysis.hasSearchBtn && visComps.some(c =>
          ['Button', 'Trigger'].includes(c.ctype) &&
          (/(조회|search|inqry)/i.test(c.label || '') || /(조회|search|inqry)/i.test(c.id || '')));

        const titleComp = visComps.find(c => c.isTitle);
        const workComps = visComps.filter(c => !c.isTitle);
        const hasGrid = workComps.some(c => c.ctype === 'GridView');

        if (isSearchBox) {
          const formComps = workComps.filter(c => !['Button', 'Trigger'].includes(c.ctype));
          const btnComps = workComps.filter(c => ['Button', 'Trigger'].includes(c.ctype));
          items.push({ type: 'schbox', comps: formComps, btns: btnComps, groupId: section.groupId });

        } else if (hasGrid) {
          const gridComps = workComps.filter(c => c.ctype === 'GridView');
          const gridBtns = workComps.filter(isGridBtn);
          const formComps = workComps.filter(c => c.ctype !== 'GridView' && !isGridBtn(c));
          const formBefore = formComps.filter(c => c.top < gridComps[0].top);
          const formAfter = formComps.filter(c => c.top >= gridComps[0].top);

          if (titleComp) items.push({ type: 'title', label: titleComp.label || '' });
          if (formBefore.length) items.push({ type: 'tblbox', comps: formBefore, groupId: section.groupId });
          if (gridBtns.length) items.push({ type: 'btngroup', comps: gridBtns });
          gridComps.forEach(g => items.push({ type: 'gvwbox', grid: g, comps: [g] }));
          if (formAfter.length) items.push({ type: 'tblbox', comps: formAfter, groupId: section.groupId });

        } else {
          if (titleComp) items.push({ type: 'title', label: titleComp.label || '' });
          if (workComps.length) items.push({ type: 'tblbox', comps: workComps, groupId: section.groupId });
        }
        i++;

      } else if (section.type === 'standalone') {
        const allStandalone = [];
        while (i < sections.length && sections[i].type === 'standalone') {
          const s = sections[i];
          if (s.hidden) { s.comps.forEach(c => hiddenComps.push(c)); i++; continue; }
          s.comps.forEach(c => { if (c.hidden) hiddenComps.push(c); else allStandalone.push(c); });
          i++;
        }
        allStandalone.sort((a, b) => a.top - b.top || a.left - b.left);

        let formGroup = [], btnGroup = [];
        function flushForm() {
          if (!formGroup.length) return;
          const rows = XmlParser.clusterRows(formGroup);
          if (rows.length > 1 && rows[0].length === 1 && ['Text', 'Desc'].includes(rows[0][0].ctype)) {
            items.push({ type: 'title', label: rows[0][0].label || '' });
            formGroup = formGroup.filter(c => c !== rows[0][0]);
          }
          if (formGroup.length) items.push({ type: 'tblbox', comps: formGroup });
          formGroup = [];
        }
        function flushBtn() {
          if (!btnGroup.length) return;
          items.push({ type: 'btngroup', comps: [...btnGroup] });
          btnGroup = [];
        }
        allStandalone.forEach(c => {
          if (['Button', 'Trigger'].includes(c.ctype)) { flushForm(); btnGroup.push(c); }
          else { flushBtn(); formGroup.push(c); }
        });
        flushForm(); flushBtn();
      } else { i++; }
    }

    // btngroup → 뒤에 콘텐츠 없으면 last 표시
    items.forEach((item, idx) => {
      if (item.type === 'btngroup') {
        item.isLast = !items.slice(idx + 1).some(x => ['tblbox', 'gvwbox', 'schbox', 'title'].includes(x.type));
      }
    });

    // btngroup + 바로 뒤 title → 병합
    const merged = [];
    let mi = 0;
    while (mi < items.length) {
      const item = items[mi];
      if (item.type === 'btngroup' && !item.isLast) {
        const next = items[mi + 1];
        if (next && next.type === 'title') {
          merged.push({ type: 'titbox', label: next.label, btns: item.comps });
          mi += 2; continue;
        } else {
          merged.push({ type: 'titbox', label: null, btns: item.comps });
          mi++; continue;
        }
      }
      merged.push(item);
      mi++;
    }

    return { items: merged, hiddenComps };
  }


  // ─── MD 생성 ───

  function generateFromSections(meta, sections, analysis) {
    const { items, hiddenComps } = buildOutputItems(sections, analysis);
    const lines = [];

    // 헤더
    lines.push(`# ${meta.screenId} — ${meta.screenName}`);
    lines.push('');
    lines.push(`- **파일**: \`${meta.file || ''}\``);
    lines.push(`- **화면ID**: ${meta.screenId}`);
    lines.push(`- **화면명**: ${meta.screenName}`);
    if (meta.width && meta.height) lines.push(`- **크기**: ${meta.width}px × ${meta.height}px`);
    lines.push(`- **컴포넌트**: ${analysis.visibleComponents}개 (표시) + ${analysis.hiddenComponents}개 (숨김)`);
    lines.push('');

    // ─── 화면 구조 와이어프레임 ───
    lines.push('## 화면 구조');
    lines.push('');
    lines.push('```');
    const bw = 70;
    const titleLine = `─ ${meta.screenName} (${meta.screenId}) `;
    lines.push(`┌${titleLine}${'─'.repeat(Math.max(bw - titleLine.length - 1, 3))}┐`);

    items.forEach(item => {
      if (item.type === 'title') {
        lines.push(`│  ┌─ .titbox ─ ${item.label} ${'─'.repeat(Math.max(bw - 18 - (item.label||'').length * 2, 3))}┐  │`);
        lines.push(`│  └${'─'.repeat(Math.max(bw - 6, 10))}┘  │`);

      } else if (item.type === 'titbox') {
        const label = item.label ? `.titbox ─ ${item.label}` : '.titbox > .rt';
        const btnText = item.btns.map(b => `{${b.label || b.id}}`).join(' ');
        lines.push(`│  ┌─ ${label} ${'─'.repeat(Math.max(bw - label.length - 8, 3))}┐  │`);
        lines.push(`│  │  ${btnText}`.padEnd(bw) + `│  │`);
        lines.push(`│  └${'─'.repeat(Math.max(bw - 6, 10))}┘  │`);

      } else if (item.type === 'tblbox' || item.type === 'schbox') {
        const comps = item.comps || [];
        const rows = XmlParser.clusterRows(comps);
        const boxClass = item.type === 'schbox' ? '.schbox' : '.tblbox';
        lines.push(`│  ┌─ ${boxClass} ${'─'.repeat(Math.max(bw - boxClass.length - 8, 5))}┐  │`);
        rows.forEach(row => {
          const cells = XmlParser.rowToCells(row);
          const rowText = cells.map(cell => {
            const txt = cell.comps.map(c => compIcon(c)).join(' ');
            return cell.type === 'th' ? `[${txt}]` : txt;
          }).join(' │ ');
          lines.push(`│  │  ${rowText.length > bw - 8 ? rowText.substring(0, bw - 11) + '...' : rowText}`.padEnd(bw) + `│  │`);
        });
        if (item.type === 'schbox' && item.btns?.length) {
          lines.push(`│  │  btn_schbox: ${item.btns.map(b => `{${b.label||b.id}}`).join(' ')}`.padEnd(bw) + `│  │`);
        }
        lines.push(`│  └${'─'.repeat(Math.max(bw - 6, 10))}┘  │`);

      } else if (item.type === 'gvwbox') {
        const g = item.grid;
        const colCount = g?.columns?.length || 0;
        lines.push(`│  ┌─ .gvwbox ${'─'.repeat(Math.max(bw - 16, 10))}┐  │`);
        lines.push(`│  │  Grid: ${g?.id || '?'} ${colCount ? `(${colCount}컬럼)` : ''}`.padEnd(bw) + `│  │`);
        lines.push(`│  └${'─'.repeat(Math.max(bw - 6, 10))}┘  │`);

      } else if (item.type === 'btngroup') {
        // 마지막 버튼 → .btnbox
        const btnText = item.comps.map(b => `{${b.label || b.id}}`).join(' ');
        lines.push(`│  ┌─ .btnbox ${'─'.repeat(Math.max(bw - 16, 10))}┐  │`);
        lines.push(`│  │  ${btnText}`.padEnd(bw) + `│  │`);
        lines.push(`│  └${'─'.repeat(Math.max(bw - 6, 10))}┘  │`);
      }
    });

    if (hiddenComps.length) {
      lines.push(`│  ── hidden fields (${hiddenComps.length}개) ──`.padEnd(bw + 4) + `│`);
    }
    lines.push(`└${'─'.repeat(bw + 3)}┘`);
    lines.push('```');
    lines.push('');

    // ─── Publishing 매핑 ───
    lines.push('## Publishing 매핑');
    lines.push('');
    lines.push('| 순서 | 영역 | class | 내용 |');
    lines.push('|------|------|-------|------|');

    items.forEach((item, idx) => {
      const order = idx + 1;
      if (item.type === 'title') {
        lines.push(`| ${order} | 타이틀 | \`.titbox\` | ${item.label} |`);
      } else if (item.type === 'titbox') {
        const btns = item.btns.map(b => b.label || b.id).join(', ');
        lines.push(`| ${order} | ${item.label ? '타이틀+버튼' : '중간버튼'} | \`.titbox\` | ${item.label ? item.label + ' / ' : ''}${btns} |`);
      } else if (item.type === 'tblbox') {
        const rows = XmlParser.clusterRows(item.comps);
        lines.push(`| ${order} | 테이블폼 | \`.tblbox\` | ${rows.length}행, ${item.comps.length}개 컴포넌트 |`);
      } else if (item.type === 'schbox') {
        const rows = XmlParser.clusterRows(item.comps);
        lines.push(`| ${order} | 조회조건 | \`.schbox\` | ${rows.length}행, ${item.comps.length}개 / 버튼: ${(item.btns||[]).map(b=>b.label||b.id).join(',')} |`);
      } else if (item.type === 'gvwbox') {
        const g = item.grid;
        lines.push(`| ${order} | 그리드 | \`.gvwbox\` | ${g?.id} (${g?.columns?.length||0}컬럼) |`);
      } else if (item.type === 'btngroup') {
        lines.push(`| ${order} | 하단버튼 | \`.btnbox\` | ${item.comps.map(c=>c.label||c.id).join(', ')} |`);
      }
    });
    lines.push('');

    // ─── 섹션별 상세 ───
    items.forEach((item, idx) => {
      const order = idx + 1;

      if (item.type === 'tblbox' || item.type === 'schbox') {
        const cls = item.type === 'schbox' ? '.schbox' : '.tblbox';
        const name = item.type === 'schbox' ? '조회조건' : '테이블폼';
        lines.push(`## [${order}] ${name} (${cls})${item.groupId ? ' — ' + item.groupId : ''}`);
        lines.push('');
        const rows = XmlParser.clusterRows(item.comps);
        const rowCells = rows.map(row => XmlParser.rowToCells(row));
        const maxCols = Math.max(...rowCells.map(c => c.length), 0);
        if (maxCols > 0) {
          lines.push(`> ${maxCols}열 table`);
          lines.push('');
          rowCells.forEach((cells, ri) => {
            const deficit = maxCols - cells.length;
            const parts = cells.map((cell, ci) => {
              const isLast = ci === cells.length - 1;
              const span = (isLast && deficit > 0) ? ` (colspan=${deficit + 1})` : '';
              if (cell.type === 'th') return `**${cell.comps.map(c => compIcon(c)).join(' ')}**${span}`;
              return cell.comps.map(c => `\`${c.id||''}\` ${compIcon(c)}`).join(' + ') + span;
            });
            lines.push(`- Row ${ri + 1}: ${parts.join(' | ')}`);
          });
        }
        lines.push('');

      } else if (item.type === 'gvwbox') {
        const g = item.grid;
        if (!g) return;
        lines.push(`## [${order}] 그리드 (.gvwbox) — ${g.id}`);
        lines.push('');
        lines.push(`- **ID**: ${g.id}`);
        lines.push(`- **크기**: ${g.width}px × ${g.height}px → \`width:100%; height:150px;\``);
        if (g.attributes?.dataList) lines.push(`- **dataList**: \`${g.attributes.dataList}\``);
        if (g.columns?.length) {
          lines.push('');
          lines.push(`**컬럼** (${g.columns.length}개):`);
          lines.push('');
          lines.push('| # | 컬럼명 | 너비 |');
          lines.push('|---|--------|------|');
          g.columns.forEach((col, ci) => lines.push(`| ${ci + 1} | ${col.label} | ${col.width}px |`));
        }
        lines.push('');
      }
    });

    // ─── Hidden 필드 ───
    const allComps = sections.flatMap(s => s.comps);
    const uniqueHidden = [];
    const seen = new Set();
    [...hiddenComps, ...allComps.filter(c => c.hidden)].forEach(c => {
      if (!c.id || seen.has(c.id) || /^GroupBox/i.test(c.id) || c.id.startsWith('title_')) return;
      seen.add(c.id);
      uniqueHidden.push(c);
    });
    if (uniqueHidden.length) {
      lines.push('## Hidden 필드');
      lines.push('');
      lines.push('| ID | 타입 | 바인딩 |');
      lines.push('|----|------|--------|');
      uniqueHidden.forEach(c => {
        const ref = c.attributes?.ref || '';
        lines.push(`| ${c.id} | ${c.ctype} | ${ref ? '`' + ref + '`' : ''} |`);
      });
      lines.push('');
    }

    // ─── 데이터 바인딩 ───
    const bound = allComps.filter(c => c.attributes?.ref);
    if (bound.length) {
      lines.push('## 데이터 바인딩');
      lines.push('');
      lines.push('| 컴포넌트 ID | 타입 | 바인딩 |');
      lines.push('|------------|------|--------|');
      bound.forEach(c => lines.push(`| ${c.id} | ${c.ctype} | \`${c.attributes.ref}\` |`));
    }

    return lines.join('\n');
  }


  // ─── 공개 API ───

  function generate(xmlStr, fileName) {
    const { meta, sections } = XmlParser.parseDom(xmlStr);
    meta.file = fileName || '';
    return generateFromSections(meta, sections, XmlParser.analyze(sections));
  }

  function generateRegex(xmlStr, fileName) {
    const { meta, components } = XmlParser.parseRegex(xmlStr);
    meta.file = fileName || '';
    const visible = components.filter(c => !c.hidden);
    const rows = XmlParser.clusterRows(visible);
    const sections = rows.map(row => ({
      type: row.some(c => c.ctype === 'GridView') ? 'grid' :
            row.every(c => ['Button', 'Trigger'].includes(c.ctype)) ? 'standalone' : 'groupbox',
      comps: row, hidden: false, top: row[0].top,
    }));
    const analysis = {
      totalComponents: components.length, visibleComponents: visible.length,
      hiddenComponents: components.filter(c => c.hidden).length, sectionCount: sections.length,
      hasSearchBtn: visible.some(c => ['Button', 'Trigger'].includes(c.ctype) && /(조회|search)/i.test(c.label || '')),
    };
    return generateFromSections(meta, sections, analysis);
  }

  return { generate, generateRegex };
})();

// ─── Node.js CLI ───
if (typeof require !== 'undefined' && typeof process !== 'undefined' && process.argv) {
  try {
    const fs = require('fs');
    const path = require('path');
    if (typeof XmlParser === 'undefined') eval(fs.readFileSync(path.join(__dirname, 'xml-parser.js'), 'utf8'));
    const args = process.argv.slice(2);
    if (args.length > 0 && fs.existsSync(args[0])) {
      const inputPath = args[0];
      const oIdx = args.indexOf('-o');
      const outputDir = (oIdx >= 0 && args[oIdx + 1]) ? args[oIdx + 1] : path.dirname(path.resolve(inputPath));
      const md = WireframeGen.generateRegex(fs.readFileSync(inputPath, 'utf8'), path.basename(inputPath));
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const mdPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}_wireframe.md`);
      fs.writeFileSync(mdPath, md, 'utf8');
      console.log(`[완료] → ${mdPath}`);
    }
  } catch (e) { /* 브라우저에서는 무시 */ }
}
