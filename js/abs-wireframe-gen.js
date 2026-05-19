/**
 * 절대좌표 와이어프레임 생성기 (abs-wireframe-gen.js)
 *
 * XmlParser로 파싱한 절대좌표 XML을 원본 좌표 기반으로 시각화한다.
 * 변환 전 원본 구조를 있는 그대로 보여주는 것이 목적.
 *
 * AbsWireframeGen.generateHtml(xmlStr, fileName) → HTML 문자열
 * AbsWireframeGen.generateData(xmlStr, fileName) → 구조화 데이터
 */
const AbsWireframeGen = (() => {

  // ─── 컴포넌트 색상 ───
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
    TAB:              { bg: '#fdf2f8', border: '#ec4899', text: '#be185d' },
    Chart:            { bg: '#fff1f2', border: '#f43f5e', text: '#be123c' },
    Tree:             { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
    FavoriteTree:     { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
    WorkFlowTree:     { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
    Browser:          { bg: '#f8fafc', border: '#64748b', text: '#334155' },
    ActiveX:          { bg: '#f8fafc', border: '#64748b', text: '#334155' },
    WebViewControl:   { bg: '#f8fafc', border: '#64748b', text: '#334155' },
    Navigation:       { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
    Schedule:         { bg: '#ecfeff', border: '#06b6d4', text: '#155e75' },
    _default:  { bg: '#f8fafc', border: '#e2e8f0', text: '#475569' },
    _hidden:   { bg: '#f1f5f9', border: '#cbd5e1', text: '#94a3b8' },
    GroupBox:  { bg: 'transparent', border: '#94a3b8', text: '#64748b' },
  };

  function getColor(comp) {
    if (comp.hidden) return COMP_COLORS._hidden;
    return COMP_COLORS[comp.ctype] || COMP_COLORS._default;
  }

  // ─── 컴포넌트 짧은 라벨 ───
  function shortLabel(comp) {
    const label = comp.label || comp.id || '';
    const ctype = comp.ctype || '';
    if (ctype === 'Text' || ctype === 'Desc') return label || 'Text';
    if (ctype === 'Edit') return label || 'Edit';
    if (ctype === 'Calendar') return '📅 ' + (label || 'Cal');
    if (ctype === 'SelectBox' || ctype === 'Combo') return '▼ ' + (label || 'Select');
    if (ctype === 'CheckBox') return '☑ ' + (label || 'Chk');
    if (ctype === 'Radio') return '○ ' + (label || 'Radio');
    if (ctype === 'Button' || ctype === 'Trigger') return label || 'Btn';
    if (ctype === 'GridView') return 'Grid: ' + (comp.id || '');
    if (ctype === 'TextArea') return label || 'TextArea';
    return label || ctype;
  }

  // ─── 타입 배지 텍스트 ───
  function typeBadge(ctype) {
    const map = {
      Text: 'TXT', Desc: 'DESC', Edit: 'EDT', Calendar: 'CAL',
      SelectBox: 'SEL', Combo: 'CMB', CheckBox: 'CHK', Radio: 'RAD',
      Button: 'BTN', Trigger: 'BTN', GridView: 'GRID', TextArea: 'TXA',
      LinkText: 'LNK', Image: 'IMG', Output: 'OUT',
      TAB: 'TAB', Chart: 'CHT', Tree: 'TRE', FavoriteTree: 'TRE',
      WorkFlowTree: 'TRE', Browser: 'BRW', ActiveX: 'AX',
      Navigation: 'NAV', Schedule: 'SCH', WebViewControl: 'WEB',
    };
    return map[ctype] || ctype.substring(0, 3).toUpperCase();
  }


  // ─── 전체 컴포넌트 flat 추출 (GroupBox 포함) ───

  function extractAllComps(xmlStr) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');
    const root = doc.documentElement;
    const body = root.querySelector('body');

    const SKIP_TAGS = new Set([
      'script', 'model', 'datacollection', 'type', 'builddate', 'msa',
      'workflowcollection', 'keycollection', 'keyinfo', 'key',
    ]);
    function shouldSkip(tagFull) {
      const tag = tagFull.split(':').pop().toLowerCase();
      return SKIP_TAGS.has(tag) ||
        tagFull.includes(':model') || tagFull.includes(':type') ||
        tagFull.includes(':buildDate') || tagFull.includes(':MSA') ||
        tagFull.includes(':workflowCollection') || tagFull.includes(':dataCollection');
    }

    // 메타 정보
    const meta = { screenId: '', screenName: '', width: 1056, height: 750 };
    const head = root.querySelector('head');
    if (head) {
      meta.screenId = head.getAttribute('meta_screenId') || '';
      meta.screenName = head.getAttribute('meta_screenName') || '';
    }

    let mainGroup = null;
    if (body) {
      for (const child of body.children) {
        if (child.tagName.split(':').pop().toLowerCase() === 'group') {
          mainGroup = child;
          if (!meta.screenId) meta.screenId = child.getAttribute('screenno') || '';
          if (!meta.screenName) meta.screenName = child.getAttribute('screentitle') || '';
          const style = XmlParser.parseStyle(child.getAttribute('style') || '');
          if (style.width) meta.width = style.width;
          if (style.height) meta.height = style.height;
          break;
        }
      }
    }

    const startEl = mainGroup || body || root;
    const allComps = [];
    const groupBoxes = [];

    function getCtype(el) {
      const tag = el.tagName.split(':').pop().toLowerCase();
      if (tag === 'inputcalendar') return 'Calendar';
      const ctype = el.getAttribute('ctype');
      if (ctype) return ctype;
      return {
        input: 'Edit', textbox: 'Text', trigger: 'Button',
        select1: 'SelectBox', checkbox: 'CheckBox', textarea: 'TextArea',
        gridview: 'GridView', group: 'Group', anchor: 'LinkText',
        inputcalendar: 'Calendar', output: 'Output', select: 'CheckBox',
      }[tag] || tag;
    }

    function getLabel(el) {
      for (const attr of ['label', 'indicator', 'value', 'text']) {
        const v = el.getAttribute(attr);
        if (v) return v;
      }
      return '';
    }

    function walk(parent, parentLeft, parentTop, parentHidden) {
      for (const el of parent.children) {
        if (shouldSkip(el.tagName)) continue;
        const style = XmlParser.parseStyle(el.getAttribute('style') || '');
        const ctype = getCtype(el);
        const id = el.getAttribute('id') || el.getAttribute('orgid') || '';
        const label = getLabel(el);
        const isHidden = (style.visibility === 'hidden' || style.display === 'none') || parentHidden;

        const absLeft = parentLeft + (style.left || 0);
        const absTop = parentTop + (style.top || 0);

        if (ctype === 'GroupBox') {
          // GroupBox 안에 title_h2가 있으면 그 label 사용
          let gbLabel = label;
          const titleEl = el.querySelector('.title_h2') || el.querySelector('[class*="title_h2"]');
          if (titleEl) {
            gbLabel = titleEl.getAttribute('label') || gbLabel;
          }
          groupBoxes.push({
            id, label: gbLabel,
            left: absLeft, top: absTop,
            width: style.width || 0, height: style.height || 0,
            hidden: isHidden,
          });
          walk(el, absLeft, absTop, isHidden);
          continue;
        }

        const tag = el.tagName.split(':').pop().toLowerCase();
        if (tag === 'group' && el.children.length > 0 && style.left != null) {
          // 일반 Group (grd_wrap 등) — 경계 기록 + 자식 순회
          groupBoxes.push({
            id, label: label || id,
            left: absLeft, top: absTop,
            width: style.width || 0, height: style.height || 0,
            hidden: isHidden,
          });
          walk(el, absLeft, absTop, isHidden);
          continue;
        }

        if (tag === 'group' && el.children.length > 0 && style.left == null) {
          // 좌표 없는 Group — 부모 좌표 그대로 순회
          walk(el, parentLeft, parentTop, isHidden);
          continue;
        }

        if (style.left == null && style.top == null) {
          // 좌표 없는 일반 컴포넌트 — 건너뛰기
          if (el.children.length > 0) walk(el, parentLeft, parentTop, isHidden);
          continue;
        }

        allComps.push({
          id, ctype, label,
          left: absLeft, top: absTop,
          width: style.width || 0, height: style.height || 0,
          hidden: isHidden,
          isTitle: id && id.startsWith('title_'),
          ref: el.getAttribute('ref') || '',
        });

        // GridView 컬럼 정보
        if (ctype === 'GridView' || ctype === 'IBSheet') {
          const comp = allComps[allComps.length - 1];
          comp.ctype = 'GridView';
          comp.columns = [];
          const headerEl = el.querySelector('header');
          if (headerEl) {
            for (const col of headerEl.querySelectorAll('column')) {
              const v = col.getAttribute('value');
              const w = col.getAttribute('width');
              if (v) comp.columns.push({ label: v, width: w ? parseInt(w) : 70 });
            }
          }
        }
      }
    }

    walk(startEl, 0, 0, false);

    return { meta, allComps, groupBoxes };
  }


  // ─── 와이어프레임 HTML 생성 ───

  function generateHtml(xmlStr, fileName) {
    const { meta, allComps, groupBoxes } = extractAllComps(xmlStr);
    const screenW = meta.width || 1056;
    const screenH = meta.height || 750;

    // 스케일 계산 (컨테이너 폭에 맞춤)
    const containerW = 1200;
    const scale = Math.min(containerW / screenW, 1.2);
    const scaledH = Math.ceil(screenH * scale);

    let html = '';

    // 헤더 정보
    html += `<div class="abs-wf-header">`;
    html += `<h3>${esc(meta.screenId)} — ${esc(meta.screenName)}</h3>`;
    html += `<div class="abs-wf-meta">`;
    html += `<span>파일: <strong>${esc(fileName || '')}</strong></span>`;
    html += `<span>크기: <strong>${screenW}px × ${screenH}px</strong></span>`;
    html += `<span>컴포넌트: <strong>${allComps.filter(c => !c.hidden).length}개</strong></span>`;
    if (allComps.filter(c => c.hidden).length > 0) {
      html += `<span>숨김: <strong>${allComps.filter(c => c.hidden).length}개</strong></span>`;
    }
    html += `</div></div>`;

    // 토글 버튼
    html += `<div class="abs-wf-toggle">`;
    html += `<button class="abs-wf-toggle-btn active" onclick="toggleAbsWfMode(this, 'label')">라벨</button>`;
    html += `<button class="abs-wf-toggle-btn" onclick="toggleAbsWfMode(this, 'id')">ID</button>`;
    html += `</div>`;

    // 범례
    html += `<div class="abs-wf-legend">`;
    const legendTypes = ['Text', 'Edit', 'Calendar', 'SelectBox', 'CheckBox', 'Button', 'GridView', 'TAB', 'Chart', 'Tree', 'Browser', 'Navigation', 'Schedule'];
    legendTypes.forEach(t => {
      const c = COMP_COLORS[t];
      html += `<span class="abs-wf-legend-item" style="background:${c.bg};border-color:${c.border};color:${c.text}">${typeBadge(t)} ${t}</span>`;
    });
    html += `<span class="abs-wf-legend-item" style="background:#f1f5f9;border-color:#cbd5e1;color:#94a3b8">Hidden</span>`;
    html += `</div>`;

    // 와이어프레임 캔버스
    html += `<div class="abs-wf-canvas-wrap">`;
    html += `<div class="abs-wf-canvas" style="width:${Math.ceil(screenW * scale)}px;height:${scaledH}px;position:relative;">`;

    // GroupBox 경계 먼저 렌더 (뒤쪽)
    groupBoxes.filter(g => !g.hidden && g.width > 0 && g.height > 0).forEach(g => {
      const l = Math.round(g.left * scale);
      const t = Math.round(g.top * scale);
      const w = Math.round(g.width * scale);
      const h = Math.round(g.height * scale);
      html += `<div class="abs-wf-groupbox" style="left:${l}px;top:${t}px;width:${w}px;height:${h}px;" title="GroupBox: ${esc(g.id)}">`;
      const gbDisplay = g.label ? `${esc(g.label)}${g.id ? ' (' + esc(g.id) + ')' : ''}` : esc(g.id || 'Group');
      html += `<span class="abs-wf-groupbox-label">${gbDisplay}</span>`;
      html += `</div>`;
    });

    // 컴포넌트 렌더
    allComps.forEach((comp, idx) => {
      const color = getColor(comp);
      const l = Math.round((comp.left || 0) * scale);
      const t = Math.round((comp.top || 0) * scale);
      const w = Math.max(Math.round((comp.width || 0) * scale), 20);
      const h = Math.max(Math.round((comp.height || 0) * scale), 16);
      const label = shortLabel(comp);
      const badge = typeBadge(comp.ctype);
      const hiddenClass = comp.hidden ? ' abs-wf-comp-hidden' : '';

      const tooltipLines = [
        `ID: ${comp.id}`,
        `타입: ${comp.ctype}`,
        comp.label ? `라벨: ${comp.label}` : '',
        `위치: (${comp.left}, ${comp.top})`,
        `크기: ${comp.width} × ${comp.height}`,
        comp.ref ? `바인딩: ${comp.ref}` : '',
        comp.hidden ? '(숨김)' : '',
      ].filter(Boolean).join('\n');

      html += `<div class="abs-wf-comp${hiddenClass}" data-idx="${idx}" style="left:${l}px;top:${t}px;width:${w}px;height:${h}px;background:${color.bg};border-color:${color.border};color:${color.text};" title="${esc(tooltipLines)}">`;
      html += `<span class="abs-wf-comp-badge" style="background:${color.border};color:${color.text}">${badge}</span>`;
      const maxLen = w > 40 ? Math.floor((w - 30) / 6) : 0;
      if (w > 40) {
        const displayLabel = label.length > maxLen ? label.substring(0, maxLen) + '..' : label;
        html += `<span class="abs-wf-comp-label abs-wf-show-label">${esc(displayLabel)}</span>`;
      }
      // ID는 항상 표시 (토글로 전환)
      const idText = comp.id || '';
      html += `<span class="abs-wf-comp-label abs-wf-show-id" style="display:none;">${esc(idText)}</span>`;
      html += `</div>`;
    });

    html += `</div></div>`;

    return html;
  }


  // ─── 데이터 반환 (외부 사용) ───

  function generateData(xmlStr, fileName) {
    const { meta, allComps, groupBoxes } = extractAllComps(xmlStr);
    meta.file = fileName || '';
    return { meta, allComps, groupBoxes };
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { generateHtml, generateData };
})();
