/**
 * WebSquare XML 공통 파서 (xml-parser.js)
 *
 * 절대좌표 XML을 파싱하여 섹션/Row/셀 구조로 분석한다.
 * abs-to-rel-converter.js, wireframe-gen.js가 공통으로 사용한다.
 *
 * 주요 기능:
 *   parseDom(xmlStr)   — DOM 기반 파싱 (브라우저)
 *   parseRegex(xmlStr)  — Regex 기반 파싱 (Node CLI fallback)
 *   clusterRows(comps)  — Y좌표 기반 Row 그룹핑
 *   rowToCells(row)     — Row를 th/td 셀 구조로 변환
 *   analyze(sections)   — 분석 정보 생성
 *
 * 섹션 타입:
 *   groupbox  — GroupBox 단위 (tblbox 또는 schbox로 변환)
 *   grid      — GridView 포함
 *   standalone — GroupBox 밖 독립 컴포넌트
 *
 * th/td 판별 규칙:
 *   th — Text이고 같은 Row 내 뒤쪽에 폼 요소가 있는 경우 (Text+Desc 포함)
 *   td — 폼 요소 (Edit, Calendar, SelectBox, CheckBox, Button 등) + Desc
 */
const XmlParser = (() => {

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
      if (['left', 'top', 'width', 'height'].includes(key)) {
        const m = val.match(/(-?\d+)/);
        if (m) result[key] = parseInt(m[1]);
      }
      if (key === 'visibility') result.visibility = val;
      if (key === 'display') result.display = val;
      if (!['left', 'top', 'width', 'height', 'position'].includes(key)) {
        if (!result._rest) result._rest = [];
        result._rest.push(`${key}:${val}`);
      }
    });
    return result;
  }

  // ─── 컴포넌트 정보 추출 ───

  function getLabel(el) {
    for (const attr of ['label', 'indicator', 'value', 'text']) {
      const v = el.getAttribute(attr);
      if (v) return v;
    }
    const labelChild = el.querySelector('label');
    if (labelChild && labelChild.textContent) return labelChild.textContent.trim();
    return '';
  }

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

  // ─── 상수 ───

  /** 폼 요소 타입 — td에 들어가는 컴포넌트 */
  const INPUT_TYPES = new Set([
    'Edit', 'Calendar', 'SelectBox', 'Combo', 'CheckBox',
    'TextArea', 'Button', 'Trigger', 'LinkText', 'Image', 'Output', 'Radio',
  ]);

  /** 파싱 시 건너뛸 태그 */
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

  function isHiddenStyle(style) {
    return style.visibility === 'hidden' || style.display === 'none';
  }


  // ─── DOM 기반 파싱 (브라우저) ───

  function parseDom(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) throw new Error('XML 파싱 오류: ' + parseError.textContent.substring(0, 200));

    const root = doc.documentElement;
    const meta = { screenId: '', screenName: '', width: 1056, height: 750 };

    // head 메타 추출
    const head = root.querySelector('head');
    if (head) {
      meta.screenId = head.getAttribute('meta_screenId') || '';
      meta.screenName = head.getAttribute('meta_screenName') || '';
    }

    // body > mainGroup 메타 추출
    const body = root.querySelector('body');
    let mainGroup = null;
    if (body) {
      for (const child of body.children) {
        if (child.tagName.split(':').pop().toLowerCase() === 'group') {
          mainGroup = child;
          if (!meta.screenId) meta.screenId = child.getAttribute('screenno') || '';
          if (!meta.screenName) meta.screenName = child.getAttribute('screentitle') || '';
          const style = parseStyle(child.getAttribute('style') || '');
          if (style.width) meta.width = style.width;
          if (style.height) meta.height = style.height;
          break;
        }
      }
    }

    const sections = [];
    const startEl = mainGroup || body || root;

    // --- 컴포넌트 추출 ---

    function extractComp(el, parentHidden) {
      const style = parseStyle(el.getAttribute('style') || '');
      const isHidden = isHiddenStyle(style) || parentHidden;
      const ctype = getCtype(el);
      const id = el.getAttribute('id') || el.getAttribute('orgid') || '';
      const label = getLabel(el);

      const comp = {
        id, ctype, label,
        isTitle: id && id.startsWith('title_'),
        left: style.left || 0, top: style.top || 0,
        width: style.width || 0, height: style.height || 0,
        hidden: isHidden,
        restStyle: style._rest || [],
        originalTag: el.tagName,
        attributes: {},
        innerXml: '',
      };

      for (const attr of el.attributes) {
        if (!['style', 'orgid', 'hierarchy'].includes(attr.name)) {
          comp.attributes[attr.name] = attr.value;
        }
      }

      // GridView: 원본 XML + 컬럼 정보 보존
      if (ctype === 'IBSheet' || ctype === 'GridView') {
        comp.ctype = 'GridView';
        comp.gridXml = el.outerHTML || '';
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

      // Button/CheckBox: 자식 XML 보존
      if (['Button', 'Trigger', 'CheckBox'].includes(ctype) || el.children.length > 0) {
        comp.innerXml = el.innerHTML || '';
      }

      return comp;
    }

    // --- 자식 순회 (GroupBox 내부) ---

    function walkChildren(parent, parentHidden) {
      const comps = [];
      for (const el of parent.children) {
        if (shouldSkip(el.tagName)) continue;

        const style = parseStyle(el.getAttribute('style') || '');
        const ctype = getCtype(el);
        const elHidden = isHiddenStyle(style) || parentHidden;

        // GroupBox (대/소 무관) → 자식을 flat으로 추출
        if (ctype === 'GroupBox') {
          comps.push(...walkChildren(el, elHidden));
          continue;
        }

        // 좌표 없는 요소
        if (style.left == null && style.top == null) {
          // title_ 컴포넌트는 좌표 없어도 수집
          const elId = el.getAttribute('id') || '';
          if (elId.startsWith('title_')) {
            const comp = extractComp(el, parentHidden);
            if (comp) comps.push(comp);
          } else {
            comps.push(...walkChildren(el, parentHidden));
          }
          continue;
        }

        const comp = extractComp(el, elHidden);
        if (comp) comps.push(comp);
      }
      return comps;
    }

    // --- 최상위 섹션 분류 ---

    for (const el of startEl.children) {
      if (shouldSkip(el.tagName)) continue;

      const style = parseStyle(el.getAttribute('style') || '');
      const ctype = getCtype(el);
      const id = el.getAttribute('id') || '';
      const tag = el.tagName.split(':').pop().toLowerCase();
      const selfHidden = isHiddenStyle(style);

      if (ctype === 'GroupBox') {
        // GroupBox → 자식 수집하여 groupbox 섹션
        const children = walkChildren(el, selfHidden);
        if (children.length > 0) {
          sections.push({ type: 'groupbox', groupId: id, top: style.top || 0, height: style.height || 0, hidden: selfHidden, comps: children });
        }
      } else if (ctype === 'GridView' || ctype === 'IBSheet') {
        const comp = extractComp(el, false);
        if (comp) {
          comp.ctype = 'GridView';
          sections.push({ type: 'grid', top: style.top || 0, hidden: false, comps: [comp] });
        }
      } else if (ctype === 'TAB') {
        // TAB 컴포넌트 → tab 섹션 (tbcbox로 변환)
        const comp = extractComp(el, selfHidden);
        if (comp) {
          sections.push({ type: 'tab', top: style.top || 0, hidden: selfHidden, comps: [comp] });
        }
      } else if (ctype === 'Panel') {
        // Panel(w2:pageFrame) → 독립 블록 섹션
        const comp = extractComp(el, selfHidden);
        if (comp) {
          sections.push({ type: 'standalone', top: style.top || 0, hidden: selfHidden, comps: [comp] });
        }
      } else if (tag === 'group' && el.children.length > 0) {
        // 일반 Group (grd_wrap 등) — TAB 포함 시 분리
        const hasTab = Array.from(el.children).some(ch => getCtype(ch) === 'TAB');
        if (hasTab) {
          for (const ch of el.children) {
            if (shouldSkip(ch.tagName)) continue;
            const chCtype = getCtype(ch);
            const chStyle = parseStyle(ch.getAttribute('style') || '');
            if (chCtype === 'TAB') {
              const comp = extractComp(ch, selfHidden);
              if (comp) sections.push({ type: 'tab', top: chStyle.top || style.top || 0, hidden: selfHidden, comps: [comp] });
            } else {
              const comp = extractComp(ch, selfHidden);
              if (comp) sections.push({ type: 'standalone', top: chStyle.top || style.top || 0, hidden: comp.hidden, comps: [comp] });
            }
          }
        } else {
          const children = walkChildren(el, selfHidden);
          const hasGrid = children.some(c => c.ctype === 'GridView');
          if (hasGrid) {
            sections.push({ type: 'grid', top: style.top || 0, hidden: selfHidden, comps: children });
          } else if (children.length > 0) {
            sections.push({ type: 'groupbox', groupId: id, top: style.top || 0, hidden: selfHidden, comps: children });
          }
        }
      } else {
        // 독립 컴포넌트
        if (style.left == null && style.top == null) continue;
        const comp = extractComp(el, false);
        if (comp) {
          sections.push({ type: 'standalone', top: style.top || 0, hidden: comp.hidden, comps: [comp] });
        }
      }
    }

    // --- 겹침 감지: GroupBox 영역에 오버레이되는 고아 컴포넌트 → 해당 GroupBox의 overlayComps로 이관 ---
    const gbSections = sections.filter(s => s.type === 'groupbox' && s.groupId);
    const removeIdxs = new Set();
    sections.forEach((s, si) => {
      // groupId 없는 groupbox 또는 standalone 섹션만 대상
      if (s.groupId || (s.type !== 'groupbox' && s.type !== 'standalone')) return;
      s.comps.forEach(comp => {
        if (comp.hidden) return;
        // Panel(w2:pageFrame)은 외부 화면 참조 블록이므로 overlayComp 흡수 제외
        if (comp.ctype === 'Panel') return;
        const ct = comp.top || 0;
        // 컴포넌트의 top이 GroupBox 범위(top ~ top+height) 안에 겹치는지 확인
        const target = gbSections.find(gb =>
          gb.height > 0 && ct >= gb.top && ct < gb.top + gb.height
        );
        if (target) {
          if (!target.overlayComps) target.overlayComps = [];
          target.overlayComps.push(comp);
        }
      });
      // 모든 컴포넌트가 이관되었으면 섹션 제거 대상
      const allMoved = s.comps.every(c => c.hidden || gbSections.some(gb => gb.overlayComps && gb.overlayComps.includes(c)));
      if (allMoved) removeIdxs.add(si);
    });
    // 빈 섹션 제거 (역순)
    [...removeIdxs].sort((a, b) => b - a).forEach(i => sections.splice(i, 1));

    // top 순서로 정렬 (원본 좌표 순서 보장)
    sections.sort((a, b) => a.top - b.top);

    return { meta, sections };
  }


  // ─── Regex 기반 파싱 (Node CLI fallback) ───

  function parseRegex(xmlStr) {
    function getAttr(tag, name) {
      const m = tag.match(new RegExp(name + '="([^"]*)"', 'i'));
      return m ? m[1] : '';
    }

    const meta = { screenId: '', screenName: '', width: 0, height: 0 };
    const hm = xmlStr.match(/<head([^>]*)>/i);
    if (hm) { meta.screenId = getAttr(hm[0], 'meta_screenId'); meta.screenName = getAttr(hm[0], 'meta_screenName'); }
    const gm = xmlStr.match(/<(?:xf:)?group[^>]*screen(?:no|title)[^>]*>/i);
    if (gm) {
      if (!meta.screenId) meta.screenId = getAttr(gm[0], 'screenno');
      if (!meta.screenName) meta.screenName = getAttr(gm[0], 'screentitle');
      const gs = parseStyle(getAttr(gm[0], 'style'));
      if (gs.width) meta.width = gs.width;
      if (gs.height) meta.height = gs.height;
    }

    const comps = [];
    const tagRe = /<((?:xf|w2):(?:input|textbox|trigger|select1|checkbox|textarea|gridView|group|anchor|inputCalendar|output|select))\s([^>]*?)(?:\/>|>)/gi;
    let m;
    while ((m = tagRe.exec(xmlStr)) !== null) {
      const tn = m[1];
      const st = parseStyle(getAttr(m[0], 'style'));
      if (st.left == null || st.top == null) continue;

      const attrs = {};
      const ar = /(\w[\w-]*)="([^"]*)"/g;
      let am;
      while ((am = ar.exec(m[2])) !== null) attrs[am[1]] = am[2];

      const tag = tn.split(':').pop().toLowerCase();
      let ctype = tag === 'inputcalendar' ? 'Calendar' :
        (attrs.ctype || { input: 'Edit', textbox: 'Text', trigger: 'Button', select1: 'SelectBox',
          checkbox: 'CheckBox', textarea: 'TextArea', gridview: 'GridView', group: 'Group',
          anchor: 'LinkText', select: 'CheckBox', output: 'Output' }[tag] || tag);
      if (ctype === 'IBSheet') ctype = 'GridView';

      const id = attrs.id || attrs.orgid || '';
      if (ctype === 'GroupBox' || (ctype === 'Group' && st.width && st.height && st.width > 100)) continue;
      if (id && /^GroupBox/i.test(id) && st.height && st.height > 50) continue;

      const label = attrs.label || attrs.indicator || attrs.value || attrs.text || '';
      const comp = {
        id, ctype, label,
        isTitle: id && id.startsWith('title_'),
        left: st.left || 0, top: st.top || 0,
        width: st.width || 0, height: st.height || 0,
        hidden: isHiddenStyle(st),
        attrs,
      };

      if (ctype === 'GridView') {
        comp.columns = [];
        const gi = xmlStr.indexOf(m[0]);
        const ge = xmlStr.indexOf('</w2:gridView>', gi);
        if (ge > 0) {
          const gx = xmlStr.substring(gi, ge + 14);
          const he = gx.indexOf('</w2:header>');
          const cr = /<w2:column[^>]*value="([^"]*)"[^>]*width="(\d+)"[^>]*\/?>/g;
          let cm2;
          while ((cm2 = cr.exec(gx)) !== null) {
            if (cm2.index < he) comp.columns.push({ label: cm2[1], width: +cm2[2] });
          }
        }
      }
      comps.push(comp);
    }
    return { meta, components: comps };
  }


  // ─── Row 클러스터링 ───

  function clusterRows(comps, threshold = 5) {
    const visible = comps.filter(c => !c.hidden && !c.isTitle);
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


  // ─── 셀 구조 분석 ───

  /**
   * Text 뒤에 같은 Row 내에서 폼 요소가 있는지 확인
   * 다른 Text를 만나면 중단 (다른 라벨-입력 쌍의 시작)
   */
  function hasFormAfter(row, fromIdx) {
    for (let j = fromIdx; j < row.length; j++) {
      const ct = row[j].ctype || row[j].attrs?.ctype || '';
      if (INPUT_TYPES.has(ct)) return true;
      if (ct === 'Text') return false;
    }
    return false;
  }

  /**
   * Row를 th/td 셀 구조로 변환
   *
   * th: Text이고 뒤에 폼 요소가 있는 경우 + 연속 Text/Desc 포함
   * td: 폼 요소부터 다음 th 시작 전까지
   */
  function rowToCells(row) {
    const cells = [];
    let i = 0;
    while (i < row.length) {
      const comp = row[i];
      const ctype = comp.ctype || comp.attrs?.ctype || '';
      const isLabelTh = ctype === 'Text' && hasFormAfter(row, i + 1);

      if (isLabelTh) {
        // th: Text + 연속 Text/Desc를 폼 요소 전까지 포함
        const thComps = [comp];
        i++;
        while (i < row.length) {
          const next = row[i];
          const nextCtype = next.ctype || next.attrs?.ctype || '';
          if (nextCtype === 'Text' || nextCtype === 'Desc') {
            thComps.push(next);
            i++;
          } else {
            break;
          }
        }
        cells.push({ type: 'th', comps: thComps });
      } else {
        // td: 폼 요소 + 다음 th 시작 전까지
        const tdComps = [comp];
        i++;
        while (i < row.length) {
          const next = row[i];
          const nextCtype = next.ctype || next.attrs?.ctype || '';
          if (nextCtype === 'Text' && hasFormAfter(row, i + 1)) break;
          tdComps.push(next);
          i++;
        }
        cells.push({ type: 'td', comps: tdComps });
      }
    }
    return cells;
  }


  // ─── 분석 정보 ───

  function analyze(sections) {
    const allComps = sections.flatMap(s => s.comps);
    const visibleComps = allComps.filter(c => !c.hidden);
    const hiddenComps = allComps.filter(c => c.hidden);
    const hasSearchBtn = visibleComps.some(c =>
      ['Button', 'Trigger'].includes(c.ctype) &&
      (/(조회|search|inqry)/i.test(c.label || '') || /(조회|search|inqry)/i.test(c.id || ''))
    );
    return {
      totalComponents: allComps.length,
      visibleComponents: visibleComps.length,
      hiddenComponents: hiddenComps.length,
      sectionCount: sections.filter(s => !s.hidden).length,
      hasSearchBtn,
      sections: sections.map(s => ({
        type: s.type, top: s.top, groupId: s.groupId || '',
        hidden: s.hidden, componentCount: s.comps.length,
      })),
    };
  }


  return { parseDom, parseRegex, clusterRows, rowToCells, analyze, parseStyle, INPUT_TYPES };
})();

if (typeof module !== 'undefined') module.exports = XmlParser;
