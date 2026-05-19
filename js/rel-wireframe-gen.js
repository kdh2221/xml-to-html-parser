/**
 * 상대좌표 와이어프레임 HTML 생성기 (rel-wireframe-gen.js)
 *
 * 절대좌표 XML을 파싱 → 변환 규칙(skill MD) 기반으로
 * 상대좌표 템플릿 구조(.schbox, .tblbox, .gvwbox 등)를 HTML로 시각화한다.
 *
 * XmlParser.parseDom()으로 섹션을 분류하고,
 * WireframeGen.buildOutputItems()와 동일 로직으로 outputItems를 구성한 뒤
 * 템플릿 레이아웃을 HTML로 렌더링한다.
 *
 * RelWireframeGen.generateHtml(xmlStr, fileName) → HTML 문자열
 */
const RelWireframeGen = (() => {

  // ─── 컴포넌트 색상 (abs-wireframe-gen.js와 동일) ───
  const COMP_COLORS = {
    Text:      { bg: '#f0f9ff', border: '#bae6fd', text: '#0369a1' },
    Desc:      { bg: '#f0f9ff', border: '#bae6fd', text: '#0369a1' },
    Edit:      { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
    Calendar:  { bg: '#fefce8', border: '#fde68a', text: '#92400e' },
    SelectBox: { bg: '#faf5ff', border: '#e9d5ff', text: '#7e22ce' },
    Combo:     { bg: '#faf5ff', border: '#e9d5ff', text: '#7e22ce' },
    CheckBox:  { bg: '#fdf4ff', border: '#f5d0fe', text: '#a21caf' },
    Radio:     { bg: '#fdf4ff', border: '#f5d0fe', text: '#a21caf' },
    Button:    { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
    Trigger:   { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
    TextArea:  { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
    GridView:  { bg: '#eef2ff', border: '#c7d2fe', text: '#4338ca' },
    LinkText:  { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
    Image:     { bg: '#fefce8', border: '#fde68a', text: '#a16207' },
    Output:    { bg: '#f8fafc', border: '#e2e8f0', text: '#475569' },
    _default:  { bg: '#f8fafc', border: '#e2e8f0', text: '#475569' },
  };

  function getColor(ctype) {
    return COMP_COLORS[ctype] || COMP_COLORS._default;
  }

  // ─── 섹션 색상 ───
  const SECTION_COLORS = {
    schbox:  { bg: '#eff6ff', border: '#3b82f6', label: '조회조건', icon: '🔍' },
    tblbox:  { bg: '#f0fdf4', border: '#22c55e', label: '테이블폼', icon: '📋' },
    gvwbox:  { bg: '#eef2ff', border: '#6366f1', label: '그리드',   icon: '📊' },
    titbox:  { bg: '#fefce8', border: '#eab308', label: '타이틀',   icon: '📌' },
    title:   { bg: '#fefce8', border: '#eab308', label: '타이틀',   icon: '📌' },
    btnbox:  { bg: '#fff7ed', border: '#f97316', label: '버튼',     icon: '🔘' },
    btngroup:{ bg: '#fff7ed', border: '#f97316', label: '버튼',     icon: '🔘' },
    tbcbox:  { bg: '#fdf2f8', border: '#ec4899', label: '탭',       icon: '📑' },
    chartbox:{ bg: '#fff1f2', border: '#f43f5e', label: '차트',     icon: '📈' },
    tvwbox:  { bg: '#ecfdf5', border: '#10b981', label: '트리',     icon: '🌳' },
    hidden_field: { bg: '#f1f5f9', border: '#94a3b8', label: '숨김필드', icon: '👁' },
  };

  // ─── 그리드 버튼 판별 ───
  const GRID_BTN_RE = /행추가|행삭제|행복사|엑셀|excel|다운로드|download|업로드|upload|인쇄|print|보고서|초기화|reset|copy|row_add|row_del/i;
  function isGridBtn(c) {
    return ['Button', 'Trigger'].includes(c.ctype) &&
      (GRID_BTN_RE.test(c.label || '') || GRID_BTN_RE.test(c.id || '') || GRID_BTN_RE.test(c.attributes?.text || ''));
  }

  // ─── 컴포넌트 표시 텍스트 ───
  function compDisplay(comp) {
    const c = comp.ctype || '';
    const label = comp.label || comp.id || '';
    switch (c) {
      case 'Text': case 'Desc': return label || 'Text';
      case 'Edit': return label || 'Edit';
      case 'Calendar': return '📅 ' + (label || 'Cal');
      case 'SelectBox': case 'Combo': return '▼ ' + (label || 'Select');
      case 'CheckBox': return '☑ ' + label;
      case 'Radio': return '○ ' + label;
      case 'Button': case 'Trigger': return label || 'Btn';
      case 'GridView': return 'Grid: ' + (comp.id || '');
      case 'TextArea': return label || 'TextArea';
      default: return label || c;
    }
  }

  function typeBadge(ctype) {
    const map = {
      Text: 'TXT', Desc: 'DESC', Edit: 'EDT', Calendar: 'CAL',
      SelectBox: 'SEL', Combo: 'CMB', CheckBox: 'CHK', Radio: 'RAD',
      Button: 'BTN', Trigger: 'BTN', GridView: 'GRID', TextArea: 'TXA',
      LinkText: 'LNK', Image: 'IMG', Output: 'OUT',
    };
    return map[ctype] || ctype.substring(0, 3).toUpperCase();
  }


  // ─── buildOutputItems (wireframe-gen.js 로직 재사용) ───

  function buildOutputItems(sections, analysis) {
    const items = [];
    const hiddenComps = [];

    let i = 0;
    while (i < sections.length) {
      const section = sections[i];
      if (section.hidden) { section.comps.forEach(c => hiddenComps.push(c)); i++; continue; }

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

    // btngroup → 뒤에 콘텐츠 없으면 last
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
      if (item.type === 'btngroup' && item.isLast) {
        merged.push({ type: 'btnbox', comps: item.comps });
        mi++; continue;
      }
      merged.push(item);
      mi++;
    }

    return { items: merged, hiddenComps };
  }


  // ─── 컴포넌트 칩 HTML ───

  function compChip(comp) {
    const color = getColor(comp.ctype);
    const badge = typeBadge(comp.ctype);
    const label = esc(compDisplay(comp));
    const tooltip = [
      `ID: ${comp.id}`, `타입: ${comp.ctype}`,
      comp.label ? `라벨: ${comp.label}` : '',
      comp.attributes?.ref ? `바인딩: ${comp.attributes.ref}` : '',
    ].filter(Boolean).join('\n');

    return `<span class="rel-wf-chip" style="background:${color.bg};border-color:${color.border};color:${color.text}" title="${esc(tooltip)}">` +
      `<span class="rel-wf-chip-badge" style="background:${color.border};color:${color.text}">${badge}</span>` +
      `<span class="rel-wf-show-label">${label}</span>` +
      `<span class="rel-wf-show-id" style="display:none;">${esc(comp.id || '')}</span>` +
      `</span>`;
  }


  // ─── 테이블 Row 렌더 (th/td 구조) ───

  function renderTableRows(comps) {
    const rows = XmlParser.clusterRows(comps);
    if (!rows.length) return '';

    const rowCells = rows.map(row => XmlParser.rowToCells(row));
    const maxCols = Math.max(...rowCells.map(c => c.length));

    let html = '<table class="rel-wf-table">';

    // colgroup
    html += '<colgroup>';
    for (let ci = 0; ci < maxCols; ci++) {
      // 패턴에서 th/td 판별
      const sample = rowCells.find(cells => cells[ci]);
      const isThCol = sample && sample[ci] && sample[ci].type === 'th';
      html += isThCol ? '<col style="width:150px">' : '<col>';
    }
    html += '</colgroup>';

    rowCells.forEach(cells => {
      html += '<tr>';
      const deficit = maxCols - cells.length;
      cells.forEach((cell, ci) => {
        const isLast = ci === cells.length - 1;
        const colspan = (isLast && deficit > 0) ? ` colspan="${deficit + 1}"` : '';
        if (cell.type === 'th') {
          html += `<th class="rel-wf-th"${colspan}>`;
          cell.comps.forEach(c => { html += compChip(c); });
          html += '</th>';
        } else {
          html += `<td class="rel-wf-td"${colspan}>`;
          cell.comps.forEach(c => { html += compChip(c); });
          html += '</td>';
        }
      });
      html += '</tr>';
    });

    html += '</table>';
    return html;
  }


  // ─── 메인: HTML 생성 ───

  function generateHtml(xmlStr, fileName) {
    const { meta, sections } = XmlParser.parseDom(xmlStr);
    const analysis = XmlParser.analyze(sections);
    const { items, hiddenComps } = buildOutputItems(sections, analysis);

    let html = '';

    // 헤더
    html += `<div class="rel-wf-header">`;
    html += `<h3>상대좌표 템플릿 — ${esc(meta.screenId)} ${esc(meta.screenName)}</h3>`;
    html += `<div class="rel-wf-meta">`;
    html += `<span>파일: <strong>${esc(fileName || '')}</strong></span>`;
    html += `<span>섹션: <strong>${items.length}개</strong></span>`;
    html += `<span>컴포넌트: <strong>${analysis.visibleComponents}개</strong></span>`;
    if (hiddenComps.length) html += `<span>숨김: <strong>${hiddenComps.length}개</strong></span>`;
    html += `</div></div>`;

    // 구조: .sub_contents.flex_cont
    html += `<div class="rel-wf-container">`;
    html += `<div class="rel-wf-root-label">.sub_contents.flex_cont</div>`;

    items.forEach((item, idx) => {
      const sc = SECTION_COLORS[item.type] || SECTION_COLORS.tblbox;

      if (item.type === 'title') {
        html += `<div class="rel-wf-section" style="border-color:${sc.border}">`;
        html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
        html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.titbox</span>`;
        html += `<span class="rel-wf-section-label">${esc(item.label)}</span>`;
        html += `</div>`;
        html += `<div class="rel-wf-section-body">`;
        html += `<div class="rel-wf-titbox-text">${esc(item.label)}</div>`;
        html += `</div></div>`;

      } else if (item.type === 'titbox') {
        html += `<div class="rel-wf-section" style="border-color:${sc.border}">`;
        html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
        html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.titbox</span>`;
        html += `<span class="rel-wf-section-label">${item.label ? esc(item.label) + ' + 버튼' : '중간 버튼'}</span>`;
        html += `</div>`;
        html += `<div class="rel-wf-section-body rel-wf-titbox">`;
        if (item.label) html += `<div class="rel-wf-titbox-text">${esc(item.label)}</div>`;
        html += `<div class="rel-wf-titbox-rt">.rt`;
        (item.btns || []).forEach(b => { html += compChip(b); });
        html += `</div></div></div>`;

      } else if (item.type === 'schbox') {
        html += `<div class="rel-wf-section" style="border-color:${sc.border}">`;
        html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
        html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.schbox</span>`;
        html += `<span class="rel-wf-section-label">조회조건${item.groupId ? ' — ' + esc(item.groupId) : ''}</span>`;
        html += `</div>`;
        html += `<div class="rel-wf-section-body">`;
        html += `<div class="rel-wf-inner-label">.schbox_inner > .w2tb.tbl</div>`;
        html += renderTableRows(item.comps || []);
        if (item.btns && item.btns.length) {
          html += `<div class="rel-wf-btn-area"><span class="rel-wf-inner-label">.btn_schbox</span>`;
          item.btns.forEach(b => { html += compChip(b); });
          html += `</div>`;
        }
        html += `</div></div>`;

      } else if (item.type === 'tblbox') {
        html += `<div class="rel-wf-section" style="border-color:${sc.border}">`;
        html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
        html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.tblbox</span>`;
        html += `<span class="rel-wf-section-label">테이블폼${item.groupId ? ' — ' + esc(item.groupId) : ''}</span>`;
        html += `</div>`;
        html += `<div class="rel-wf-section-body">`;
        html += `<div class="rel-wf-inner-label">.w2tb.tbl</div>`;
        html += renderTableRows(item.comps || []);
        html += `</div></div>`;

      } else if (item.type === 'gvwbox') {
        const g = item.grid;
        html += `<div class="rel-wf-section" style="border-color:${sc.border}">`;
        html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
        html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.gvwbox</span>`;
        html += `<span class="rel-wf-section-label">그리드 — ${esc(g?.id || '')}</span>`;
        html += `</div>`;
        html += `<div class="rel-wf-section-body">`;
        html += `<div class="rel-wf-grid-box">`;
        html += `<div class="rel-wf-grid-header">`;
        html += `<span class="rel-wf-grid-id">${esc(g?.id || '')}</span>`;
        html += `<span class="rel-wf-grid-info">class="gvw" style="width:100%; height:150px;"</span>`;
        html += `</div>`;
        if (g?.columns?.length) {
          html += `<div class="rel-wf-grid-cols">`;
          g.columns.forEach(col => {
            html += `<span class="rel-wf-grid-col">${esc(col.label)}<small>${col.width}px</small></span>`;
          });
          html += `</div>`;
        }
        html += `<div class="rel-wf-grid-body">(데이터 영역 — height:150px)</div>`;
        html += `</div></div></div>`;

      } else if (item.type === 'btnbox') {
        html += `<div class="rel-wf-section" style="border-color:${sc.border}">`;
        html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
        html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.btnbox</span>`;
        html += `<span class="rel-wf-section-label">하단 버튼</span>`;
        html += `</div>`;
        html += `<div class="rel-wf-section-body">`;
        html += `<div class="rel-wf-btn-area rel-wf-btn-right"><span class="rel-wf-inner-label">.rt</span>`;
        (item.comps || []).forEach(b => { html += compChip(b); });
        html += `</div></div></div>`;
      }
    });

    // Hidden fields
    if (hiddenComps.length) {
      html += `<div class="rel-wf-section rel-wf-hidden-section">`;
      html += `<div class="rel-wf-section-header" style="background:#f1f5f9;border-color:#94a3b8">`;
      html += `<span class="rel-wf-section-badge" style="background:#94a3b8">hidden</span>`;
      html += `<span class="rel-wf-section-label">숨김 필드 (${hiddenComps.length}개)</span>`;
      html += `</div>`;
      html += `<div class="rel-wf-section-body rel-wf-hidden-body">`;
      const seen = new Set();
      hiddenComps.forEach(c => {
        if (!c.id || seen.has(c.id)) return;
        seen.add(c.id);
        html += compChip(c);
      });
      html += `</div></div>`;
    }

    html += `</div>`; // .rel-wf-container

    return html;
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * 변환된 XML을 직접 파싱하여 와이어프레임 생성 (샘플 기반 변환 결과용)
   */
  function generateFromConverted(convertedXml, fileName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(convertedXml, 'text/xml');
    const root = doc.documentElement;
    const body = root.querySelector('body');
    if (!body) return '<div class="empty-state">변환 결과를 파싱할 수 없습니다.</div>';

    // 메인 그룹 (sub_contents)
    let mainGroup = null;
    for (const child of body.children) {
      if (child.tagName.split(':').pop().toLowerCase() === 'group') {
        mainGroup = child; break;
      }
    }
    if (!mainGroup) return '<div class="empty-state">메인 그룹을 찾을 수 없습니다.</div>';

    const screenId = mainGroup.getAttribute('screenno') || mainGroup.getAttribute('id') || '';
    const screenName = mainGroup.getAttribute('screentitle') || '';
    const mainClass = mainGroup.getAttribute('class') || '';

    let html = '';

    // 헤더
    html += `<div class="rel-wf-header">`;
    html += `<h3>상대좌표 변환 결과 — ${esc(screenId)} ${esc(screenName)}</h3>`;
    html += `<div class="rel-wf-meta">`;
    html += `<span>파일: <strong>${esc(fileName || '')}</strong></span>`;
    html += `<span>변환 엔진: <strong>샘플 기반</strong></span>`;
    html += `</div></div>`;

    // 토글 버튼
    html += `<div class="rel-wf-toggle">`;
    html += `<button class="rel-wf-toggle-btn active" onclick="toggleRelWfMode(this, 'label')">라벨</button>`;
    html += `<button class="rel-wf-toggle-btn" onclick="toggleRelWfMode(this, 'id')">ID</button>`;
    html += `<button class="rel-wf-tdids-btn" onclick="toggleRelWfTdIds(this)">셀 ID</button>`;
    html += `</div>`;

    html += `<div class="rel-wf-container">`;
    html += `<div class="rel-wf-root-label">.${esc(mainClass).replace(/\s+/g, '.')}</div>`;

    // 자식 섹션 순회 — 디스패처를 통해 미지 class/직계 컴포넌트까지 모두 렌더
    for (const child of mainGroup.children) {
      html += dispatchChildSection(child);
    }

    html += `</div>`;
    return html;
  }

  /** 자식 요소를 class/ctype 기반으로 적절한 섹션 렌더러에 위임.
   *  알려지지 않은 class나 직계 컴포넌트도 누락 없이 표현한다. */
  function dispatchChildSection(child) {
    const tag = child.tagName.split(':').pop().toLowerCase();
    if (!tag || tag === 'parsererror') return '';

    // 직계 non-group 컴포넌트 → 칩으로 표시
    if (tag !== 'group') {
      const chip = compChipFromDom(child, false);
      return chip ? `<div class="rel-wf-loose-chip">${chip}</div>` : '';
    }

    const cls = child.getAttribute('class') || '';
    if (cls.includes('lybox')) return renderHorizontalFromDom(child);
    if (cls.includes('titbox')) return renderTitboxFromDom(child);
    if (cls.includes('tblbox')) return renderTblboxFromDom(child);
    if (cls.includes('gvwbox')) return renderGvwboxFromDom(child);
    if (cls.includes('btnbox')) return renderBtnboxFromDom(child);
    if (cls.includes('schbox')) return renderSchboxFromDom(child);
    if (cls.includes('msgbox')) return renderMsgboxFromDom(child);
    if (cls.includes('tbcbox')) return renderTbcboxFromDom(child);
    if (cls.includes('chartbox')) return renderBlockSectionFromDom(child, 'chartbox');
    if (cls.includes('tvwbox')) return renderBlockSectionFromDom(child, 'tvwbox');
    if (cls.includes('hidden_field')) return renderHiddenFieldFromDom(child);
    if (cls.includes('grpbox_wrap')) return renderGrpboxWrapFromDom(child);

    // ctype 있는 group은 단일 컴포넌트(Chart/Tree/TAB 등) — 칩으로
    if (child.getAttribute('ctype')) {
      const chip = compChipFromDom(child, false);
      return chip ? `<div class="rel-wf-loose-chip">${chip}</div>` : '';
    }

    // 알려지지 않은 래퍼 group → 제네릭 섹션으로 표현
    return renderGenericGroupFromDom(child);
  }

  /** grpbox_wrap: 분할된 tblbox/msgbox 등을 감싸는 컨테이너 */
  function renderGrpboxWrapFromDom(el) {
    const id = el.getAttribute('id') || '';
    let html = `<div class="rel-wf-section" style="border-color:#64748b">`;
    html += `<div class="rel-wf-section-header" style="background:#f8fafc;border-color:#64748b">`;
    html += `<span class="rel-wf-section-badge" style="background:#64748b">.grpbox_wrap</span>`;
    html += `<span class="rel-wf-section-label">${esc(id) || '그룹 래퍼'}</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;
    for (const child of el.children) {
      html += dispatchChildSection(child);
    }
    html += `</div></div>`;
    return html;
  }

  /** 미지 class 또는 class 없는 래퍼 group — 누락 방지용 제네릭 섹션 */
  function renderGenericGroupFromDom(el) {
    const cls = (el.getAttribute('class') || '').trim();
    const id = el.getAttribute('id') || '';
    const badgeText = cls ? '.' + cls.split(/\s+/).join('.') : 'group';
    let html = `<div class="rel-wf-section" style="border-color:#94a3b8">`;
    html += `<div class="rel-wf-section-header" style="background:#f1f5f9;border-color:#94a3b8">`;
    html += `<span class="rel-wf-section-badge" style="background:#94a3b8">${esc(badgeText)}</span>`;
    html += `<span class="rel-wf-section-label">${esc(id) || '(미분류 그룹)'}</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;

    let chipsHtml = '';
    for (const child of el.children) {
      const childTag = child.tagName.split(':').pop().toLowerCase();
      if (childTag === 'attributes') continue;
      if (childTag === 'group' && !child.getAttribute('ctype')) {
        // 중첩 래퍼/섹션 → 디스패처로 재귀
        html += flushChips(chipsHtml); chipsHtml = '';
        html += dispatchChildSection(child);
      } else {
        chipsHtml += compChipFromDom(child, false);
      }
    }
    html += flushChips(chipsHtml);
    html += `</div></div>`;
    return html;
  }

  function flushChips(chipsHtml) {
    return chipsHtml ? `<div class="rel-wf-generic-chips">${chipsHtml}</div>` : '';
  }

  // ─── DOM 기반 섹션 렌더러 ───

  /** 섹션 헤더에 wrapper id 표시 */
  function sectionIdBadge(el) {
    const id = el.getAttribute('id') || '';
    return `<span class="rel-wf-show-id rel-wf-section-id" style="display:none;">${esc(id)}</span>`;
  }

  function renderTitboxFromDom(el) {
    const sc = SECTION_COLORS.titbox;
    const textEl = el.querySelector('textbox');
    const label = textEl ? (textEl.getAttribute('label') || '') : '';
    let html = `<div class="rel-wf-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.titbox</span>`;
    html += `<span class="rel-wf-section-label">${esc(label)}</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;
    html += `<div class="rel-wf-titbox-text">${esc(label)}</div>`;
    html += `</div></div>`;
    return html;
  }

  function renderTblboxFromDom(el) {
    const sc = SECTION_COLORS.tblbox;
    const tableEl = el.querySelector('[tagname="table"]');
    let html = `<div class="rel-wf-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.tblbox</span>`;
    html += `<span class="rel-wf-section-label">테이블폼</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;
    html += `<div class="rel-wf-inner-label">.w2tb.tbl (adaptive)</div>`;

    if (tableEl) {
      html += '<table class="rel-wf-table">';
      // colgroup
      const colgroup = tableEl.querySelector('[tagname="colgroup"]');
      if (colgroup) {
        html += '<colgroup>';
        for (const col of colgroup.children) {
          const style = col.getAttribute('style') || '';
          html += `<col style="${esc(style)}">`;
        }
        html += '</colgroup>';
      }
      // rows
      for (const row of tableEl.children) {
        if ((row.getAttribute('tagname') || '') !== 'tr') continue;
        html += '<tr>';
        for (const cell of row.children) {
          const tagname = cell.getAttribute('tagname') || '';
          const cellClass = cell.getAttribute('class') || '';
          if (tagname === 'th' || cellClass.includes('w2tb_th')) {
            const colspanAttr = getW2Colspan(cell);
            html += `<th class="rel-wf-th"${colspanAttr}>`;
            html += renderCellComps(cell);
            html += '</th>';
          } else if (tagname === 'td' || cellClass.includes('w2tb_td')) {
            const colspanAttr = getW2Colspan(cell);
            html += `<td class="rel-wf-td"${colspanAttr}>`;
            html += renderCellComps(cell);
            const ids = collectCellIds(cell);
            if (ids.length) html += `<div class="rel-wf-td-ids">${ids.map(id => esc(id)).join(', ')}</div>`;
            html += '</td>';
          }
        }
        html += '</tr>';
      }
      html += '</table>';
    }

    html += `</div></div>`;
    return html;
  }

  function renderGvwboxFromDom(el) {
    const sc = SECTION_COLORS.gvwbox;
    const gridEl = el.querySelector('gridView') || el.querySelector('[ctype="IBSheet"]');
    const gridId = gridEl ? (gridEl.getAttribute('id') || '') : '';
    const gridStyle = gridEl ? (gridEl.getAttribute('style') || '') : '';

    let html = `<div class="rel-wf-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.gvwbox</span>`;
    html += `<span class="rel-wf-section-label">그리드 — ${esc(gridId)}</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;
    html += `<div class="rel-wf-grid-box">`;
    html += `<div class="rel-wf-grid-header">`;
    html += `<span class="rel-wf-grid-id">${esc(gridId)}</span>`;
    html += `<span class="rel-wf-grid-info">class="gvw" ${esc(gridStyle)}</span>`;
    html += `</div>`;

    // 컬럼 헤더
    if (gridEl) {
      const headerEl = gridEl.querySelector('header');
      if (headerEl) {
        const columns = headerEl.querySelectorAll('column');
        if (columns.length) {
          html += `<div class="rel-wf-grid-cols">`;
          columns.forEach(col => {
            const val = col.getAttribute('value') || '';
            const w = col.getAttribute('width') || '';
            html += `<span class="rel-wf-grid-col">${esc(val)}<small>${w}px</small></span>`;
          });
          html += `</div>`;
        }
      }
    }

    html += `<div class="rel-wf-grid-body">(데이터 영역)</div>`;
    html += `</div></div></div>`;
    return html;
  }

  function renderBtnboxFromDom(el) {
    const sc = SECTION_COLORS.btnbox;
    let html = `<div class="rel-wf-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.btnbox</span>`;
    html += `<span class="rel-wf-section-label">버튼</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;

    // .lt 영역
    const ltGroup = findChildByClass(el, 'lt');
    if (ltGroup) {
      html += `<div class="rel-wf-btn-area"><span class="rel-wf-inner-label">.lt (숨김 필드)</span>`;
      for (const comp of ltGroup.children) {
        html += compChipFromDom(comp, true);
      }
      html += `</div>`;
    }

    // .rt 영역
    const rtGroup = findChildByClass(el, 'rt');
    if (rtGroup) {
      html += `<div class="rel-wf-btn-area rel-wf-btn-right"><span class="rel-wf-inner-label">.rt</span>`;
      for (const comp of rtGroup.children) {
        html += compChipFromDom(comp, false);
      }
      html += `</div>`;
    }

    // .lt/.rt 없이 직접 자식인 경우
    if (!ltGroup && !rtGroup) {
      html += `<div class="rel-wf-btn-area">`;
      for (const comp of el.children) {
        html += compChipFromDom(comp, false);
      }
      html += `</div>`;
    }

    html += `</div></div>`;
    return html;
  }

  function renderSchboxFromDom(el) {
    const sc = SECTION_COLORS.schbox;
    let html = `<div class="rel-wf-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.schbox</span>`;
    html += `<span class="rel-wf-section-label">조회조건</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;

    // .schbox_inner 내부 테이블
    const innerEl = [...el.children].find(c => (c.getAttribute('class') || '').includes('schbox_inner'));
    if (innerEl) {
      html += `<div class="rel-wf-inner-label">.schbox_inner > .w2tb.tbl</div>`;
      const tableEl = innerEl.querySelector('[tagname="table"]');
      if (tableEl) {
        html += '<table class="rel-wf-table">';
        const colgroup = tableEl.querySelector('[tagname="colgroup"]');
        if (colgroup) {
          html += '<colgroup>';
          for (const col of colgroup.children) {
            html += `<col style="${esc(col.getAttribute('style') || '')}">`;
          }
          html += '</colgroup>';
        }
        for (const row of tableEl.children) {
          if ((row.getAttribute('tagname') || '') !== 'tr') continue;
          html += '<tr>';
          for (const cell of row.children) {
            const tagname = cell.getAttribute('tagname') || '';
            const cellClass = cell.getAttribute('class') || '';
            if (tagname === 'th' || cellClass.includes('w2tb_th')) {
              const colspanAttr = getW2Colspan(cell);
              html += `<th class="rel-wf-th"${colspanAttr}>`;
              html += renderCellComps(cell);
              html += '</th>';
            } else if (tagname === 'td' || cellClass.includes('w2tb_td')) {
              const colspanAttr = getW2Colspan(cell);
              html += `<td class="rel-wf-td"${colspanAttr}>`;
              html += renderCellComps(cell);
              const ids = collectCellIds(cell);
              if (ids.length) html += `<div class="rel-wf-td-ids">${ids.map(id => esc(id)).join(', ')}</div>`;
              html += '</td>';
            }
          }
          html += '</tr>';
        }
        html += '</table>';
      }
    }

    // .btn_schbox 버튼 영역
    const btnEl = [...el.children].find(c => (c.getAttribute('class') || '').includes('btn_schbox'));
    if (btnEl) {
      html += `<div class="rel-wf-btn-area"><span class="rel-wf-inner-label">.btn_schbox</span>`;
      for (const btn of btnEl.children) {
        const btnTag = btn.tagName.split(':').pop().toLowerCase();
        if (btnTag === 'group') continue;
        const btnId = btn.getAttribute('id') || '';
        const btnLabel = btn.querySelector('label');
        const label = btnLabel ? (btnLabel.textContent || '').trim() : (btn.getAttribute('text') || btnId);
        html += `<span class="rel-wf-btn">${esc(label)}</span>`;
      }
      html += `</div>`;
    }

    html += `</div></div>`;
    return html;
  }

  function renderHorizontalFromDom(el) {
    let html = `<div class="rel-wf-horizontal">`;
    html += `<div class="rel-wf-horizontal-label">.lybox</div>`;
    html += `<div class="rel-wf-horizontal-inner">`;
    for (const side of el.children) {
      const sideTag = side.tagName.split(':').pop().toLowerCase();
      if (sideTag !== 'group') continue;
      const colClass = side.getAttribute('class') || '';
      html += `<div class="rel-wf-horizontal-col">`;
      if (colClass) html += `<div class="rel-wf-horizontal-col-label">${esc(colClass)}</div>`;
      // 내부 섹션 순회 — 디스패처로 모든 섹션 타입 지원
      for (const child of side.children) {
        html += dispatchChildSection(child);
      }
      html += `</div>`;
    }
    html += `</div></div>`;
    return html;
  }

  function renderMsgboxFromDom(el) {
    let html = `<div class="rel-wf-section" style="border-color:#94a3b8">`;
    html += `<div class="rel-wf-section-header" style="background:#f1f5f9;border-color:#94a3b8">`;
    html += `<span class="rel-wf-section-badge" style="background:#94a3b8">.msgbox</span>`;
    html += `<span class="rel-wf-section-label">안내 메시지</span>`;
    html += `</div><div class="rel-wf-section-body">`;
    const textboxes = el.querySelectorAll('textbox');
    textboxes.forEach(tb => {
      const label = tb.getAttribute('label') || '';
      if (label) html += `<div style="font-size:12px;color:#64748b;padding:2px 0;">${esc(label)}</div>`;
    });
    html += `</div></div>`;
    return html;
  }

  /** 탭 컨트롤 섹션 (tbcbox) — 탭 라벨 + content별 내부 섹션 펼침 */
  function renderTbcboxFromDom(el) {
    const sc = SECTION_COLORS.tbcbox;
    let html = `<div class="rel-wf-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.tbcbox</span>`;
    html += `<span class="rel-wf-section-label">${sc.label}</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;

    // tabControl 찾기
    let tabControl = null;
    for (const child of el.querySelectorAll('*')) {
      const tag = child.tagName.split(':').pop().toLowerCase();
      if (tag === 'tabcontrol') { tabControl = child; break; }
    }

    if (tabControl) {
      // 탭 라벨 수집
      const tabLabels = [];
      for (const child of tabControl.children) {
        const tag = child.tagName.split(':').pop().toLowerCase();
        if (tag === 'tabs') {
          tabLabels.push(child.getAttribute('label') || child.getAttribute('id') || '');
        }
      }

      // 탭 pill 렌더링
      if (tabLabels.length) {
        html += `<div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;">`;
        tabLabels.forEach((lbl, idx) => {
          const active = idx === 0 ? `background:${sc.border};color:#fff;` : `background:${sc.bg};color:${sc.border};border:1px solid ${sc.border};`;
          html += `<span style="${active}padding:3px 12px;border-radius:999px;font-size:12px;font-weight:600;">${esc(lbl)}</span>`;
        });
        html += `</div>`;
      }

      // 각 w2:content (TABPAGE) 렌더링
      let contentIdx = 0;
      for (const child of tabControl.children) {
        const tag = child.tagName.split(':').pop().toLowerCase();
        if (tag !== 'content') continue;
        const contentId = child.getAttribute('id') || `content${contentIdx}`;
        const contentLabel = tabLabels[contentIdx] || contentId;

        html += `<div style="border:1px dashed ${sc.border};border-radius:6px;padding:8px;margin-bottom:6px;">`;
        html += `<div style="font-size:11px;font-weight:600;color:${sc.border};margin-bottom:4px;">${esc(contentLabel)}</div>`;

        // content 자식 순회 — 디스패처로 모든 섹션 타입 지원
        let hasContent = false;
        for (const inner of child.children) {
          const innerTag = inner.tagName.split(':').pop().toLowerCase();
          const innerCtype = inner.getAttribute('ctype') || '';

          // pageFrame 직접 자식
          if (innerCtype === 'Panel' || innerTag === 'pageframe') {
            const pfId = inner.getAttribute('id') || '';
            html += `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;font-size:12px;color:#64748b;">pageFrame: ${esc(pfId)}</div>`;
            hasContent = true;
            continue;
          }

          const sectionHtml = dispatchChildSection(inner);
          if (sectionHtml) { html += sectionHtml; hasContent = true; }
        }

        // pageFrame이 group 아닌 직접 자식일 수 있음
        if (!hasContent) {
          const pf = child.querySelector('[ctype="Panel"]');
          if (pf) {
            const pfId = pf.getAttribute('id') || '';
            html += `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;font-size:12px;color:#64748b;">pageFrame: ${esc(pfId)}</div>`;
          } else {
            html += `<div style="font-size:11px;color:#94a3b8;font-style:italic;">(콘텐츠 없음)</div>`;
          }
        }

        html += `</div>`;
        contentIdx++;
      }
    } else {
      // tabControl 없는 경우 폴백
      for (const child of el.children) {
        html += compChipFromDom(child, false);
      }
    }

    html += `</div></div>`;
    return html;
  }

  /** 블록 섹션 (chartbox, tvwbox) */
  function renderBlockSectionFromDom(el, sectionType) {
    const sc = SECTION_COLORS[sectionType] || SECTION_COLORS.tblbox;
    let html = `<div class="rel-wf-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">.${sectionType}</span>`;
    html += `<span class="rel-wf-section-label">${sc.label}</span>`;
    html += sectionIdBadge(el);
    html += `</div><div class="rel-wf-section-body">`;

    // 내부 컴포넌트 칩 출력 — compChipFromDom이 ctype/래퍼 재귀 모두 처리
    for (const child of el.children) {
      const tag = child.tagName.split(':').pop().toLowerCase();
      if (tag === 'attributes') continue;
      html += compChipFromDom(child, false);
    }

    html += `</div></div>`;
    return html;
  }

  /** hidden_field 섹션 */
  function renderHiddenFieldFromDom(el) {
    const sc = SECTION_COLORS.hidden_field;
    let html = `<div class="rel-wf-section rel-wf-hidden-section" style="border-color:${sc.border}">`;
    html += `<div class="rel-wf-section-header" style="background:${sc.bg};border-color:${sc.border}">`;
    html += `<span class="rel-wf-section-badge" style="background:${sc.border}">hidden</span>`;

    // 숨김 컴포넌트 수 세기
    let count = 0;
    for (const child of el.children) {
      const tag = child.tagName.split(':').pop().toLowerCase();
      if (tag !== 'group' || !(child.getAttribute('style') || '').includes('display:none')) count++;
      else count++;
    }
    html += `<span class="rel-wf-section-label">숨김 필드 (${count}개)</span>`;
    html += `</div><div class="rel-wf-section-body rel-wf-hidden-body">`;

    for (const child of el.children) {
      html += compChipFromDom(child, true);
    }

    html += `</div></div>`;
    return html;
  }

  // ─── DOM 헬퍼 ───

  function findChildByClass(el, cls) {
    for (const child of el.children) {
      if ((child.getAttribute('class') || '').includes(cls)) return child;
    }
    return null;
  }

  function getW2Colspan(cell) {
    const colspanEl = cell.querySelector('colspan');
    if (colspanEl) {
      const v = parseInt(colspanEl.textContent);
      if (v > 1) return ` colspan="${v}"`;
    }
    return '';
  }

  function collectCellIds(cell) {
    const ids = [];
    for (const child of cell.children) {
      const tag = child.tagName.split(':').pop().toLowerCase();
      if (tag === 'attributes') continue;
      if (tag === 'group') { ids.push(...collectCellIds(child)); continue; }
      const id = child.getAttribute('id') || '';
      if (id) ids.push(id);
    }
    return ids;
  }

  function renderCellComps(cell) {
    let html = '';
    for (const child of cell.children) {
      const tag = child.tagName.split(':').pop().toLowerCase();
      if (tag === 'attributes') continue; // w2:attributes 건너뛰기
      if (tag === 'group') { html += renderCellComps(child); continue; }
      html += compChipFromDom(child, false);
    }
    return html;
  }

  function compChipFromDom(el, isHidden) {
    const tag = el.tagName.split(':').pop().toLowerCase();
    const ctypeAttr = el.getAttribute('ctype') || '';

    // ctype 없는 일반 group은 래퍼로 간주하여 내부 재귀
    if (!ctypeAttr && tag === 'group') {
      let inner = '';
      for (const child of el.children) { inner += compChipFromDom(child, isHidden); }
      return inner;
    }

    const ctype = ctypeAttr || {
      input: 'Edit', textbox: 'Text', trigger: 'Button',
      select1: 'SelectBox', checkbox: 'CheckBox', textarea: 'TextArea',
      gridview: 'GridView', anchor: 'LinkText', inputcalendar: 'Calendar',
      output: 'Output', select: 'CheckBox',
    }[tag] || tag;

    const id = el.getAttribute('id') || '';
    const label = el.getAttribute('label') || el.getAttribute('indicator') || el.getAttribute('text') || id;

    const color = getColor(ctype);
    const badge = typeBadge(ctype);
    const displayLabel = compDisplay({ ctype, label, id });
    const style = el.getAttribute('style') || '';
    const hidden = style.includes('display:none') || isHidden;
    const opacity = hidden ? 'opacity:0.4;' : '';

    return `<span class="rel-wf-chip" style="background:${color.bg};border-color:${color.border};color:${color.text};${opacity}" title="ID: ${esc(id)}&#10;타입: ${esc(ctype)}&#10;${hidden ? '(숨김)' : ''}">` +
      `<span class="rel-wf-chip-badge" style="background:${color.border};color:${color.text}">${badge}</span>` +
      `<span class="rel-wf-show-label">${esc(displayLabel)}</span>` +
      `<span class="rel-wf-show-id" style="display:none;">${esc(id)}</span>` +
      `</span>`;
  }

  return { generateHtml, generateFromConverted };
})();
