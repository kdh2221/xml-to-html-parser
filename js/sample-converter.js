/**
 * 샘플 기반 WebSquare 절대좌표 → 상대좌표 변환 엔진 (sample-converter.js)
 *
 * 변환 흐름:
 *   1. XML 파싱 → 섹션 분류 (xml-parser.js)
 *   2. 겹침 감지 / 좌우 분할 감지 / standalone 병합
 *   3. 섹션 간 look-ahead: standalone 버튼 → 다음 섹션 titbox .rt에 합류
 *   4. processSection: 각 섹션을 outputItems로 변환
 *      - groupbox/standalone → Row 클러스터링 → th-td tblbox / titbox / msgbox / btngroup
 *      - grid → gvwbox (hidden이면 display:none)
 *      - tab → tbcbox (내부 재귀 변환)
 *      - Panel → self-closing pnlbox
 *   5. hidden 섹션 → 원래 구조 유지한 채 processSection 적용 → hidden_field에 배치
 *   6. 누락 ID 안전 복구
 *   7. XML 조립 + btnbox 출력
 *
 * class 매핑: samples/[KB국민은행] 전환 매핑 요소.xlsx 참조
 * 검색영역 판별: 첫 GroupBox + "조회"/"검색"/"초기화" 버튼 (정확 매칭)
 * 리스트형 테이블: Text Row + Form Row 2개 이상 연속 → thead/tbody
 * 단위 텍스트: 폼 요소 바로 옆(30px) %,~,-,/ 등 → 같은 td에 포함
 */
const SampleConverter = (() => {

  // ─── 태그 리네이밍 설정 ───
  // 원본 XML의 컴포넌트 태그는 기본적으로 그대로 보존된다.
  // 필요 시 아래 매핑에 규칙을 추가하면 변환 출력에서 태그명이 치환된다.
  // 예) xf:input → w2:kb_input 으로 바꾸려면 'xf:input': 'w2:kb_input' 추가.
  // 속성은 변경하지 않고 원본 그대로 유지한다.
  // 매핑이 비어 있으면 원본 태그 그대로 유지된다.
  const TAG_RENAME_MAP = {
    // 'xf:input': 'w2:kb_input',
    // 'xf:select1': 'w2:kb_selectbox',
    // 'w2:gridView': 'w2:kb_gridView',
  };

  /** 직렬화된 XML 문자열에 TAG_RENAME_MAP 적용 (태그명만 치환, 속성은 원본 유지). */
  function applyTagRename(xmlStr) {
    if (!xmlStr) return xmlStr;
    let out = xmlStr;
    for (const src of Object.keys(TAG_RENAME_MAP)) {
      const dst = TAG_RENAME_MAP[src];
      const srcEsc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`<${srcEsc}(\\s|/|>)`, 'g'), `<${dst}$1`);
      out = out.replace(new RegExp(`</${srcEsc}>`, 'g'), `</${dst}>`);
    }
    return out;
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── 스타일 파싱 ───
  function parseStyle(styleStr) {
    const result = {};
    if (!styleStr) return result;
    styleStr.split(';').forEach(prop => {
      prop = prop.trim();
      if (!prop || !prop.includes(':')) return;
      const idx = prop.indexOf(':');
      const key = prop.substring(0, idx).trim();
      const val = prop.substring(idx + 1).trim();
      result[key] = val;
    });
    return result;
  }

  function px(val) {
    if (!val) return 0;
    const m = String(val).match(/(-?\d+)/);
    return m ? parseInt(m[1]) : 0;
  }

  // ─── 속성 알파벳순 정렬 (샘플 패턴) ───
  // 단, ctype은 항상 첫 번째
  function sortAttrs(attrs) {
    const entries = Object.entries(attrs);
    return entries.sort((a, b) => {
      if (a[0] === 'ctype') return -1;
      if (b[0] === 'ctype') return 1;
      return a[0].localeCompare(b[0]);
    });
  }

  function buildAttrStr(attrs) {
    return sortAttrs(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  }

  // ─── 상수 ───
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

  const INPUT_TYPES = new Set([
    'Edit', 'Calendar', 'SelectBox', 'Combo', 'CheckBox', 'CheckButton',
    'TextArea', 'Button', 'Trigger', 'LinkText', 'Image', 'Output',
    'Radio', 'RadioButton',
  ]);

  // ─── DOM 파싱 헬퍼 ───

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

  // 원본 XML의 label에는 인스웨이브 Craft 산출물 특성상 리터럴 "&nbsp;" 문자열이
  // 섞여 들어오는 경우가 있다(원본 &amp;nbsp; → DOMParser 디코딩 결과).
  // 그대로 두면 XMLSerializer가 다시 &amp;nbsp;로 직렬화해 WebSquare/와이어프레임에
  // 그대로 "&nbsp;"가 노출되므로 일반 공백으로 치환한다.
  function sanitizeLabelText(s) {
    return String(s || '').replace(/&nbsp;/g, ' ').replace(/ /g, ' ');
  }

  function getLabel(el) {
    for (const attr of ['label', 'indicator', 'value', 'text']) {
      const v = el.getAttribute(attr);
      if (v) return sanitizeLabelText(v);
    }
    return '';
  }

  function isHidden(style) {
    return style['visibility'] === 'hidden' || style['display'] === 'none';
  }

  // ─── 컴포넌트 추출 ───

  function extractComp(el, parentHidden, parentLeft, parentTop) {
    parentLeft = parentLeft || 0;
    parentTop = parentTop || 0;
    const styleStr = el.getAttribute('style') || '';
    const style = parseStyle(styleStr);
    const ctype = getCtype(el);
    const id = el.getAttribute('id') || el.getAttribute('orgid') || '';
    // label 계열 속성을 일괄 정화하여 이후 cloneNode/직렬화 경로에서도 일관되게 깨끗한 값이 나가도록 한다.
    for (const a of ['label', 'indicator', 'value', 'text']) {
      const raw = el.getAttribute(a);
      if (raw) {
        const cleaned = sanitizeLabelText(raw);
        if (cleaned !== raw) el.setAttribute(a, cleaned);
      }
    }
    const label = getLabel(el);
    const hidden = isHidden(style) || parentHidden;

    const comp = {
      id, ctype, label, hidden,
      left: parentLeft + px(style.left), top: parentTop + px(style.top),
      width: px(style.width), height: px(style.height),
      el, // DOM 요소 참조 보존
      originalTag: el.tagName,
      attributes: {},
      innerXml: '',
      gridXml: '',
      columns: [],
    };

    // 속성 수집 (style, position 관련 제외)
    for (const attr of el.attributes) {
      if (attr.name === 'style') continue;
      comp.attributes[attr.name] = attr.value;
    }

    // GridView 처리
    if (ctype === 'IBSheet' || ctype === 'GridView') {
      comp.ctype = 'GridView';
      comp.gridXml = el.outerHTML || '';
      const headerEl = el.querySelector('header');
      if (headerEl) {
        for (const col of headerEl.querySelectorAll('column')) {
          const v = col.getAttribute('value');
          const w = col.getAttribute('width');
          if (v) comp.columns.push({ label: v, width: w ? parseInt(w) : 70 });
        }
      }
    }

    // 자식 XML 보존
    if (el.children.length > 0) {
      comp.innerXml = el.innerHTML || '';
    }

    return comp;
  }

  function hasFormInDescendants(el) {
    for (const child of el.children) {
      const ct = getCtype(child);
      if (INPUT_TYPES.has(ct) && ct !== 'Button' && ct !== 'Trigger' && ct !== 'LinkText') return true;
      if (child.children.length > 0 && hasFormInDescendants(child)) return true;
    }
    return false;
  }

  function walkChildren(parent, parentHidden, parentLeft, parentTop) {
    parentLeft = parentLeft || 0;
    parentTop = parentTop || 0;
    const comps = [];
    for (const el of parent.children) {
      if (shouldSkip(el.tagName)) continue;
      const style = parseStyle(el.getAttribute('style') || '');
      const ctype = getCtype(el);
      const elHidden = isHidden(style) || parentHidden;

      // 이 요소의 절대좌표
      const absLeft = parentLeft + px(style.left);
      const absTop = parentTop + px(style.top);

      if (ctype === 'GroupBox') {
        const childComps = walkChildren(el, elHidden, absLeft, absTop);
        // 셀 래퍼(kb_td_*/kb_th_*) class 를 자손 컴포넌트에 분류용 메타로 전파
        // — buildCompXml은 comp.el(원본 DOM)을 복제하므로 출력 XML에는 영향 없음
        const groupClass = el.getAttribute('class') || '';
        const cellMatch = groupClass.match(/\bkb_(?:th|td)_(?:head|body)(?:_right)?\b/);
        if (cellMatch) {
          const cellClass = cellMatch[0];
          childComps.forEach(c => {
            const existing = (c.attributes && c.attributes.class) || '';
            if (!/\bkb_(?:th|td)_(?:head|body)(?:_right)?\b/.test(existing)) {
              c.attributes.class = (existing ? existing + ' ' : '') + cellClass;
            }
          });
        }
        comps.push(...childComps);
        continue;
      }

      const tag = el.tagName.split(':').pop().toLowerCase();

      // wrapper group 처리: 안에 폼 요소 자식/손자가 있으면 벗기고 자식 추출
      if (tag === 'group' && ctype !== 'GroupBox' && el.children.length > 0) {
        const hasFormDescendant = hasFormInDescendants(el);
        if (hasFormDescendant) {
          comps.push(...walkChildren(el, elHidden, absLeft, absTop));
          continue;
        }
        // 폼 자식 없는 일반 group은 좌표 없으면 벗기기
        if (style.left == null && !style.left) {
          comps.push(...walkChildren(el, elHidden, absLeft, absTop));
          continue;
        }
      }

      if (!style.left && !style.top) {
        const elClass = el.getAttribute('class') || '';
        if (elClass.includes('title_h2') || INPUT_TYPES.has(ctype)) {
          comps.push(extractComp(el, elHidden, parentLeft, parentTop));
        } else if (el.children.length > 0) {
          comps.push(...walkChildren(el, parentHidden, parentLeft, parentTop));
        }
        continue;
      }

      comps.push(extractComp(el, elHidden, parentLeft, parentTop));
    }
    return comps;
  }


  // ─── 컴포넌트 XML 빌드 ───

  /**
   * 컴포넌트 XML 생성 — 원본 DOM을 그대로 복제하고 스타일/class만 변환 규칙에 맞게 수정.
   * 태그명, 속성, 자식 노드(choices, itemset 등) 모두 원본 유지.
   */
  function buildCompXml(comp, indent, opts) {
    opts = opts || {};
    const pad = '\t'.repeat(indent);

    // GridView: 별도 처리 (style/class 고정)
    if (comp.ctype === 'GridView') {
      return buildGridViewXml(comp, indent);
    }

    const el = comp.el;
    if (!el) {
      // el 없으면 폴백 (보통 발생 안함)
      const tag = comp.originalTag || 'xf:input';
      return `${pad}<${tag} id="${esc(comp.id)}"></${tag}>`;
    }

    // 원본 DOM 복제 후 속성만 수정
    const clone = el.cloneNode(true);

    // style 변환: 절대좌표 제거, width만 유지
    const isButton = ['Button', 'Trigger', 'LinkText'].includes(comp.ctype);
    const isFormInput = ['Edit', 'Calendar', 'SelectBox', 'Combo', 'CheckBox', 'CheckButton', 'TextArea', 'Radio', 'RadioButton'].includes(comp.ctype);

    // style 결정: 폼 요소는 width 유지, 나머지는 비움
    const styleParts = [];
    if (isFormInput && comp.width) {
      const w = ['SelectBox', 'Combo'].includes(comp.ctype) ? comp.width + 20 : comp.width;
      styleParts.push(`width:${w}px`);
    }
    if (opts.hidden) styleParts.push('display:none');
    clone.setAttribute('style', styleParts.length ? styleParts.join(';') + ';' : '');

    // class 변환: 매핑 테이블 적용 후 레이아웃 class 제거
    const CLASS_MAP = {
      'btn_ico_search': 'btn_cm search icon',
      'btn_def1': 'btn_cm', 'btn_def2': 'btn_cm', 'btn_def3': 'btn_cm',
      'btn_def_link': 'btn_cm',
      'kb_btn_white': 'btn_cm pt',
      'kb_txt_red': 'txt_red',
      'kb_title_h2': 'tit_main',
      'kb_title_h3': 'tit_sub',
    };
    const REMOVE_CLASSES = new Set([
      'content_body', 'conversion',
      'kb_MiddleRight', 'kb_MiddleLeft', 'kb_MiddleCenter',
      'kb_td_body', 'kb_td_head', 'title_h2'
    ]);
    if (isButton) {
      const origClass = clone.getAttribute('class') || '';
      const mapped = origClass.split(/\s+/).map(c => CLASS_MAP[c] || null).filter(Boolean);
      clone.setAttribute('class', mapped.length ? mapped.join(' ') : 'btn_cm');
      // 버튼 라벨 줄바꿈 제거
      const btnText = clone.getAttribute('text') || '';
      if (btnText) clone.setAttribute('text', btnText.replace(/\\n|\n/g, ' ').trim());
      const labelEl = clone.querySelector('label');
      if (labelEl && labelEl.textContent) labelEl.textContent = labelEl.textContent.replace(/\n/g, ' ').trim();
    } else {
      const origClass = clone.getAttribute('class') || '';
      const cleaned = origClass.split(/\s+/).map(c => {
        if (CLASS_MAP[c]) return CLASS_MAP[c];
        if (REMOVE_CLASSES.has(c)) return null;
        return c;
      }).filter(Boolean).join(' ');
      clone.setAttribute('class', cleaned);
    }

    // hierarchy, orgid 보장
    if (!clone.getAttribute('hierarchy') && comp.id) clone.setAttribute('hierarchy', comp.id);
    if (!clone.getAttribute('orgid') && comp.id) clone.setAttribute('orgid', comp.id);

    // outerHTML → 들여쓰기 정리
    const raw = new XMLSerializer().serializeToString(clone);
    // xmlns 정리 (중복 네임스페이스 선언 제거) + 태그 리네이밍 적용
    const cleaned = applyTagRename(raw.replace(/ xmlns(?::\w+)?="[^"]*"/g, ''));
    // 들여쓰기 적용 (버튼은 한 줄로)
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 1 || isButton) {
      return pad + lines.join('');
    }
    return lines.map((l, i) => i === 0 ? pad + l : pad + '\t' + l).join('\n');
  }


  // ─── GridView XML (샘플 패턴) ───

  function buildGridViewXml(comp, indent) {
    const pad = '\t'.repeat(indent);
    const el = comp.el;
    if (!el) return `${pad}<w2:gridView id="${esc(comp.id)}" class="gvw" style="width:100%; height:150px;"/>`;

    // 출력 태그: 원본 태그 그대로 보존. 단 w2:IBSheet는 w2:gridView로 정규화.
    const origTag = el.tagName;
    const localName = origTag.split(':').pop().toLowerCase();
    const outTag = localName === 'ibsheet' ? 'w2:gridView' : origTag;

    const attrs = {};
    for (const attr of el.attributes) {
      if (attr.name === 'style' || attr.name === 'class') continue;
      // autoFit="none"은 제거
      if (attr.name === 'autoFit' && attr.value === 'none') continue;
      attrs[attr.name] = attr.value;
    }

    // hierarchy, orgid 보장
    if (!attrs.hierarchy && comp.id) attrs.hierarchy = comp.id;
    if (!attrs.orgid && comp.id) attrs.orgid = comp.id;

    // style: width:100%, height:150px 고정
    attrs.style = 'width:100%; height:150px;';
    attrs.class = 'gvw';

    const attrStr = buildAttrStr(attrs);

    // 내부 구조 (caption, header, gBody) 보존 — 속성만 정리
    let inner = '';
    for (const child of el.children) {
      const childTag = child.tagName;
      const childName = childTag.split(':').pop().toLowerCase();

      if (['caption', 'header', 'gbody'].includes(childName)) {
        inner += serializeGridChild(child, indent + 1);
      }
    }

    return applyTagRename(`${pad}<${outTag}${attrStr}>\n${inner}${pad}</${outTag}>`);
  }

  function serializeGridChild(el, indent) {
    const pad = '\t'.repeat(indent);
    const tag = el.tagName;

    let attrStr = '';
    for (const attr of el.attributes) {
      if (attr.name === 'style') {
        attrStr += ` style=""`;
      } else {
        attrStr += ` ${attr.name}="${esc(attr.value)}"`;
      }
    }

    if (el.children.length === 0) {
      return `${pad}<${tag}${attrStr}></${tag}>\n`;
    }

    let result = `${pad}<${tag}${attrStr}>\n`;
    for (const child of el.children) {
      result += serializeGridChild(child, indent + 1);
    }
    result += `${pad}</${tag}>\n`;
    return result;
  }


  // ─── Row 클러스터링 ───

  function clusterRows(comps, threshold) {
    threshold = threshold || 15;
    const visible = comps.filter(c => !c.hidden);
    if (!visible.length) return [];
    const sorted = [...visible].sort((a, b) => a.top - b.top || a.left - b.left);
    const rows = [];
    let cur = [sorted[0]], curY = sorted[0].top;
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].top - curY) <= threshold) {
        cur.push(sorted[i]);
      } else {
        cur.sort((a, b) => a.left - b.left);
        rows.push(cur);
        cur = [sorted[i]];
        curY = sorted[i].top;
      }
    }
    if (cur.length) { cur.sort((a, b) => a.left - b.left); rows.push(cur); }
    return rows;
  }

  // ─── th/td 셀 판별 ───

  function hasFormAfter(row, fromIdx) {
    for (let j = fromIdx; j < row.length; j++) {
      const ct = row[j].ctype;
      if (INPUT_TYPES.has(ct)) return true;
      if (ct === 'Text') return false;
    }
    return false;
  }

  // 구분자 텍스트 (th 라벨이 아닌 시각적 구분자)
  function isSeparatorText(comp) {
    const label = (comp.label || '').trim();
    return /^[~\-\/]$/.test(label) || label === '';
  }

  // 폼 요소 바로 옆에 붙어 있는 단위/기호 텍스트인지 판별 (좌표 기반)
  // 폼 요소의 right(left+width) 근처에 있고, 짧은 기호성 텍스트인 경우
  const UNIT_SUFFIX_PATTERN = /^[%~\-\/()（）￦\\원건명개월일년회차호]$/;
  function isUnitSuffix(comp, prevComp) {
    if (!prevComp) return false;
    if (comp.ctype !== 'Text' && comp.ctype !== 'Desc') return false;
    const label = (comp.label || '').trim();
    if (!UNIT_SUFFIX_PATTERN.test(label)) return false;
    // 좌표: 이전 폼 요소의 right 근처(30px 이내)에 위치
    if (!INPUT_TYPES.has(prevComp.ctype)) return false;
    const prevRight = (prevComp.left || 0) + (prevComp.width || 0);
    const gap = (comp.left || 0) - prevRight;
    return gap >= -5 && gap <= 30;
  }

  function rowToCells(row) {
    const cells = [];
    let i = 0;
    while (i < row.length) {
      const comp = row[i];
      const ctype = comp.ctype;
      // Text가 th 라벨인지 판별: 구분자(~, -, /) 텍스트는 th가 아님
      const isLabelTh = ctype === 'Text' && !isSeparatorText(comp) && hasFormAfter(row, i + 1);

      // 폼 요소 바로 옆 단위 텍스트는 th가 아님
      if (isLabelTh && isUnitSuffix(comp, row[i - 1])) {
        // 단위 텍스트 → 직전 td에 추가
        if (cells.length > 0 && cells[cells.length - 1].type === 'td') {
          cells[cells.length - 1].comps.push(comp);
          i++;
          continue;
        }
      }

      if (isLabelTh) {
        const thComps = [comp];
        i++;
        while (i < row.length) {
          const next = row[i];
          if ((next.ctype === 'Text' || next.ctype === 'Desc') && !isUnitSuffix(next, row[i - 1])) { thComps.push(next); i++; }
          else break;
        }
        cells.push({ type: 'th', comps: thComps });
      } else if (INPUT_TYPES.has(ctype) && (cells.length === 0 || cells[cells.length - 1].type !== 'th')) {
        // 폼 요소가 th 없이 시작 → 빈 th를 추가하여 th/td 구조 유지
        cells.push({ type: 'th', comps: [] });
        const tdComps = [comp];
        i++;
        while (i < row.length) {
          const next = row[i];
          if (isUnitSuffix(next, row[i - 1])) { tdComps.push(next); i++; continue; }
          if (next.ctype === 'Text' && !isSeparatorText(next) && hasFormAfter(row, i + 1)) break;
          tdComps.push(next); i++;
        }
        cells.push({ type: 'td', comps: tdComps });
      } else {
        const tdComps = [comp];
        i++;
        while (i < row.length) {
          const next = row[i];
          if (isUnitSuffix(next, row[i - 1])) { tdComps.push(next); i++; continue; }
          if (next.ctype === 'Text' && !isSeparatorText(next) && hasFormAfter(row, i + 1)) break;
          tdComps.push(next); i++;
        }
        cells.push({ type: 'td', comps: tdComps });
      }
    }
    // td가 th보다 먼저 오는 패턴 → 앞쪽 td들은 colspan td로 유지, 뒤쪽 th-td는 그대로
    // 예: td(안내문구) → th(라벨) → td(폼) = [td colspan, th, td]
    if (cells.length >= 2 && cells[0].type === 'td' && cells.some(c => c.type === 'th')) {
      const firstThIdx = cells.findIndex(c => c.type === 'th');
      // 앞쪽 td들을 하나의 colspan td로 병합
      const leadingTds = cells.slice(0, firstThIdx);
      const leadingComps = leadingTds.flatMap(c => c.comps);
      const rest = cells.slice(firstThIdx); // th-td 정상 구조
      return [{ type: 'td', comps: leadingComps, _colspan: true }, ...rest];
    }
    return cells;
  }


  // ─── colgroup 너비 결정 (샘플 패턴) ───

  function determineThWidth(cells) {
    let maxLen = 0;
    cells.forEach(row => {
      row.forEach(cell => {
        if (cell.type === 'th') {
          const label = cell.comps.map(c => c.label || '').join('');
          if (label.length > maxLen) maxLen = label.length;
        }
      });
    });
    // 샘플: 긴 라벨(10자 이상) → 200px, 기본 → 150px
    return maxLen > 10 ? 200 : 150;
  }


  // ─── 섹션 빌더 (샘플 패턴) ───

  /** .titbox */
  function buildTitbox(titleLabel, indent, titleId, overlayComps, rtBtns) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t';
    const lines = [];
    lines.push(`${pad}<xf:group id="" class="titbox">`);
    if (titleLabel) {
      lines.push(`${p1}<w2:textbox tagname="h3" style="" id="${esc(titleId || '')}" label="${esc(titleLabel)}" class="tit_main"></w2:textbox>`);
    }
    // 우측 버튼 통합: rtBtns + overlayComps 중 버튼 → 하나의 rt 그룹
    const allRtBtns = [...(rtBtns || [])];
    const overlayOther = [];
    if (overlayComps && overlayComps.length > 0) {
      overlayComps.forEach(c => {
        if (['Button', 'Trigger', 'LinkText'].includes(c.ctype)) {
          allRtBtns.push(c);
        } else {
          overlayOther.push(c);
        }
      });
    }
    if (allRtBtns.length > 0) {
      lines.push(`${p1}<xf:group class="rt" id="" style="">`);
      allRtBtns.forEach(comp => {
        lines.push(buildCompXml(comp, indent + 2));
      });
      lines.push(`${p1}</xf:group>`);
    }
    overlayOther.forEach(comp => {
      lines.push(buildCompXml(comp, indent + 1));
    });
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }


  /**
   * th-td 쌍 수 계산: Row 내 셀 패턴에서 최대 쌍 수를 구한다.
   * [th, td, th, td] → 2쌍 = colgroup 4열
   * [th, td] → 1쌍 = colgroup 2열
   */
  function countPairs(rowCells) {
    let maxPairs = 0;
    rowCells.forEach(cells => {
      let pairs = 0;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].type === 'th') pairs++;
      }
      if (pairs === 0) pairs = 1; // th 없이 td만 있는 경우
      if (pairs > maxPairs) maxPairs = pairs;
    });
    return maxPairs;
  }

  /** .tblbox (샘플 패턴: colgroup 기반 colspan/rowspan 자동 계산) */
  function buildTblbox(comps, indent, opts) {
    opts = opts || {};
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t', p2 = p1 + '\t', p3 = p2 + '\t', p4 = p3 + '\t';

    const visible = comps.filter(c => !c.hidden);
    if (!visible.length) return '';

    const rows = clusterRows(visible);
    if (!rows.length) return '';

    // ─── thead/tbody 패턴 감지 (kb_th_head/kb_th_body class) ───
    const hasTheadPattern = rows.some(row =>
      row.some(c => (c.attributes?.class || '').includes('kb_th_head'))
    );

    const rowCells = rows.map(row => rowToCells(row));

    // colgroup: th-td 쌍 수 기준
    const pairs = countPairs(rowCells);
    const thWidth = determineThWidth(rowCells);

    // snippetName: thead 포함 시 5_03, 아니면 1단/2단 구분
    const snippetName = hasTheadPattern ? '5_03 테이블(thead)' : (pairs >= 2 ? '5_02 테이블(2단)' : '5_01 테이블(1단)');
    const snippetAttrs = ` meta_snippetCategory="05_입출력테이블" meta_snippetKeyComponent="true" meta_snippetName="${snippetName}"`;

    const lines = [];
    const groupId = opts.groupId || '';
    lines.push(`${pad}<xf:group class="tblbox" id="${esc(groupId)}"${opts.snippetAttrs || snippetAttrs}`);
    lines.push(`${pad}\tstyle="">`);

    // table
    const adaptiveAttrs = _options.responsive ? ' adaptive="layout" adaptiveThreshold="768"' : '';
    lines.push(`${p1}<xf:group${adaptiveAttrs} class="w2tb tbl" id="" style="" tagname="table">`);

    // w2:attributes > w2:summary
    lines.push(`${p2}<w2:attributes>`);
    lines.push(`${p3}<w2:summary></w2:summary>`);
    lines.push(`${p2}</w2:attributes>`);

    if (hasTheadPattern) {
      // ─── thead/tbody 테이블 구조 ───
      // 1. Row 분류: thead / tbody / 기타(타이틀, 안내 등)
      const TABLE_CELL_CLASSES = /kb_th_head|kb_th_body|kb_td_head|kb_td_body|kb_td_body_right/;
      const theadRowIdxs = [];
      const tbodyRowIdxs = [];
      const otherRowIdxs = [];
      rows.forEach((row, ri) => {
        const hasHead = row.some(c => TABLE_CELL_CLASSES.test(c.attributes?.class || ''));
        if (!hasHead) { otherRowIdxs.push(ri); return; }
        const isHead = row.some(c => (c.attributes?.class || '').includes('kb_th_head'));
        if (isHead) theadRowIdxs.push(ri);
        else tbodyRowIdxs.push(ri);
      });

      // 2. 테이블 셀 class가 있는 컴포넌트만으로 컬럼 경계 계산
      const allLeftEdges = new Set();
      [...theadRowIdxs, ...tbodyRowIdxs].forEach(ri => {
        rows[ri].forEach(c => {
          if (TABLE_CELL_CLASSES.test(c.attributes?.class || '')) {
            allLeftEdges.add(c.left);
          }
        });
      });
      const colBoundaries = [...allLeftEdges].sort((a, b) => a - b);
      const totalCols = colBoundaries.length || 1;

      // 셀이 차지하는 컬럼 범위 계산 (left와 width로 colspan 결정)
      function calcColspan(comp) {
        // 가장 가까운 경계 찾기
        let startIdx = 0, bestDist = Infinity;
        colBoundaries.forEach((b, i) => {
          const d = Math.abs(b - comp.left);
          if (d < bestDist) { bestDist = d; startIdx = i; }
        });
        // width로 끝 경계 찾기 → 차지하는 컬럼 수
        const endX = comp.left + (comp.width || 0);
        let span = 1;
        for (let i = startIdx + 1; i < colBoundaries.length; i++) {
          if (colBoundaries[i] < endX) span++;
          else break;
        }
        return { startIdx, span };
      }

      // 3. 타이틀/안내 텍스트 → caption으로 출력 (table 밖, tblbox 안)
      otherRowIdxs.forEach(ri => {
        rows[ri].forEach(comp => {
          lines.push(buildCompXml(comp, indent + 2));
        });
      });

      // 4. colgroup (균등 분할)
      const colWidth = (100 / totalCols).toFixed(2);
      lines.push(`${p2}<xf:group tagname="colgroup">`);
      for (let ci = 0; ci < totalCols; ci++) {
        lines.push(`${p3}<xf:group style="width:${colWidth}%" tagname="col"></xf:group>`);
      }
      lines.push(`${p2}</xf:group>`);

      // 셀 렌더링 헬퍼
      function renderTheadCell(comps, colspanVal) {
        lines.push(`${p4}<xf:group class="w2tb_th tac" style="" tagname="th">`);
        if (colspanVal > 1) {
          lines.push(`${p4}\t<w2:attributes>`);
          lines.push(`${p4}\t\t<w2:colspan>${colspanVal}</w2:colspan>`);
          lines.push(`${p4}\t</w2:attributes>`);
        }
        comps.forEach(comp => lines.push(buildCompXml(comp, indent + 5)));
        lines.push(`${p4}</xf:group>`);
      }

      function renderTbodyCell(cellType, comps, colspanVal) {
        if (cellType === 'th') {
          lines.push(`${p4}<xf:group class="w2tb_th tac" style="" tagname="th">`);
          lines.push(`${p4}\t<w2:attributes>`);
          lines.push(`${p4}\t\t<w2:scope>row</w2:scope>`);
          if (colspanVal > 1) lines.push(`${p4}\t\t<w2:colspan>${colspanVal}</w2:colspan>`);
          lines.push(`${p4}\t</w2:attributes>`);
          comps.forEach(comp => lines.push(buildCompXml(comp, indent + 5)));
          lines.push(`${p4}</xf:group>`);
        } else {
          lines.push(`${p4}<xf:group class="w2tb_td" style="" tagname="td">`);
          if (colspanVal > 1) {
            lines.push(`${p4}\t<w2:attributes>`);
            lines.push(`${p4}\t\t<w2:colspan>${colspanVal}</w2:colspan>`);
            lines.push(`${p4}\t</w2:attributes>`);
          }
          comps.forEach(comp => lines.push(buildCompXml(comp, indent + 5)));
          lines.push(`${p4}</xf:group>`);
        }
      }

      // Row를 좌표 기반으로 셀 분할하는 공통 함수
      function splitRowByCols(row) {
        const sorted = [...row].sort((a, b) => a.left - b.left);
        const cells = [];
        let ci = 0;
        while (ci < sorted.length) {
          const comp = sorted[ci];
          const { startIdx, span } = calcColspan(comp);
          const cls = comp.attributes?.class || '';
          const isThComp = cls.includes('kb_th_head') || cls.includes('kb_th_body') ||
                           (!/\bkb_td_(?:head|body)(?:_right)?\b/.test(cls) &&
                            (comp.ctype === 'Text' || comp.ctype === 'Desc') && !INPUT_TYPES.has(comp.ctype));
          const cellComps = [comp];
          ci++;
          // 같은 컬럼 범위에 있는 연속 컴포넌트 모으기
          while (ci < sorted.length) {
            const next = sorted[ci];
            const nextCs = calcColspan(next);
            if (nextCs.startIdx < startIdx + span) {
              cellComps.push(next);
              ci++;
            } else break;
          }
          cells.push({ type: isThComp ? 'th' : 'td', comps: cellComps, span });
        }
        return cells;
      }

      // 5. thead
      lines.push(`${p2}<xf:group tagname="thead">`);
      theadRowIdxs.forEach(ri => {
        const cells = splitRowByCols(rows[ri]);
        lines.push(`${p3}<xf:group tagname="tr">`);
        cells.forEach(cell => {
          renderTheadCell(cell.comps, cell.span);
        });
        lines.push(`${p3}</xf:group>`);
      });
      lines.push(`${p2}</xf:group>`);

      // 6. tbody
      lines.push(`${p2}<xf:group tagname="tbody">`);
      tbodyRowIdxs.forEach(ri => {
        const cells = splitRowByCols(rows[ri]);
        lines.push(`${p3}<xf:group tagname="tr">`);
        cells.forEach(cell => {
          renderTbodyCell(cell.type, cell.comps, cell.span);
        });
        lines.push(`${p3}</xf:group>`);
      });
      lines.push(`${p2}</xf:group>`);

    } else {
      // ─── 기존 tblbox 구조 (thead/tbody 없음) ───
      // colgroup: th-col(width), td-col(auto) × 쌍 수
      lines.push(`${p2}<xf:group tagname="colgroup">`);
      for (let pi = 0; pi < pairs; pi++) {
        lines.push(`${p3}<xf:group style="width:${thWidth}px;" tagname="col"></xf:group>`);
        lines.push(`${p3}<xf:group style="" tagname="col"></xf:group>`);
      }
      lines.push(`${p2}</xf:group>`);

      // rows — 각 Row의 th-td 쌍 수를 기준으로 colspan 계산
      rowCells.forEach((cells, ri) => {
        const isFirstRow = ri === 0;

        // Text-only Row 감지: 모든 셀이 td이고 폼 요소가 없으면 colspan 머지
        const isTextOnlyRow = cells.every(cell =>
          cell.type === 'td' && cell.comps.every(c => c.ctype === 'Text' || c.ctype === 'Desc')
        ) && cells.length > 0 && cells.some(cell => cell.comps.length > 0);

        if (isTextOnlyRow && pairs > 1) {
          // Text-only Row: 각 텍스트를 th+td 쌍 단위(colspan=2)로 머지
          const allComps = cells.flatMap(cell => cell.comps);
          const colsPerText = Math.max(1, Math.floor((pairs * 2) / (allComps.length || 1)));
          lines.push(`${p2}<xf:group tagname="tr">`);
          allComps.forEach((comp, ci) => {
            const isLastComp = ci === allComps.length - 1;
            const span = isLastComp ? (pairs * 2) - (colsPerText * ci) : colsPerText;
            lines.push(`${p3}<xf:group class="w2tb_td" tagname="td">`);
            if (span > 1) {
              lines.push(`${p4}<w2:attributes>`);
              lines.push(`${p4}\t<w2:colspan>${span}</w2:colspan>`);
              lines.push(`${p4}</w2:attributes>`);
            }
            lines.push(buildCompXml(comp, indent + 4));
            lines.push(`${p3}</xf:group>`);
          });
          lines.push(`${p2}</xf:group>`);
          return;
        }

        // 이 Row의 th-td 쌍 수
        const rowPairs = cells.filter(c => c.type === 'th').length || 1;
        // 남는 쌍 수 (th+td 2열 단위)
        const remainPairs = pairs - rowPairs;

        lines.push(`${p2}<xf:group${isFirstRow ? ' style=""' : ''} tagname="tr">`);

        cells.forEach((cell, ci) => {
          const isLast = ci === cells.length - 1;
          // _colspan td: 선행 td가 차지할 열 수 = 전체 열(pairs*2) - 뒤쪽 셀 수
          // 마지막 td: 남는 열을 colspan으로 합산 (남는 쌍 × 2 + 1)
          const hasLeadingColspan = cells.some(c => c._colspan);
          let colspanVal = 1;
          if (cell._colspan && cell.type === 'td') {
            const restCells = cells.length - 1; // 이 td 제외한 뒤쪽 셀 수
            colspanVal = Math.max(1, pairs * 2 - restCells);
          } else if (isLast && cell.type === 'td' && remainPairs > 0 && !hasLeadingColspan) {
            colspanVal = remainPairs * 2 + 1;
          }

          if (cell.type === 'th') {
            lines.push(`${p3}<xf:group class="w2tb_th${isFirstRow ? '' : ' '}" ${isFirstRow ? 'style="" ' : ''}tagname="th">`);
            if (!isFirstRow) {
              lines.push(`${p4}<w2:attributes>`);
              lines.push(`${p4}\t<w2:scope>row</w2:scope>`);
              lines.push(`${p4}</w2:attributes>`);
            }
            cell.comps.forEach(comp => {
              lines.push(buildCompXml(comp, indent + 4));
            });
            lines.push(`${p3}</xf:group>`);
          } else {
            lines.push(`${p3}<xf:group class="w2tb_td" ${isFirstRow ? 'style="" ' : ''}tagname="td">`);
            if (!isFirstRow || colspanVal > 1) {
              lines.push(`${p4}<w2:attributes>`);
              if (colspanVal > 1) lines.push(`${p4}\t<w2:colspan>${colspanVal}</w2:colspan>`);
              if (!isFirstRow) lines.push(`${p4}\t<w2:rowspan>1</w2:rowspan>`);
              lines.push(`${p4}</w2:attributes>`);
            }
            cell.comps.forEach(comp => {
              lines.push(buildCompXml(comp, indent + 4));
            });
            lines.push(`${p3}</xf:group>`);
          }
        });

        lines.push(`${p2}</xf:group>`);
      });
    }

    lines.push(`${p1}</xf:group>`); // table

    // clusterRows에서 빠진 컴포넌트 복구
    const clustered = new Set(rows.flat());
    visible.filter(c => !clustered.has(c)).forEach(c => {
      lines.push(buildCompXml(c, indent + 1));
    });

    lines.push(`${pad}</xf:group>`); // tblbox
    return lines.join('\n');
  }

  /** .gvwbox */
  function buildGvwbox(comp, indent) {
    const pad = '\t'.repeat(indent);
    const lines = [];
    const hiddenStyle = comp.hidden ? ' style="display:none;"' : '';
    lines.push(`${pad}<xf:group id="" class="gvwbox"${hiddenStyle}>`);
    lines.push(buildGridViewXml(comp, indent + 1));
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** .tbcbox (TAB 컨트롤 래퍼) */
  /** content 내부 DOM을 섹션 배열로 파싱 */
  function parseContentSections(contentEl) {
    const sections = [];
    for (const innerEl of contentEl.children) {
      if (shouldSkip(innerEl.tagName)) continue;
      const innerStyle = parseStyle(innerEl.getAttribute('style') || '');
      const innerCtype = getCtype(innerEl);
      const innerId = innerEl.getAttribute('id') || '';
      const innerHidden = isHidden(innerStyle);
      const innerTag = innerEl.tagName.split(':').pop().toLowerCase();

      if (innerCtype === 'GroupBox') {
        const children = walkChildren(innerEl, innerHidden, px(innerStyle.left), px(innerStyle.top));
        if (children.length > 0) {
          const hasGrid = children.some(c => c.ctype === 'GridView');
          sections.push({
            type: hasGrid ? 'grid' : 'groupbox',
            groupId: innerId, top: px(innerStyle.top), hidden: innerHidden,
            width: px(innerStyle.width), comps: children
          });
        }
      } else if (innerCtype === 'GridView' || innerCtype === 'IBSheet') {
        const comp = extractComp(innerEl, false, 0, 0);
        if (comp) { comp.ctype = 'GridView'; sections.push({ type: 'grid', top: px(innerStyle.top), hidden: false, comps: [comp] }); }
      } else if (innerTag === 'group' && innerEl.children.length > 0) {
        const children = walkChildren(innerEl, innerHidden, px(innerStyle.left), px(innerStyle.top));
        if (children.length > 0) {
          const hasGrid = children.some(c => c.ctype === 'GridView');
          sections.push({
            type: hasGrid ? 'grid' : 'groupbox',
            groupId: innerId, top: px(innerStyle.top), hidden: innerHidden,
            width: px(innerStyle.width), comps: children
          });
        }
      } else {
        const comp = extractComp(innerEl, innerHidden, 0, 0);
        if (comp) sections.push({ type: 'standalone', top: px(innerStyle.top), hidden: comp.hidden, comps: [comp] });
      }
    }
    sections.sort((a, b) => a.top - b.top);
    return sections;
  }

  /**
   * buildListTblbox: thead + tbody 리스트형 테이블
   * headerComps: Text Row (thead의 th들)
   * bodyRows: Form Row 배열 (tbody의 tr들, 각 Row는 컴포넌트 배열)
   */
  function buildListTblbox(headerComps, bodyRows, indent, groupId) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t', p2 = p1 + '\t', p3 = p2 + '\t', p4 = p3 + '\t';
    const colCount = headerComps.length;
    const lines = [];

    lines.push(`${pad}<xf:group class="tblbox" id="${esc(groupId || '')}" style="">`);
    lines.push(`${p1}<xf:group class="w2tb tbl" id="" style="" tagname="table">`);
    lines.push(`${p2}<w2:attributes><w2:summary></w2:summary></w2:attributes>`);

    // colgroup
    lines.push(`${p2}<xf:group tagname="colgroup">`);
    for (let i = 0; i < colCount; i++) {
      lines.push(`${p3}<xf:group style="" tagname="col"></xf:group>`);
    }
    lines.push(`${p2}</xf:group>`);

    // thead
    lines.push(`${p2}<xf:group tagname="thead">`);
    lines.push(`${p3}<xf:group tagname="tr">`);
    headerComps.forEach(comp => {
      lines.push(`${p4}<xf:group class="w2tb_th" tagname="th">`);
      lines.push(buildCompXml(comp, indent + 5));
      lines.push(`${p4}</xf:group>`);
    });
    lines.push(`${p3}</xf:group>`);
    lines.push(`${p2}</xf:group>`);

    // tbody
    lines.push(`${p2}<xf:group tagname="tbody">`);
    bodyRows.forEach(row => {
      lines.push(`${p3}<xf:group tagname="tr">`);
      // 각 폼 컴포넌트를 header 컬럼 수에 맞춰 td로 배치
      // header의 left 위치 기준으로 폼 컴포넌트를 컬럼에 매칭
      const sorted = [...row].sort((a, b) => a.left - b.left);
      const headerLefts = headerComps.map(h => h.left);

      // 컬럼별로 폼 컴포넌트 그룹핑
      const colBuckets = headerLefts.map(() => []);
      sorted.forEach(comp => {
        let bestCol = 0, bestDist = Infinity;
        headerLefts.forEach((hl, ci) => {
          const dist = Math.abs(comp.left - hl);
          if (dist < bestDist) { bestDist = dist; bestCol = ci; }
        });
        colBuckets[bestCol].push(comp);
      });

      colBuckets.forEach(bucket => {
        lines.push(`${p4}<xf:group class="w2tb_td" tagname="td">`);
        bucket.forEach(comp => {
          lines.push(buildCompXml(comp, indent + 5));
        });
        lines.push(`${p4}</xf:group>`);
      });
      lines.push(`${p3}</xf:group>`);
    });
    lines.push(`${p2}</xf:group>`);

    lines.push(`${p1}</xf:group>`);
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** buildPnlbox: w2:pageFrame(Panel) — style 비우고 self-closing 출력 */
  function buildPnlbox(comp, indent) {
    const pad = '\t'.repeat(indent);
    const el = comp.el;
    if (!el) return '';
    const attrs = [];
    for (const attr of el.attributes) {
      if (attr.name === 'style') { attrs.push('style=""'); continue; }
      if (attr.name === 'orgid' || attr.name === 'hierarchy') continue;
      attrs.push(`${attr.name}="${esc(attr.value)}"`);
    }
    if (!el.getAttribute('class')) attrs.push('class=""');
    return `${pad}<${el.tagName} ${attrs.join(' ')}/>`;
  }

  /** buildTbcbox: 뼈대 생성 + content 내부 변환 (convertCtx는 convert에서 전달) */
  function buildTbcbox(comp, indent, convertCtx) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t', p2 = p1 + '\t', p3 = p2 + '\t';

    const el = comp.el;
    if (!el) return '';

    // tabControl 속성 빌드: style 비우고 class="tbc" 적용
    const tcAttrs = [];
    for (const attr of el.attributes) {
      if (attr.name === 'style') { tcAttrs.push('style=""'); continue; }
      if (attr.name === 'class') { tcAttrs.push('class="tbc"'); continue; }
      tcAttrs.push(`${attr.name}="${esc(attr.value)}"`);
    }
    if (!el.getAttribute('class')) tcAttrs.push('class="tbc"');
    const tcTag = el.tagName;

    const lines = [];
    lines.push(`${pad}<xf:group class="tbcbox" id="" style="">`);
    lines.push(`${p1}<${tcTag} ${tcAttrs.join(' ')}>`);

    // w2:tabs 출력
    for (const child of el.children) {
      const childTag = child.tagName.split(':').pop().toLowerCase();
      if (childTag === 'tabs') {
        const tabAttrs = [];
        for (const a of child.attributes) tabAttrs.push(`${a.name}="${esc(a.value)}"`);
        lines.push(`${p2}<${child.tagName} ${tabAttrs.join(' ')}></${child.tagName}>`);
      }
    }

    // w2:content (TABPAGE) 처리
    for (const child of el.children) {
      const childCtype = child.getAttribute('ctype');
      if (childCtype !== 'TABPAGE') continue;

      // content 속성: style 비우기
      const contentAttrs = [];
      for (const a of child.attributes) {
        if (a.name === 'style') { contentAttrs.push('style=""'); continue; }
        contentAttrs.push(`${a.name}="${esc(a.value)}"`);
      }
      lines.push(`${p2}<${child.tagName} ${contentAttrs.join(' ')}>`);

      // content 내부
      let hasContent = false;
      for (const inner of child.children) {
        if (getCtype(inner) === 'Panel') {
          const pfAttrs = [];
          for (const a of inner.attributes) {
            if (a.name === 'style') { pfAttrs.push('style=""'); continue; }
            pfAttrs.push(`${a.name}="${esc(a.value)}"`);
          }
          lines.push(`${p3}<${inner.tagName} ${pfAttrs.join(' ')}/>`);
          hasContent = true;
          break;
        }
      }

      // Panel이 아닌 인라인 컴포넌트 → 섹션 분류 + 변환
      if (!hasContent && convertCtx) {
        const innerSections = parseContentSections(child);
        if (innerSections.length > 0) {
          // 전체 컴포넌트 수집 (hidden 포함) — 누락 복구용
          const allTabComps = innerSections.flatMap(s => s.comps);

          const contentItems = [];
          innerSections.forEach(sec => convertCtx.processSection(sec, contentItems));
          // btngroup은 renderItem에서 건너뛰므로 별도 수집 (groupbox-wrap 내부 포함)
          const btnItems = contentItems.flatMap(it => {
            if (it.type === 'btngroup') return [it];
            if (it.type === 'groupbox-wrap') return (it.subItems || []).filter(s => s.type === 'btngroup');
            return [];
          });
          const otherItems = contentItems.filter(it => it.type !== 'btngroup');
          // 일반 아이템 캡처
          const captured = convertCtx.captureRender(otherItems, indent + 3);
          captured.forEach(l => lines.push(l));
          // btngroup → btnbox로 직접 출력
          const btnComps = btnItems.flatMap(it => it.comps || []);
          if (btnComps.length) {
            lines.push(buildBtnbox(btnComps, indent + 3));
          }

          // ─── TAB 내부 누락 컴포넌트 복구 ───
          // 변환 결과에 포함된 ID 수집
          const renderedXml = captured.join('\n') + '\n' + (btnComps.length ? lines[lines.length - 1] : '');
          const includedIds = new Set();
          (renderedXml.match(/\sid="([^"]*)"/g) || []).forEach(m => {
            const id = m.replace(/\sid="/, '').replace('"', '');
            if (id) includedIds.add(id);
          });

          // 원본에 있지만 변환에 빠진 컴포넌트 찾기
          const missingInTab = allTabComps.filter(c =>
            c.id && !includedIds.has(c.id) && !/^GroupBox/i.test(c.id) && !/^title_/i.test(c.id)
          );

          if (missingInTab.length) {
            // 숨김 GroupBox ID 보존 (이미 변환에 포함된 ID는 제외)
            const hiddenGroupIds = innerSections
              .filter(s => s.hidden && s.groupId && /^GroupBox/i.test(s.groupId) && !includedIds.has(s.groupId))
              .map(s => s.groupId);

            const tabPad3 = '\t'.repeat(indent + 3);
            const tabPad4 = tabPad3 + '\t';
            lines.push(`${tabPad3}<xf:group id="" class="hidden_field" style="display:none;">`);

            // 숨김 GroupBox ID placeholder
            hiddenGroupIds.forEach(gid => {
              lines.push(`${tabPad4}<xf:group id="${esc(gid)}" style="display:none;"></xf:group>`);
            });

            // 누락 컴포넌트를 processSection으로 변환 후 삽입
            const missingItems = [];
            const missingSection = { type: 'standalone', hidden: false, comps: missingInTab.map(c => ({ ...c, hidden: false })) };
            convertCtx.processSection(missingSection, missingItems);
            const missingRendered = convertCtx.captureRender(missingItems, indent + 4);
            missingRendered.forEach(l => lines.push(l));

            lines.push(`${tabPad3}</xf:group>`);
          }

          hasContent = true;
        }
      }

      lines.push(`${p2}</${child.tagName}>`);
    }

    lines.push(`${p1}</${tcTag}>`);
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** 단독 블록 컴포넌트 분류 — table에 들어가면 안 되는 컴포넌트 */
  const BLOCK_TYPES = new Set([
    'TAB', 'Chart', 'Tree', 'FavoriteTree', 'WorkFlowTree',
    'Browser', 'ActiveX', 'WebViewControl', 'Navigation', 'Schedule',
    'Panel',
  ]);

  /** 래퍼 없이 style만 비워서 단독 출력 (Browser, ActiveX, WebViewControl, Navigation, Schedule) */
  function buildBlockComp(comp, indent) {
    const pad = '\t'.repeat(indent);
    const el = comp.el;
    if (!el) return '';

    const clone = el.cloneNode(true);
    clone.setAttribute('style', '');

    const raw = new XMLSerializer().serializeToString(clone);
    const cleaned = applyTagRename(raw.replace(/ xmlns(?::\w+)?="[^"]*"/g, ''));
    const innerLines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
    return innerLines.map((l, i) => i === 0 ? pad + l : pad + '\t' + l).join('\n');
  }

  /** .chartbox (Chart 래퍼) */
  function buildChartbox(comp, indent) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t';
    const el = comp.el;
    if (!el) return '';

    const clone = el.cloneNode(true);
    clone.setAttribute('style', '');

    const raw = new XMLSerializer().serializeToString(clone);
    const cleaned = applyTagRename(raw.replace(/ xmlns(?::\w+)?="[^"]*"/g, ''));
    const innerLines = cleaned.split('\n').map(l => l.trim()).filter(l => l);

    const lines = [];
    lines.push(`${pad}<xf:group class="chartbox" id="" style="">`);
    innerLines.forEach(l => lines.push(`${p1}${l}`));
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** .tvwbox (Tree/FavoriteTree/WorkFlowTree 래퍼) */
  function buildTvwbox(comp, indent) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t';
    const el = comp.el;
    if (!el) return '';

    const clone = el.cloneNode(true);
    clone.setAttribute('style', '');

    const raw = new XMLSerializer().serializeToString(clone);
    const cleaned = applyTagRename(raw.replace(/ xmlns(?::\w+)?="[^"]*"/g, ''));
    const innerLines = cleaned.split('\n').map(l => l.trim()).filter(l => l);

    const lines = [];
    lines.push(`${pad}<xf:group class="tvwbox" id="" style="">`);
    innerLines.forEach(l => lines.push(`${p1}${l}`));
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** .btnbox (샘플 패턴: .lt + .rt 구조) */
  /** .msgbox (※ 안내 메시지 등 Text-only GroupBox) */
  /** .schbox (조회조건: .schbox_inner + .btn_schbox) */
  function buildSchbox(comps, btns, indent, groupId) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t';
    const lines = [];

    lines.push(`${pad}<xf:group class="schbox" id="${esc(groupId || '')}" style="">`);
    lines.push(`${p1}<xf:group class="schbox_inner" id="" style="">`);

    // 내부는 tblbox와 동일한 테이블 구조 (tblbox wrapper 없이)
    const visible = comps.filter(c => !c.hidden);
    if (visible.length) {
      const rows = clusterRows(visible);
      if (rows.length) {
        const rowCells = rows.map(row => rowToCells(row));
        const pairs = countPairs(rowCells);
        const thWidth = determineThWidth(rowCells);
        const p2 = p1 + '\t', p3 = p2 + '\t', p4 = p3 + '\t';

        const adaptiveAttrs = _options.responsive ? ' adaptive="layout" adaptiveThreshold="768"' : '';
        lines.push(`${p2}<xf:group${adaptiveAttrs} class="w2tb tbl" id="" style="" tagname="table">`);
        lines.push(`${p3}<w2:attributes><w2:summary></w2:summary></w2:attributes>`);

        lines.push(`${p3}<xf:group tagname="colgroup">`);
        for (let pi = 0; pi < pairs; pi++) {
          lines.push(`${p4}<xf:group style="width:${thWidth}px;" tagname="col"></xf:group>`);
          lines.push(`${p4}<xf:group style="" tagname="col"></xf:group>`);
        }
        lines.push(`${p3}</xf:group>`);

        rowCells.forEach((cells, ri) => {
          const isFirstRow = ri === 0;
          const rowPairs = cells.filter(c => c.type === 'th').length || 1;
          const remainPairs = pairs - rowPairs;

          lines.push(`${p3}<xf:group${isFirstRow ? ' style=""' : ''} tagname="tr">`);
          cells.forEach((cell, ci) => {
            const isLast = ci === cells.length - 1;
            const colspanVal = (isLast && cell.type === 'td' && remainPairs > 0) ? remainPairs * 2 + 1 : 1;

            if (cell.type === 'th') {
              lines.push(`${p4}<xf:group class="w2tb_th" style="" tagname="th">`);
              cell.comps.forEach(comp => lines.push(buildCompXml(comp, indent + 5)));
              lines.push(`${p4}</xf:group>`);
            } else {
              lines.push(`${p4}<xf:group class="w2tb_td" style="" tagname="td">`);
              if (colspanVal > 1) {
                lines.push(`${p4}\t<w2:attributes><w2:colspan>${colspanVal}</w2:colspan></w2:attributes>`);
              }
              cell.comps.forEach(comp => lines.push(buildCompXml(comp, indent + 5)));
              lines.push(`${p4}</xf:group>`);
            }
          });
          lines.push(`${p3}</xf:group>`);
        });

        lines.push(`${p2}</xf:group>`); // table

        // clusterRows에서 빠진 컴포넌트 복구
        const clustered = new Set(rows.flat());
        visible.filter(c => !clustered.has(c)).forEach(c => {
          lines.push(buildCompXml(c, indent + 3));
        });
      }
    }

    // hidden 컴포넌트도 schbox 안에 포함 (display:none)
    const hiddenInSch = comps.filter(c => c.hidden);
    if (hiddenInSch.length) {
      hiddenInSch.forEach(c => {
        lines.push(buildCompXml(c, indent + 2, { hidden: true }));
      });
    }

    lines.push(`${p1}</xf:group>`); // schbox_inner

    // 조회 버튼 — 원본 DOM 복제, class만 btn_cm sch로 변경
    if (btns && btns.length) {
      lines.push(`${p1}<xf:group class="btn_schbox" id="" style="">`);
      btns.forEach(btn => {
        const clone = btn.el.cloneNode(true);
        clone.setAttribute('class', 'btn_cm sch');
        clone.setAttribute('style', '');
        if (!clone.getAttribute('hierarchy') && btn.id) clone.setAttribute('hierarchy', btn.id);
        if (!clone.getAttribute('orgid') && btn.id) clone.setAttribute('orgid', btn.id);
        const raw = applyTagRename(new XMLSerializer().serializeToString(clone).replace(/ xmlns(?::\w+)?="[^"]*"/g, ''));
        const btnLines = raw.split('\n').map(l => l.trim()).filter(l => l);
        btnLines.forEach((l, i) => lines.push(i === 0 ? `${p1}\t${l}` : `${p1}\t\t${l}`));
      });
      lines.push(`${p1}</xf:group>`);
    }

    lines.push(`${pad}</xf:group>`); // schbox
    return lines.join('\n');
  }

  function buildMsgbox(comps, indent, groupId) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t', p2 = p1 + '\t';
    const lines = [];

    const gidAttr = groupId ? ` id="${esc(groupId)}"` : ' id=""';

    // 한줄 → msgbox info + txt_info + txt_con 구조
    if (comps.length === 1) {
      lines.push(`${pad}<xf:group${gidAttr} class="msgbox info" style="">`);
      lines.push(`${p1}<w2:textbox class="txt_info" dataType="" id="" label="Info" style=""></w2:textbox>`);
      const label = comps[0].label || '';
      lines.push(`${p1}<w2:textbox class="txt_con" for="" id="${esc(comps[0].id || '')}" label="${esc(label)}" style="" tagname=""></w2:textbox>`);
      lines.push(`${pad}</xf:group>`);
      return lines.join('\n');
    }

    // 여러줄 → list_msg dash 구조 (ul > li)
    lines.push(`${pad}<xf:group${gidAttr} class="msgbox" style="">`);
    lines.push(`${p1}<xf:group class="list_msg dash" id="" style="" tagname="ul">`);
    comps.forEach(comp => {
      lines.push(`${p2}<xf:group id="" style="" tagname="li">`);
      if (!comp.el) { lines.push(buildCompXml(comp, indent + 3)); lines.push(`${p2}</xf:group>`); return; }
      const clone = comp.el.cloneNode(true);
      clone.setAttribute('label', comp.label || '');
      clone.setAttribute('style', '');
      if (!clone.getAttribute('hierarchy') && comp.id) clone.setAttribute('hierarchy', comp.id);
      if (!clone.getAttribute('orgid') && comp.id) clone.setAttribute('orgid', comp.id);
      const raw = applyTagRename(new XMLSerializer().serializeToString(clone).replace(/ xmlns(?::\w+)?="[^"]*"/g, ''));
      const cLines = raw.split('\n').map(l => l.trim()).filter(l => l);
      cLines.forEach((l, i) => lines.push(i === 0 ? `${p2}\t${l}` : `${p2}\t\t${l}`));
      lines.push(`${p2}</xf:group>`);
    });
    lines.push(`${p1}</xf:group>`);
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  function buildBtnbox(btnComps, indent, sectionWidth) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t';
    const lines = [];

    // 좌측/우측 분리: 섹션 너비의 50% 기준
    const midPoint = (sectionWidth || 744) * 0.5;
    const leftBtns = btnComps.filter(c => c.left < midPoint);
    const rightBtns = btnComps.filter(c => c.left >= midPoint);

    lines.push(`${pad}<xf:group id="" class="btnbox">`);

    // .lt: 좌측 버튼
    lines.push(`${p1}<xf:group id="" class="lt">`);
    leftBtns.forEach(comp => {
      lines.push(buildCompXml(comp, indent + 2));
    });
    lines.push(`${p1}</xf:group>`);

    // .rt: 우측 버튼
    lines.push(`${p1}<xf:group id="" class="rt">`);
    rightBtns.forEach(comp => {
      lines.push(buildCompXml(comp, indent + 2));
    });
    lines.push(`${p1}</xf:group>`);

    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }


  // ─── 메인 변환 ───

  // 변환 옵션을 모듈 스코프에서 참조
  let _options = {};

  function convert(xmlString, options) {
    _options = options || {};
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) throw new Error('XML 파싱 오류: ' + parseError.textContent.substring(0, 200));

    const root = doc.documentElement;
    const meta = { screenId: '', screenName: '', width: 1056, height: 750 };

    // head 추출 (그대로 보존)
    const head = root.querySelector('head');
    const headStr = head ? head.outerHTML : '';

    // body 찾기
    const body = root.querySelector('body');
    let bodyAttrs = '';
    if (body) {
      for (const attr of body.attributes) {
        bodyAttrs += ` ${attr.name}="${esc(attr.value)}"`;
      }
    }

    // 메인 그룹 찾기
    let mainGroup = null;
    if (body) {
      for (const child of body.children) {
        if (child.tagName.split(':').pop().toLowerCase() === 'group') {
          mainGroup = child;
          meta.screenId = child.getAttribute('screenno') || '';
          meta.screenName = child.getAttribute('screentitle') || '';
          const style = parseStyle(child.getAttribute('style') || '');
          if (style.width) meta.width = px(style.width);
          if (style.height) meta.height = px(style.height);
          break;
        }
      }
    }

    if (!mainGroup) throw new Error('메인 그룹을 찾을 수 없습니다.');

    // 메인 그룹 속성 재구성 (샘플 패턴)
    const mainAttrs = {};
    for (const attr of mainGroup.attributes) {
      if (attr.name === 'style' || attr.name === 'class') continue;
      mainAttrs[attr.name] = attr.value;
    }
    mainAttrs.class = 'sub_contents';
    mainAttrs.style = '';
    mainAttrs.id = '';
    mainAttrs.meta_componentContainer = 'true';
    mainAttrs.meta_snippetCategory = '00_화면시작';
    mainAttrs.meta_snippetKeyComponent = 'true';
    mainAttrs.meta_snippetName = '0_01 페이지시작';

    // ─── 섹션 분류 ───
    const sections = [];
    const startEl = mainGroup;

    for (const el of startEl.children) {
      if (shouldSkip(el.tagName)) continue;
      const style = parseStyle(el.getAttribute('style') || '');
      const ctype = getCtype(el);
      const id = el.getAttribute('id') || '';
      const tag = el.tagName.split(':').pop().toLowerCase();
      const selfHidden = isHidden(style);

      if (ctype === 'GroupBox') {
        const gbLeft = px(style.left);
        const gbTop = px(style.top);
        const children = walkChildren(el, selfHidden, gbLeft, gbTop);
        if (children.length > 0) {
          sections.push({ type: 'groupbox', groupId: id, top: gbTop, left: gbLeft, width: px(style.width), height: px(style.height), hidden: selfHidden, comps: children });
        }
      } else if (ctype === 'GridView' || ctype === 'IBSheet') {
        const comp = extractComp(el, false, 0, 0);
        comp.ctype = 'GridView';
        sections.push({ type: 'grid', top: comp.top, left: comp.left, width: px(style.width), height: px(style.height), hidden: false, comps: [comp] });
      } else if (ctype === 'TAB') {
        // TAB 컴포넌트 → tab 섹션 (tbcbox로 변환)
        const comp = extractComp(el, selfHidden, 0, 0);
        if (comp) sections.push({ type: 'tab', top: comp.top, left: comp.left, width: px(style.width), height: px(style.height), hidden: selfHidden, comps: [comp] });
      } else if (ctype === 'Panel') {
        // Panel(w2:pageFrame) → 독립 블록 섹션
        const comp = extractComp(el, selfHidden, 0, 0);
        if (comp) sections.push({ type: 'standalone', top: comp.top, left: comp.left, width: 0, height: 0, hidden: selfHidden, comps: [comp] });
      } else if (tag === 'group' && el.children.length > 0) {
        const wrapLeft = px(style.left);
        const wrapTop = px(style.top);
        // TAB 포함 여부 확인 — TAB은 별도 섹션으로 분리
        const hasTab = Array.from(el.children).some(ch => getCtype(ch) === 'TAB');
        if (hasTab) {
          for (const ch of el.children) {
            if (shouldSkip(ch.tagName)) continue;
            const chCtype = getCtype(ch);
            const chStyle = parseStyle(ch.getAttribute('style') || '');
            const chLeft = wrapLeft + px(chStyle.left);
            const chTop = wrapTop + px(chStyle.top);
            if (chCtype === 'TAB') {
              const comp = extractComp(ch, selfHidden, wrapLeft, wrapTop);
              if (comp) sections.push({ type: 'tab', top: chTop, left: chLeft, width: px(chStyle.width), height: px(chStyle.height), hidden: selfHidden, comps: [comp] });
            } else {
              const comp = extractComp(ch, selfHidden, wrapLeft, wrapTop);
              if (comp) sections.push({ type: 'standalone', top: chTop, left: chLeft, width: 0, height: 0, hidden: comp.hidden, comps: [comp] });
            }
          }
        } else {
          const children = walkChildren(el, selfHidden, wrapLeft, wrapTop);
          const hasGrid = children.some(c => c.ctype === 'GridView');
          // wrapper의 절대좌표: 자체 좌표가 있으면 사용, 없으면 자식 중 최소 top
          const groupTop = wrapTop || (children.length ? Math.min(...children.map(c => c.top)) : 0);
          const groupLeft = wrapLeft || (children.length ? Math.min(...children.map(c => c.left)) : 0);
          if (hasGrid) {
            sections.push({ type: 'grid', top: groupTop, left: groupLeft, width: px(style.width), height: px(style.height), hidden: selfHidden, comps: children });
          } else if (children.length > 0) {
            sections.push({ type: 'groupbox', groupId: id, top: groupTop, left: groupLeft, width: px(style.width), height: px(style.height), hidden: selfHidden, comps: children });
          }
        }
      } else {
        if (!style.left && !style.top) continue;
        const comp = extractComp(el, false, 0, 0);
        sections.push({ type: 'standalone', top: comp.top, left: comp.left, width: 0, height: 0, hidden: comp.hidden, comps: [comp] });
      }
    }

    // --- 겹침 감지: GroupBox 영역에 오버레이되는 고아 컴포넌트 → 해당 GroupBox의 overlayComps로 이관 ---
    const gbSections = sections.filter(s => s.type === 'groupbox' && s.groupId);
    const removeIdxs = new Set();
    sections.forEach((s, si) => {
      // tab, grid 등 독립 블록 섹션은 overlay 대상에서 제외
      if (s.groupId || (s.type !== 'groupbox' && s.type !== 'standalone')) return;
      s.comps.forEach(comp => {
        if (comp.hidden) return;
        // Panel(w2:pageFrame)은 외부 화면 참조 블록이므로 overlayComp 흡수 제외
        if (comp.ctype === 'Panel') return;
        // TAB 등 블록 타입 컴포넌트는 독립 블록이므로 흡수 제외
        if (BLOCK_TYPES.has(comp.ctype)) return;
        const ct = comp.top || 0;
        const target = gbSections.find(gb =>
          gb.height > 0 && ct >= gb.top && ct < gb.top + gb.height
        );
        if (target) {
          if (!target.overlayComps) target.overlayComps = [];
          target.overlayComps.push(comp);
        }
      });
      const allMoved = s.comps.every(c => c.hidden || gbSections.some(gb => gb.overlayComps && gb.overlayComps.includes(c)));
      if (allMoved) removeIdxs.add(si);
    });
    [...removeIdxs].sort((a, b) => b - a).forEach(i => sections.splice(i, 1));

    sections.sort((a, b) => a.top - b.top);

    // ─── 좌우 분할 감지 (2열 이상 지원) ───
    // 같은 Y 영역에 좌우로 배치된 섹션들을 'horizontal' 타입으로 병합
    const mergedSections = [];
    const used = new Set();
    for (let mi = 0; mi < sections.length; mi++) {
      if (used.has(mi)) continue;
      const s = sections[mi];
      if (s.hidden || !s.width || !s.height) { mergedSections.push(s); used.add(mi); continue; }

      // 같은 Y 범위(top ±30px)에 있는 모든 섹션 수집
      const group = [s];
      for (let mj = mi + 1; mj < sections.length; mj++) {
        if (used.has(mj)) continue;
        const t = sections[mj];
        if (t.hidden || !t.width || !t.height) continue;
        if (Math.abs(s.top - t.top) <= 30) {
          group.push(t);
          used.add(mj);
        }
      }

      if (group.length > 1) {
        // 좌우 분할 판정: left가 분리되어 있어야 진짜 좌우 배치
        // left 차이가 작으면(같은 위치에서 시작) 상하 배치
        group.sort((a, b) => (a.left || 0) - (b.left || 0));
        const minLeft = group[0].left || 0;
        const maxLeft = group[group.length - 1].left || 0;
        const isReallyHorizontal = (maxLeft - minLeft) > 50;
        if (isReallyHorizontal) {
          group.sort((a, b) => a.left - b.left);
          mergedSections.push({ type: 'horizontal', sections: group, top: s.top });
        } else {
          // 상하 배치 → 개별 섹션으로 유지
          group.forEach(g => mergedSections.push(g));
        }
      } else {
        mergedSections.push(s);
      }
      used.add(mi);
    }

    // ─── 연속 standalone 병합 ───
    // standalone이 연속으로 나오면 하나의 섹션으로 합쳐야 Row 클러스터링이 제대로 작동
    const finalSections = [];
    for (let fi = 0; fi < mergedSections.length; fi++) {
      const s = mergedSections[fi];
      if (s.type === 'standalone') {
        const merged = { type: 'standalone', top: s.top, hidden: false, comps: [...s.comps] };
        while (fi + 1 < mergedSections.length && mergedSections[fi + 1].type === 'standalone') {
          fi++;
          mergedSections[fi].comps.forEach(c => merged.comps.push(c));
        }
        finalSections.push(merged);
      } else {
        finalSections.push(s);
      }
    }

    // ─── outputItems 빌드 ───
    const allComps = sections.flatMap(s => s.comps);
    const hiddenComps = allComps.filter(c => c.hidden);
    const outputItems = [];

    /** tblbox 추가 (Text-only Row는 테이블 안에서 colspan으로 처리) */
    function pushTblboxWithTextSplit(items, comps, groupId) {
      if (comps.length) items.push({ type: 'tblbox', comps, groupId: groupId || '' });
    }


    /** _preGridBtns/Texts → titbox rt 합류 또는 새 titbox 생성 */
    function flushPreGridBtns(section, items) {
      if (!section._preGridBtns || section._preGridBtns.length === 0) return;
      const lastItem = items[items.length - 1];
      if (lastItem && lastItem.type === 'titbox') {
        lastItem.rtBtns = (lastItem.rtBtns || []).concat(section._preGridBtns);
      } else {
        // _preGridTexts가 있으면 첫 번째 Text/Desc를 titbox label로 사용
        const texts = section._preGridTexts || [];
        const firstText = texts[0];
        items.push({
          type: 'titbox',
          label: firstText ? (firstText.label || '') : '',
          titleId: firstText ? (firstText.id || '') : '',
          rtBtns: section._preGridBtns,
        });
      }
    }

    /** 단일 섹션 → outputItems 변환 */
    function processSection(section, items) {
      if (section.hidden) return;

      if (section.type === 'horizontal') {
        // 좌우 분할: 각 섹션을 독립적으로 변환하여 horizontal로 감싸기
        const subItemGroups = section.sections.map(sub => {
          const subItems = [];
          processSection(sub, subItems);
          return subItems;
        });
        items.push({ type: 'horizontal', subItemGroups, sections: section.sections });
        return;
      }

      if (section.type === 'tab') {
        flushPreGridBtns(section, items);
        const tc = section.comps.find(c => c.ctype === 'TAB');
        if (tc) items.push({ type: 'tbcbox', comp: tc });
        return;
      }

      if (section.type === 'grid') {
        flushPreGridBtns(section, items);
        const g = section.comps.find(c => c.ctype === 'GridView');
        if (g) items.push({ type: 'gvwbox', grid: g });

      } else if (section.type === 'groupbox' || section.type === 'standalone') {
        const vis = section.comps.filter(c => !c.hidden);
        if (!vis.length) return;

        const gid = section.type === 'groupbox' ? (section.groupId || '') : '';
        const itemsBefore = items.length; // GroupBox wrapper 판별용

        // ─── 조회조건(schbox) 판별 ───
        // 첫 번째 GroupBox + 폼 요소 있음 + 우측 끝에 단독 배치된 조회/검색 버튼이 있으면 조회 영역
        // 판별 기준: 같은 Row에서 가장 오른쪽에 있는 버튼이 폼과 분리되어 우측에 위치
        const isFirstGroupBox = section.type === 'groupbox' && finalSections.indexOf(section) === 0;
        const hasFormComp = vis.some(c => INPUT_TYPES.has(c.ctype) && !['Button', 'Trigger', 'LinkText'].includes(c.ctype));
        const hasNoGrid = !vis.some(c => c.ctype === 'GridView');

        if (isFirstGroupBox && hasFormComp && hasNoGrid) {
          // 조회/검색 버튼 판별:
          // 1) 우측 배치(섹션 60% 이상) OR
          // 2) 버튼 텍스트가 정확히 "조회"/"검색"/"초기화"인 경우 (다른 글자 포함 시 제외)
          const SEARCH_BTN_LABELS = /^(조회|검색|초기화)$/;
          const sectionWidth = section.width || 744;
          const rightThreshold = sectionWidth * 0.6;
          const allBtns = vis.filter(c => ['Button', 'Trigger', 'LinkText'].includes(c.ctype));
          const searchBtns = allBtns.filter(b => {
            const label = (b.label || b.attributes?.text || '').trim();
            return b.left >= rightThreshold || SEARCH_BTN_LABELS.test(label);
          });

          if (searchBtns.length > 0) {
            // title_h2 → titbox로 먼저 분리
            const schTitleH2 = vis.filter(c => (c.attributes?.class || '').includes('title_h2'));
            schTitleH2.forEach(c => items.push({ type: 'titbox', label: c.label || '', titleId: c.id || '', overlayComps: section.overlayComps || null }));
            // title_h2와 조회 버튼 제외한 나머지 = 테이블 영역
            const schComps = vis.filter(c => !searchBtns.includes(c) && !(c.attributes?.class || '').includes('title_h2'));
            items.push({ type: 'schbox', comps: schComps, btns: searchBtns, groupId: gid });
            return;
          }
        }

        // class="title_h2" → titbox (좌표 없는 제목)
        const titleH2 = vis.filter(c => (c.attributes?.class || '').includes('title_h2'));
        const workComps = vis.filter(c => !(c.attributes?.class || '').includes('title_h2'));

        // title_h2 먼저 출력 (overlayComps가 있으면 titbox에 함께 전달)
        titleH2.forEach(c => items.push({ type: 'titbox', label: c.label || '', titleId: c.id || '', overlayComps: section.overlayComps || null }));

        // 이 섹션 앞에 배치된 버튼 → 직전 titbox(title_h2)의 우측 버튼으로 합류
        flushPreGridBtns(section, items);

        // Row 클러스터링 → top 순서대로 출력 블록 생성
        const rawRows = clusterRows(workComps, 5);

        // 세로 배치 병합: Text-only Row + 바로 아래 폼 Row → 하나의 th+td Row로 합치기
        const mergedTextIds = new Set(); // 병합된 원본 Text 추적
        const rowGroups = [];
        for (let ri = 0; ri < rawRows.length; ri++) {
          const row = rawRows[ri];
          const nextRow = rawRows[ri + 1];
          const isTextOnly = row.every(c => c.ctype === 'Text' || c.ctype === 'Desc');
          const nextHasForm = nextRow && nextRow.some(c => INPUT_TYPES.has(c.ctype));
          // ※/＊ 설명 텍스트는 세로 병합 대상에서 제외
          const isMsgText = isTextOnly && row.every(c => /^[※*]/.test((c.label || '').trim()));

          // ─── 리스트형 테이블 감지: Text Row + Form-only Row 2개 이상 연속 → thead/tbody ───
          if (isTextOnly && !isMsgText && row.length >= 2 && nextHasForm && nextRow) {
            // 다음 Row부터 Form-only Row가 몇 개 연속인지 확인
            const formOnlyRows = [];
            for (let fi = ri + 1; fi < rawRows.length; fi++) {
              const fRow = rawRows[fi];
              const fFormOnly = fRow.every(c => INPUT_TYPES.has(c.ctype));
              // 컬럼 수가 header와 비슷한지 (±2 허용)
              if (fFormOnly && Math.abs(fRow.length - row.length) <= 2) {
                formOnlyRows.push(fRow);
              } else {
                break;
              }
            }
            if (formOnlyRows.length >= 2) {
              // 리스트형 테이블로 처리
              row.sort((a, b) => a.left - b.left);
              row.forEach(tc => mergedTextIds.add(tc.id || tc));
              formOnlyRows.forEach(fr => fr.sort((a, b) => a.left - b.left));
              rowGroups.push({ _listTbl: true, header: row, bodyRows: formOnlyRows });
              ri += formOnlyRows.length; // Form Row들 skip
              continue;
            }
          }

          if (isTextOnly && !isMsgText && nextHasForm && row.length > 0 && nextRow) {
            const textTop = Math.min(...row.map(c => c.top));
            const formTop = Math.min(...nextRow.map(c => c.top));
            // Text-only Row의 텍스트가 다음 Row의 Text 위치에만 대응하면 병합 안 함 (colspan Row로 유지)
            const nextTexts = nextRow.filter(c => c.ctype === 'Text' || c.ctype === 'Desc');
            const allMatchTexts = row.length > 0 && row.every(tc => {
              return nextTexts.some(nt => Math.abs(tc.left - nt.left) <= 30);
            });
            if (formTop - textTop > 0 && formTop - textTop <= 40 && !allMatchTexts) {
              const merged = [];
              const usedTexts = new Set();
              nextRow.sort((a, b) => a.left - b.left);
              row.sort((a, b) => a.left - b.left);
              nextRow.forEach(formComp => {
                let bestText = null, bestDist = Infinity;
                row.forEach(tc => {
                  if (usedTexts.has(tc)) return;
                  const dist = Math.abs(tc.left - formComp.left);
                  if (dist < bestDist) { bestDist = dist; bestText = tc; }
                });
                if (bestText && bestDist <= 100) {
                  usedTexts.add(bestText);
                  mergedTextIds.add(bestText.id || bestText);
                  merged.push({ ...bestText, top: formComp.top, left: formComp.left - 1, _mergedFrom: bestText });
                }
                merged.push(formComp);
              });
              row.forEach(tc => {
                if (!usedTexts.has(tc)) {
                  mergedTextIds.add(tc.id || tc);
                  merged.push({ ...tc, top: nextRow[0].top, _mergedFrom: tc });
                }
              });
              merged.sort((a, b) => a.left - b.left);
              rowGroups.push(merged);
              ri++;
              continue;
            }
          }
          rowGroups.push(row);
        }

        let tblBuffer = []; // 연속 테이블 Row를 모으는 버퍼
        let msgBuffer = []; // 연속 msgbox Row를 모으는 버퍼

        function flushTbl() {
          if (!tblBuffer.length) return;
          pushTblboxWithTextSplit(items, [...tblBuffer], gid);
          tblBuffer = [];
        }

        function flushMsg() {
          if (!msgBuffer.length) return;
          items.push({ type: 'msgbox', comps: [...msgBuffer], groupId: gid });
          msgBuffer = [];
        }

        // 그리드 위 버튼 Row 임시 저장소 (다음 Row가 그리드이면 titbox에 합류)
        let pendingGridBtns = null;

        for (let ri = 0; ri < rowGroups.length; ri++) {
          const row = rowGroups[ri];

          // 리스트형 테이블 항목 처리
          if (row._listTbl) {
            flushTbl();
            flushMsg();
            items.push({ type: 'listtbl', header: row.header, bodyRows: row.bodyRows, groupId: gid });
            continue;
          }

          const nextRow = rowGroups[ri + 1];
          const allBtns = row.every(c => ['Button', 'Trigger', 'LinkText'].includes(c.ctype));
          const hasGrid = row.some(c => c.ctype === 'GridView');
          const isSingleText = row.length === 1 && (row[0].ctype === 'Text' || row[0].ctype === 'Desc');
          const hasForm = row.some(c => INPUT_TYPES.has(c.ctype));

          const hasBlock = row.some(c => BLOCK_TYPES.has(c.ctype));
          if (hasBlock) {
            flushTbl();
            flushMsg();
            row.filter(c => BLOCK_TYPES.has(c.ctype)).forEach(bc => {
              if (bc.ctype === 'TAB') items.push({ type: 'tbcbox', comp: bc });
              else if (bc.ctype === 'Panel') items.push({ type: 'pnlbox', comp: bc });
              else if (bc.ctype === 'Chart') items.push({ type: 'chartbox', comp: bc });
              else if (['Tree', 'FavoriteTree', 'WorkFlowTree'].includes(bc.ctype)) items.push({ type: 'tvwbox', comp: bc });
              else items.push({ type: 'blockcomp', comp: bc });
            });
            const rest = row.filter(c => !BLOCK_TYPES.has(c.ctype));
            if (rest.length) tblBuffer.push(...rest);
          } else if (hasGrid) {
            flushTbl();
            flushMsg();
            // pendingGridBtns가 있으면 직전 titbox에 합류 또는 새 titbox 생성
            if (pendingGridBtns) {
              const lastItem = items[items.length - 1];
              if (lastItem && lastItem.type === 'titbox') {
                // 직전 titbox에 우측 버튼 추가
                lastItem.rtBtns = (lastItem.rtBtns || []).concat(pendingGridBtns);
              } else {
                items.push({ type: 'titbox', label: '', titleId: '', rtBtns: pendingGridBtns });
              }
              pendingGridBtns = null;
            }
            row.filter(c => c.ctype === 'GridView').forEach(g => {
              items.push({ type: 'gvwbox', grid: g, groupId: gid });
            });
          } else if (allBtns) {
            flushTbl();
            flushMsg();
            // 다음 Row가 그리드이면 titbox 우측 버튼으로 예약, 아니면 기존 btngroup
            const nextHasGrid = nextRow && nextRow.some(c => c.ctype === 'GridView');
            if (nextHasGrid) {
              pendingGridBtns = [...row];
            } else {
              items.push({ type: 'btngroup', comps: [...row], groupId: gid });
            }
          } else if (isSingleText && !hasForm) {
            if (/^[※*]/.test(row[0].label || '')) {
              // ※ 텍스트 → msgBuffer에 모으기
              flushTbl();
              msgBuffer.push(row[0]);
            } else if (msgBuffer.length > 0) {
              // msgBuffer에 연속된 Desc/Text → 같은 class이고 수직 근접하면 이전 항목에 텍스트 병합
              const last = msgBuffer[msgBuffer.length - 1];
              const lastClass = (last.attributes?.class || '').replace(/\bkb_MiddleLeft\b/g, '').trim();
              const curClass = (row[0].attributes?.class || '').replace(/\bkb_MiddleLeft\b/g, '').trim();
              const vertDist = Math.abs((row[0].top || 0) - (last.top || 0));
              if (lastClass === curClass && vertDist <= 30) {
                last.label = (last.label || '') + (row[0].label || '');
              } else {
                flushTbl();
                flushMsg();
                items.push({ type: 'titbox', label: row[0].label || '', titleId: row[0].id || '' });
              }
            } else {
              flushTbl();
              flushMsg();
              items.push({ type: 'titbox', label: row[0].label || '', titleId: row[0].id || '' });
            }
          } else {
            // 폼 Row → 테이블 버퍼에 추가
            // 단, 폼+버튼 혼합이고 버튼이 우측에 분리되어 있으면 분리
            const btns = row.filter(c => ['Button', 'Trigger', 'LinkText'].includes(c.ctype));
            const nonBtns = row.filter(c => !['Button', 'Trigger', 'LinkText'].includes(c.ctype));
            if (btns.length > 0 && nonBtns.length > 0) {
              const maxFormLeft = Math.max(...nonBtns.map(c => c.left + (c.width || 0)));
              const minBtnLeft = Math.min(...btns.map(c => c.left));
              if (minBtnLeft - maxFormLeft > 100) {
                flushMsg();
                tblBuffer.push(...nonBtns);
                flushTbl();
                items.push({ type: 'btngroup', comps: btns, groupId: gid });
              } else {
                flushMsg();
                tblBuffer.push(...row);
              }
            } else {
              flushMsg();
              tblBuffer.push(...row);
            }
          }
        }
        // pendingGridBtns가 소진되지 않은 경우 (마지막 Row가 버튼이고 그리드가 없었을 때)
        if (pendingGridBtns) {
          items.push({ type: 'btngroup', comps: pendingGridBtns, groupId: gid });
          pendingGridBtns = null;
        }
        flushTbl();
        flushMsg();

        // clusterRows에서 빠진 컴포넌트 보존 (세로 병합된 원본 제외)
        const clusteredArr = [];
        rowGroups.forEach(rg => {
          if (rg._listTbl) {
            clusteredArr.push(...rg.header, ...rg.bodyRows.flat());
          } else {
            clusteredArr.push(...rg);
          }
        });
        const clustered = new Set(clusteredArr);
        workComps.filter(c => !clustered.has(c) && !c.hidden && c.ctype !== 'GridView' && !mergedTextIds.has(c.id || c)).forEach(c => {
          if (['Button', 'Trigger', 'LinkText'].includes(c.ctype)) items.push({ type: 'btngroup', comps: [c], groupId: gid });
          else pushTblboxWithTextSplit(items, [c], gid);
        });

        // ─── GroupBox wrapper: 분할된 item들을 하나의 컨테이너로 감싸기 ───
        // GroupBox 하나가 tblbox + tblbox + msgbox 등 여러 item으로 분할되면
        // 동일한 gid가 중복 사용됨 → wrapper로 감싸서 ID를 1회만 사용
        if (gid) {
          const newItems = items.slice(itemsBefore);
          const gidCount = newItems.filter(it => it.groupId === gid).length;
          if (gidCount > 1) {
            // items에서 이 섹션이 추가한 항목들을 제거
            items.splice(itemsBefore);
            // 개별 item에서 gid 제거
            newItems.forEach(it => { if (it.groupId === gid) it.groupId = ''; });
            // wrapper item으로 감싸서 push
            items.push({ type: 'groupbox-wrap', groupId: gid, subItems: newItems });
          }
        }
      }
    }

    // 섹션 간 look-ahead: 콘텐츠 섹션 직전의 standalone 섹션에서 버튼을 추출하여 titbox rt에 배치
    // 버튼-only가 아닌 섹션(Text+Button 혼합)에서도 버튼만 분리하여 합류
    for (let si = finalSections.length - 1; si >= 0; si--) {
      const sec = finalSections[si];
      if (sec.hidden) continue;
      // standalone 섹션 중 버튼만 포함(폼요소 없음)이면 소스 후보이므로 대상에서 제외
      if (sec.type === 'standalone') {
        const secVis = sec.comps.filter(c => !c.hidden);
        const hasOnlyBtnsOrText = !secVis.some(c => INPUT_TYPES.has(c.ctype) && !['Button', 'Trigger', 'LinkText'].includes(c.ctype));
        if (hasOnlyBtnsOrText && secVis.some(c => ['Button', 'Trigger', 'LinkText'].includes(c.ctype))) continue;
      }
      // 이 섹션 바로 위의 연속된 standalone 섹션에서 버튼 추출
      // groupbox(폼요소 포함)는 대상 제외 — 테이블 안의 버튼은 테이블에 유지
      let bi = si - 1;
      while (bi >= 0) {
        const prev = finalSections[bi];
        if (prev.hidden) { bi--; continue; }
        if (prev._skipForGrid) { bi--; continue; }
        if (prev.type !== 'standalone') break;
        const vis = prev.comps.filter(c => !c.hidden);
        const btns = vis.filter(c => ['Button', 'Trigger', 'LinkText'].includes(c.ctype));
        if (btns.length === 0) break;
        // 버튼을 다음 콘텐츠에 합류
        if (!sec._preGridBtns) sec._preGridBtns = [];
        sec._preGridBtns.unshift(...btns);
        // 비버튼(Text/Desc) → titbox tit_main으로 함께 전달
        const nonBtns = vis.filter(c => !['Button', 'Trigger', 'LinkText'].includes(c.ctype));
        if (nonBtns.length > 0) {
          if (!sec._preGridTexts) sec._preGridTexts = [];
          sec._preGridTexts.unshift(...nonBtns);
        }
        prev._skipForGrid = true;
        bi--;
      }
    }

    // 2단계: 마킹된 섹션은 건너뛰고 processSection 실행
    // hidden 섹션은 원래 섹션 구조를 유지한 채 별도로 변환
    const hiddenSectionItems = [];
    for (let si = 0; si < finalSections.length; si++) {
      if (finalSections[si]._skipForGrid) continue;
      const sec = finalSections[si];
      if (sec.hidden) {
        const tempSection = { ...sec, hidden: false, comps: sec.comps.map(c => ({ ...c, hidden: false })) };
        processSection(tempSection, hiddenSectionItems);
      } else {
        processSection(sec, outputItems);
      }
    }

    // ─── XML 조립 ───
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms">');

    // head 그대로 보존 (원본 들여쓰기 유지)
    if (headStr) {
      lines.push('\t' + headStr);
    }

    // body
    lines.push(`\t<body${bodyAttrs}>`);

    // 메인 그룹 (샘플 패턴: sub_contents)
    const mainAttrStr = buildAttrStr(mainAttrs);
    lines.push(`\t\t<xf:group${mainAttrStr}>`);

    // 코멘트 보존
    const commentMatch = xmlString.match(/<!--\s*Tag is Not matched[\s\S]*?-->/);
    if (commentMatch) lines.push(`\t\t\t${commentMatch[0]}`);

    // 섹션별 출력

    /** outputItem → XML 라인 생성 (재귀 지원) */
    /** 좌우 분할 비율 계산 → col_N 클래스 (합계 10) */
    function calcColClasses(hSections) {
      const totalW = hSections.reduce((s, sec) => s + (sec.width || 1), 0);
      return hSections.map(sec => {
        const ratio = Math.round(((sec.width || 1) / totalW) * 10);
        const clamped = Math.max(1, Math.min(9, ratio));
        return `col_${clamped}`;
      });
    }

    function renderItem(item, indent) {
      const pad = '\t'.repeat(indent);
      if (item.type === 'titbox') {
        lines.push(buildTitbox(item.label, indent, item.titleId, item.overlayComps, item.rtBtns));
      } else if (item.type === 'tblbox') {
        lines.push(buildTblbox(item.comps, indent, { groupId: item.groupId }));
      } else if (item.type === 'schbox') {
        lines.push(buildSchbox(item.comps, item.btns, indent, item.groupId));
      } else if (item.type === 'gvwbox') {
        lines.push(buildGvwbox(item.grid, indent));
      } else if (item.type === 'msgbox') {
        lines.push(buildMsgbox(item.comps, indent, item.groupId));
      } else if (item.type === 'horizontal') {
        // 좌우 분할: lybox + col_N (비율 기반)
        lines.push(`${pad}<xf:group class="lybox" id="" style="">`);
        const colClasses = calcColClasses(item.sections);
        item.subItemGroups.forEach((subItems, gi) => {
          lines.push(`${pad}\t<xf:group class="${colClasses[gi] || ''}" id="" style="">`);
          subItems.forEach(sub => renderItem(sub, indent + 2));
          lines.push(`${pad}\t</xf:group>`);
        });
        lines.push(`${pad}</xf:group>`);
      } else if (item.type === 'tbcbox') {
        lines.push(buildTbcbox(item.comp, indent, {
          processSection,
          captureRender: (items, ind) => {
            const before = lines.length;
            items.forEach(it => renderItem(it, ind));
            // renderItem이 lines에 직접 push한 것들을 빼서 반환
            return lines.splice(before);
          }
        }));
      } else if (item.type === 'listtbl') {
        lines.push(buildListTblbox(item.header, item.bodyRows, indent, item.groupId));
      } else if (item.type === 'pnlbox') {
        lines.push(buildPnlbox(item.comp, indent));
      } else if (item.type === 'chartbox') {
        lines.push(buildChartbox(item.comp, indent));
      } else if (item.type === 'tvwbox') {
        lines.push(buildTvwbox(item.comp, indent));
      } else if (item.type === 'blockcomp') {
        lines.push(buildBlockComp(item.comp, indent));
      } else if (item.type === 'groupbox-wrap') {
        // GroupBox wrapper: 분할된 tblbox/msgbox 등을 하나의 컨테이너로 감싸기
        lines.push(`${pad}<xf:group id="${esc(item.groupId)}" class="grpbox_wrap" style="">`);
        item.subItems.forEach(sub => renderItem(sub, indent + 1));
        lines.push(`${pad}</xf:group>`);
      } else if (item.type === 'btngroup') {
        // 버튼 → btnbox (마지막에 모아서 출력)
      }
    }

    outputItems.forEach(item => renderItem(item, 3));

    // GroupBox ID 보존: schbox/tblbox wrapper에 사용되지 않은 GroupBox ID만 hidden_field에 포함
    const usedGroupIds = new Set();
    function collectUsedGroupIds(items) {
      items.forEach(item => {
        if (item.groupId) usedGroupIds.add(item.groupId);
        if (item.subItems) collectUsedGroupIds(item.subItems);
        if (item.subItemGroups) item.subItemGroups.forEach(g => collectUsedGroupIds(g));
      });
    }
    collectUsedGroupIds(outputItems);
    const groupBoxIds = [];
    sections.forEach(s => {
      if (s.type === 'groupbox' && s.groupId && /^GroupBox/i.test(s.groupId) && !usedGroupIds.has(s.groupId)) {
        groupBoxIds.push(s.groupId);
      }
    });

    // 숨김 필드 → 별도 hidden_field div
    // hiddenSectionItems: 2단계에서 hidden 섹션을 원래 구조 그대로 변환한 결과
    // hiddenSectionItems에 사용된 GroupBox ID, 컴포넌트 ID 수집
    const hiddenSectionGroupIds = new Set();
    const collectGroupIds = (it) => {
      if (it.groupId) hiddenSectionGroupIds.add(it.groupId);
      if (it.subItems) it.subItems.forEach(collectGroupIds);
    };
    hiddenSectionItems.forEach(collectGroupIds);
    // groupBoxIds에서 hiddenSectionItems에서 이미 사용된 ID 제거
    for (let gi = groupBoxIds.length - 1; gi >= 0; gi--) {
      if (hiddenSectionGroupIds.has(groupBoxIds[gi])) groupBoxIds.splice(gi, 1);
    }

    const hiddenSectionCompIds = new Set();
    const extractItemIds = (it) => {
      if (it.titleId) hiddenSectionCompIds.add(it.titleId);
      if (it.comps) it.comps.forEach(c => { if (c.id) hiddenSectionCompIds.add(c.id); });
      if (it.grid && it.grid.id) hiddenSectionCompIds.add(it.grid.id);
      if (it.comp && it.comp.id) hiddenSectionCompIds.add(it.comp.id);
      if (it.header) it.header.forEach(c => { if (c.id) hiddenSectionCompIds.add(c.id); });
      if (it.bodyRows) it.bodyRows.forEach(r => r.forEach(c => { if (c.id) hiddenSectionCompIds.add(c.id); }));
      if (it.subItems) it.subItems.forEach(extractItemIds);
      if (it.subItemGroups) it.subItemGroups.forEach(g => g.forEach(extractItemIds));
      if (it.rtBtns) it.rtBtns.forEach(c => { if (c.id) hiddenSectionCompIds.add(c.id); });
      if (it.btns) it.btns.forEach(c => { if (c.id) hiddenSectionCompIds.add(c.id); });
    };
    hiddenSectionItems.forEach(extractItemIds);

    // 이미 변환 출력에 포함된 ID 제외 (hidden gvwbox 등으로 이미 출력된 경우)
    const outputSoFar = lines.join('\n');
    const alreadyRenderedIds = new Set();
    (outputSoFar.match(/\bid="([^"]*)"/g) || []).forEach(m => {
      const id = m.replace('id="', '').replace('"', '');
      if (id) alreadyRenderedIds.add(id);
    });

    // 잔여 hidden 컴포넌트 (섹션 구조 변환에서 빠진 개별 컴포넌트)
    const uniqueHidden = [];
    const seenIds = new Set();
    hiddenComps.forEach(c => {
      if (!c.id || seenIds.has(c.id) || /^GroupBox/i.test(c.id)) return;
      if (alreadyRenderedIds.has(c.id)) return;
      if (hiddenSectionCompIds.has(c.id)) return;
      seenIds.add(c.id);
      uniqueHidden.push(c);
    });

    const hiddenOutputItems = [];
    if (uniqueHidden.length) {
      const hiddenSection = { type: 'standalone', hidden: false, comps: uniqueHidden.map(c => ({ ...c, hidden: false })) };
      processSection(hiddenSection, hiddenOutputItems);
    }

    // 전체 hidden 아이템 = 섹션 구조 변환 + 잔여
    const allHiddenItems = [...hiddenSectionItems, ...hiddenOutputItems];

    // GroupBox ID + 변환된 숨김 필드를 hidden_field에 포함
    if (groupBoxIds.length || allHiddenItems.length) {
      const pad3 = '\t\t\t', pad4 = pad3 + '\t';
      lines.push(`${pad3}<xf:group id="" class="hidden_field" style="display:none;">`);
      groupBoxIds.forEach(gid => {
        lines.push(`${pad4}<xf:group id="${esc(gid)}" style="display:none;"></xf:group>`);
      });
      allHiddenItems.forEach(item => renderItem(item, 4));
      lines.push(`${pad3}</xf:group>`);
    }

    // 마지막: btnbox (버튼만) — groupbox-wrap 내부의 btngroup도 포함
    const allBtns = outputItems.flatMap(i => {
      if (i.type === 'btngroup') return i.comps || [];
      if (i.type === 'groupbox-wrap') return (i.subItems || []).filter(s => s.type === 'btngroup').flatMap(s => s.comps || []);
      return [];
    });
    if (allBtns.length) {
      lines.push(buildBtnbox(allBtns, 3, meta.width));
    }

    // ─── 누락 ID 안전 복구 ───
    // 변환 결과에 포함된 ID 수집
    const outputXmlSoFar = lines.join('\n');
    const includedIds = new Set();
    (outputXmlSoFar.match(/\bid="([^"]*)"/g) || []).forEach(m => {
      const id = m.replace('id="', '').replace('"', '');
      if (id) includedIds.add(id);
    });

    // 원본의 모든 컴포넌트 중 변환에 누락된 것 찾기
    // 같은 id가 여러 경로로 들어오는 경우(예: overlay/horizontal split)에 두 번 복구되지 않도록 id 기준 dedupe.
    const missingComps = [];
    const missingVisible = [];
    const seenMissingIds = new Set();
    allComps.forEach(c => {
      if (!c.id || /^GroupBox/i.test(c.id)) return;
      if (includedIds.has(c.id)) return;
      if (seenMissingIds.has(c.id)) return;
      seenMissingIds.add(c.id);
      if (c.hidden) {
        // 원래 숨김 → 안전하게 btnbox .lt에 추가
        missingComps.push(c);
      } else {
        // 원래 보임 → 경고 대상 (레이아웃 깨질 수 있어 자동 추가 안 함)
        missingVisible.push(c);
      }
    });

    // 숨김 컴포넌트 복구: 동일한 변환 프로세스 적용 후 hidden_field에 삽입
    if (missingComps.length) {
      const missingItems = [];
      const missingSection = { type: 'standalone', hidden: false, comps: missingComps.map(c => ({ ...c, hidden: false })) };
      processSection(missingSection, missingItems);

      if (!groupBoxIds.length && !allHiddenItems.length) {
        // hidden_field가 없으면 새로 생성
        const pad3 = '\t\t\t';
        lines.push(`${pad3}<xf:group id="" class="hidden_field" style="display:none;">`);
        missingItems.forEach(item => renderItem(item, 4));
        lines.push(`${pad3}</xf:group>`);
      } else {
        // 기존 hidden_field 닫는 태그를 제거 → 아이템 추가 → 닫는 태그 재추가
        // hidden_field 닫는 태그 찾기 (마지막 </xf:group> 중 hidden_field 것)
        for (let li = lines.length - 1; li >= 0; li--) {
          if (lines[li].includes('hidden_field')) {
            for (let ci = li + 1; ci < lines.length; ci++) {
              if (lines[ci].trim() === '</xf:group>') {
                lines.splice(ci, 1); // 닫는 태그 제거
                missingItems.forEach(item => renderItem(item, 4));
                lines.push('\t\t\t</xf:group>'); // 닫는 태그 재추가
                break;
              }
            }
            break;
          }
        }
      }
    }

    lines.push(`\t\t</xf:group>`);
    lines.push(`\t</body>`);
    lines.push(`</html>`);

    const convertedXml = lines.join('\n');

    return {
      convertedXml,
      meta,
      missingVisible, // 보이는 컴포넌트 누락 경고용
      analysis: {
        totalComponents: allComps.length,
        visibleComponents: allComps.filter(c => !c.hidden).length,
        hiddenComponents: hiddenComps.length,
        sectionCount: outputItems.length,
        missingHiddenRecovered: missingComps.length,
        missingVisibleWarning: missingVisible.length,
      },
    };
  }

  return { convert };
})();
