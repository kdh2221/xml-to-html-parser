/**
 * XML to HTML 변환기 (xml-to-html.js)
 *
 * 상대좌표(rel) WebSquare XML → 퍼블리싱 HTML.
 * - xf:* / w2:* 태그를 표준 HTML 태그로 치환하되, .sub_contents/.titbox/.tblbox 등 KB
 *   퍼블리싱 클래스는 그대로 유지한다.
 * - WebSquare 전용 속성(ctype/hierarchy/orgid/ref 등)은 기본적으로 data-ws-* 로 보존.
 * - kb-publish.css 를 외부 링크로 참조 (옵션으로 인라인 가능).
 *
 * 사용:
 *   const html = XmlToHtml.convert(xmlStr, {
 *     fileName:        'KFA04011Z02_pub.xml',
 *     inlineCss:       false,      // true → <style> 임베드
 *     preserveAttrs:   true,       // true → data-ws-* 로 WS 속성 유지
 *     preserveScript:  false,      // true → 원본 script 를 <!-- … --> 로 보존
 *     dataPlaceholder: true,       // true → 빈 그리드 tbody 에 placeholder row
 *   });
 */
const XmlToHtml = (() => {

  // ─── 매핑 테이블 ──────────────────────────────────────────────

  // xf:/w2: 컴포넌트 태그 → 출력 HTML 태그 + 부가 처리
  // 키는 모두 소문자 ns:local 형식 (디스패처가 lowercase 비교)
  // tagname 속성이 있는 경우는 별도 우선 처리(`renderGroup`).
  const TAG_MAP = {
    'xf:input':         renderInput,
    'xf:secret':        el => renderInput(el, 'password'),
    'xf:textarea':      renderTextarea,
    'xf:select1':       renderSelect,
    'xf:select':        renderSelect,
    'xf:trigger':       renderTrigger,
    'xf:upload':        el => renderSimple(el, 'input', { type: 'file' }),
    'xf:output':        el => renderSimple(el, 'span', { class: 'output' }),
    'xf:label':         renderLabel,
    'w2:textbox':       renderTextbox,
    'w2:anchor':        renderAnchor,
    'w2:span':          el => renderSimpleWithLabel(el, 'span'),
    'w2:calendar':      renderCalendar,
    'w2:inputcalendar': renderCalendar,
    'w2:gridview':      renderGridView,
    'w2:tabcontrol':    renderTabControl,
  };

  // dataType / displayFormat 에 따라 input 의 inputmode/placeholder/type 을 결정
  function inferInputType(el) {
    const dataType = el.getAttribute('dataType') || '';
    const displayFmt = el.getAttribute('displayFormat') || '';
    const insertComma = el.getAttribute('insertcomma') === '1';
    const indicator = el.getAttribute('indicator') || '';
    let type = 'text';
    let inputmode = null;
    let placeholder = '';

    if (dataType === '숫자/금액' || insertComma) {
      inputmode = 'numeric';
      if (displayFmt) placeholder = displayFmt;
    } else if (/YYYY/.test(displayFmt)) {
      type = 'text';
      placeholder = displayFmt;
    } else if (dataType === '이메일') {
      type = 'email';
    } else if (dataType === '전화번호') {
      type = 'tel';
      inputmode = 'tel';
    }
    return { type, inputmode, placeholder, indicator };
  }

  // 출력에 그대로 유지할 HTML 표준 속성
  const STANDARD_ATTRS = new Set([
    'id', 'class', 'style', 'disabled', 'readonly', 'maxlength', 'placeholder',
    'type', 'value', 'name', 'href', 'src', 'alt', 'title', 'colspan', 'rowspan',
    'tabindex', 'role', 'aria-label', 'aria-hidden', 'checked', 'selected',
    'width', 'height', 'autocomplete', 'inputmode', 'pattern', 'min', 'max', 'step',
  ]);

  // tagname 으로 분기되는 group 의 자식 라우팅에서 사용하는 표준 HTML 태그
  const VALID_TAGNAME = new Set([
    'table', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'div', 'section', 'article',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a',
  ]);

  // ─── 메인 ─────────────────────────────────────────────────────

  function convert(xmlStr, options = {}) {
    const opts = Object.assign({
      fileName: '',
      inlineCss: false,            // true → <style> 임베드 (cssContents 사용)
      preserveAttrs: true,         // data-ws-* 보존
      preserveScript: false,
      dataPlaceholder: true,
      // 출력 HTML 에 삽입할 <link rel=stylesheet> 경로들.
      // base → product (WebSquare vendor) → bridge (XmlToHtml 호환 레이어) 순.
      cssHrefs: ['css/base.css', 'css/product.css', 'css/bridge.css'],
      // baseHref: '...' 지정 시 <base href="..."> 삽입. iframe srcdoc 미리보기에서 사용.
      baseHref: '',
      // inlineCss=true 시 사용. { 'css/base.css': '...본문...' } 매핑.
      cssContents: null,
    }, options);

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');
    const perr = doc.querySelector('parsererror');
    if (perr) throw new Error('XML parse error: ' + (perr.textContent || '').slice(0, 200));

    const root = doc.documentElement;
    const head = root.querySelector('head');
    const body = root.querySelector('body');
    if (!body) throw new Error('<body> 를 찾을 수 없습니다.');

    const meta = extractMeta(head, opts.fileName);
    // 모든 컴포넌트 렌더러가 currentOpts() 로 동일한 옵션 객체를 참조하도록 defaulting 끝난 후 설정
    _currentOpts = opts;
    const bodyHtml = renderChildren(body);
    const scriptComment = opts.preserveScript ? extractScriptComment(head) : '';

    const cssTags = buildCssTags(opts);
    const baseTag = opts.baseHref ? `<base href="${esc(opts.baseHref)}">` : '';

    return [
      '<!DOCTYPE html>',
      '<html lang="ko">',
      '<head>',
      '<meta charset="UTF-8">',
      baseTag,
      `<title>${esc(meta.title)}</title>`,
      `<meta name="generator" content="websquare-publishing-editor / XmlToHtml">`,
      meta.screenId ? `<meta name="screen-id" content="${esc(meta.screenId)}">` : '',
      meta.asisFileNm ? `<meta name="asis-file" content="${esc(meta.asisFileNm)}">` : '',
      cssTags,
      scriptComment,
      '</head>',
      '<body>',
      bodyHtml,
      '</body>',
      '</html>',
      '',
    ].filter(Boolean).join('\n');
  }

  /** opts 의 cssHrefs / cssContents / inlineCss 를 종합해 <link> 또는 <style> 태그 문자열 반환 */
  function buildCssTags(opts) {
    if (opts.inlineCss) {
      // cssContents 가 제공되면 그 내용을 <style> 로 임베드. 아니면 fallback.
      if (opts.cssContents) {
        const parts = [];
        for (const href of opts.cssHrefs) {
          const css = opts.cssContents[href];
          if (css) parts.push(`<style data-source="${esc(href)}">\n${css}\n</style>`);
        }
        if (parts.length) return parts.join('\n');
      }
      return `<style>\n${KB_PUBLISH_CSS_FALLBACK}\n</style>`;
    }
    return opts.cssHrefs.map(h => `<link rel="stylesheet" href="${esc(h)}">`).join('\n');
  }

  function extractMeta(head, fileName) {
    if (!head) return { title: fileName || 'WebSquare Screen', screenId: '', asisFileNm: '' };
    const screenId = head.getAttribute('meta_screenId') || '';
    const screenName = head.getAttribute('meta_screenName') || '';
    const asisFileNm = head.getAttribute('meta_asisFileNm') || '';
    const title = screenName
      || screenId
      || asisFileNm.replace(/\.scn$/i, '')
      || (fileName || '').replace(/\.xml$/i, '')
      || 'WebSquare Screen';
    return { title, screenId, screenName, asisFileNm };
  }

  function extractScriptComment(head) {
    if (!head) return '';
    const scripts = head.getElementsByTagName('script');
    if (!scripts.length) return '';
    const text = Array.from(scripts).map(s => (s.textContent || '').trim()).filter(Boolean).join('\n');
    if (!text) return '';
    // 주석 안전 처리: '-->' 차단
    return `<!-- websquare-script\n${text.replace(/-->/g, '-- >')}\n-->`;
  }

  // ─── 디스패처 ────────────────────────────────────────────────

  function renderNode(el) {
    if (el.nodeType !== 1) return '';
    const tag = (el.tagName || '').toLowerCase();
    const nsLocal = tag.replace(/^[^:]+:/, '');

    // w2:attributes 는 부모 td/th 의 colspan/rowspan 출력에서 별도 처리됨
    if (nsLocal === 'attributes') return '';

    // 부모 컴포넌트가 처리하는 자식들은 단독 출력 X
    if (['label', 'choices', 'item', 'value', 'caption', 'header', 'gbody', 'row', 'column', 'tabs', 'content', 'keyinfo', 'key'].includes(nsLocal)) {
      return '';
    }

    if (nsLocal === 'group') return renderGroup(el);

    const handler = TAG_MAP[tag];
    if (handler) return handler(el);

    return renderChildren(el);
  }

  function renderChildren(parent) {
    let html = '';
    for (const child of parent.children) {
      html += renderNode(child);
    }
    return html;
  }

  // ─── group 라우팅 ────────────────────────────────────────────

  function renderGroup(el) {
    const tagnameAttr = (el.getAttribute('tagname') || '').toLowerCase();
    const cls = el.getAttribute('class') || '';

    // 1) tagname 이 있는 경우 → table/tr/th/td/colgroup/col/li/ul/h2…
    if (tagnameAttr) {
      const outTag = VALID_TAGNAME.has(tagnameAttr) ? tagnameAttr : 'div';
      const attrs = buildAttrs(el, currentOpts(), { drop: ['tagname'] });
      const cs = readW2Attr(el, 'colspan');
      const rs = readW2Attr(el, 'rowspan');
      const extra = [];
      if (cs && +cs > 1) extra.push(`colspan="${esc(cs)}"`);
      if (rs && +rs > 1) extra.push(`rowspan="${esc(rs)}"`);
      const attrStr = mergeAttrStr(attrs, extra.join(' '));
      if (outTag === 'col') return `<col${attrStr}>`;
      return `<${outTag}${attrStr}>${renderChildren(el)}</${outTag}>`;
    }

    // 2) 일반 wrapper group → class 기반 div + 자식 재귀
    const attrs = buildAttrs(el, currentOpts());
    const isHidden = cls.split(/\s+/).includes('hidden_field');
    const extraAttr = isHidden ? ' hidden' : '';
    return `<div${attrs}${extraAttr}>${renderChildren(el)}</div>`;
  }

  // <w2:attributes><w2:colspan>N</w2:colspan></w2:attributes> 패턴에서 값 추출
  function readW2Attr(el, name) {
    for (const child of el.children) {
      const tag = (child.tagName || '').toLowerCase().replace(/^[^:]+:/, '');
      if (tag !== 'attributes') continue;
      for (const sub of child.children) {
        const subTag = (sub.tagName || '').toLowerCase().replace(/^[^:]+:/, '');
        if (subTag === name) return (sub.textContent || '').trim();
      }
    }
    return '';
  }

  // ─── 컴포넌트 렌더러 ────────────────────────────────────────

  function renderInput(el, forceType) {
    const inferred = inferInputType(el);
    const type = forceType || inferred.type;
    // disabled 는 buildAttrs 가 boolean 변환 → 여기서 중복 추가 금지
    const attrs = buildAttrs(el, currentOpts(), {
      drop: ['dataType', 'displayFormat', 'insertcomma', 'rightalign'],
    });
    const extra = [`type="${type}"`];
    if (inferred.inputmode) extra.push(`inputmode="${inferred.inputmode}"`);
    if (inferred.placeholder && !el.getAttribute('placeholder')) {
      extra.push(`placeholder="${esc(inferred.placeholder)}"`);
    }
    if (el.getAttribute('mandatory') === '1') extra.push('required');
    return `<input${mergeAttrStr(attrs, extra.join(' '))}>`;
  }

  function renderTextarea(el) {
    const attrs = buildAttrs(el, currentOpts());
    return `<textarea${attrs}></textarea>`;
  }

  function renderSelect(el) {
    const attrs = buildAttrs(el, currentOpts(), {
      drop: ['appearance', 'submenuSize', 'submenusize', 'direction', 'renderType', 'rendertype',
             'allOption', 'alloption', 'chooseOption', 'chooseoption', 'disabledClass', 'disabledclass'],
    });
    // <xf:choices><xf:item><xf:label>…<xf:value>…</xf:item>…</xf:choices>
    let options = '';
    const choices = findChild(el, 'choices');
    if (choices) {
      for (const item of choices.children) {
        const itemTag = (item.tagName || '').toLowerCase().replace(/^[^:]+:/, '');
        if (itemTag !== 'item') continue;
        const labelEl = findChild(item, 'label');
        const valueEl = findChild(item, 'value');
        const label = labelEl ? textOf(labelEl) : '';
        const value = valueEl ? textOf(valueEl) : '';
        options += `<option value="${esc(value)}">${esc(label)}</option>`;
      }
    }
    const chooseOption = el.getAttribute('chooseOption') || '';
    const allOption = el.getAttribute('allOption') === 'true';
    if (allOption && !options) options = `<option value="">전체</option>` + options;
    else if (chooseOption) options = `<option value="">${esc(chooseOption)}</option>` + options;

    return `<select${attrs}>${options}</select>`;
  }

  function renderTrigger(el) {
    const text = pickLabel(el) || el.getAttribute('text') || el.getAttribute('id') || '';
    const attrs = buildAttrs(el, currentOpts(), { drop: ['text', 'type'] });
    const typeAttr = (el.getAttribute('type') || 'button').toLowerCase();
    return `<button type="${esc(typeAttr)}"${attrs}>${esc(text)}</button>`;
  }

  function renderAnchor(el) {
    const text = pickLabel(el) || el.getAttribute('label') || el.getAttribute('text') || el.getAttribute('id') || '';
    const href = el.getAttribute('href') || '#';
    const attrs = buildAttrs(el, currentOpts(), { drop: ['outerDiv', 'outerdiv', 'href'] });
    return `<a href="${esc(href)}"${attrs}>${esc(text)}</a>`;
  }

  function renderTextbox(el) {
    const tagnameAttr = (el.getAttribute('tagname') || '').toLowerCase();
    const label = el.getAttribute('label') || '';
    const attrs = buildAttrs(el, currentOpts(), { drop: ['tagname', 'label', 'linespace', 'imagealign'] });
    if (VALID_TAGNAME.has(tagnameAttr) && /^h[1-6]$/.test(tagnameAttr)) {
      return `<${tagnameAttr}${attrs}>${esc(label)}</${tagnameAttr}>`;
    }
    if (tagnameAttr && VALID_TAGNAME.has(tagnameAttr)) {
      return `<${tagnameAttr}${attrs}>${esc(label)}</${tagnameAttr}>`;
    }
    // 기본: <span class="txt">
    return `<span class="txt"${attrs}>${esc(label)}</span>`;
  }

  function renderCalendar(el) {
    const attrs = buildAttrs(el, currentOpts(), { drop: ['displayFormat', 'displayformat'] });
    return `<input type="text"${mergeAttrStr(attrs, 'placeholder="YYYY/MM/DD"')}>`;
  }

  function renderLabel(el) {
    return esc(textOf(el));
  }

  function renderSimple(el, htmlTag, extraAttrs) {
    const attrs = buildAttrs(el, currentOpts());
    const extra = Object.entries(extraAttrs || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    return `<${htmlTag}${mergeAttrStr(attrs, extra)}></${htmlTag}>`;
  }

  function renderSimpleWithLabel(el, htmlTag) {
    const label = el.getAttribute('label') || '';
    const attrs = buildAttrs(el, currentOpts(), { drop: ['label'] });
    return `<${htmlTag}${attrs}>${esc(label)}</${htmlTag}>`;
  }

  // ─── w2:gridView ──────────────────────────────────────────────

  function renderGridView(el) {
    const opts = currentOpts();
    const id = el.getAttribute('id') || '';
    // class 가 없으면 'gvw' 강제. buildAttrs 가 class 를 출력하므로 중복 주의.
    if (!el.getAttribute('class')) el.setAttribute('class', 'gvw');
    const attrs = buildAttrs(el, opts, {
      drop: ['container', 'tabstop', 'enterstop', 'paper', 'dataList', 'datalist',
             'adjusttheme', 'indicator', 'autoFit', 'autofit'],
    });

    // header > row > column[value][width]
    const header = findChild(el, 'header');
    const columns = [];
    if (header) {
      const headerRow = findChild(header, 'row');
      if (headerRow) {
        for (const col of headerRow.children) {
          const colTag = (col.tagName || '').toLowerCase().replace(/^[^:]+:/, '');
          if (colTag !== 'column') continue;
          columns.push({
            value: col.getAttribute('value') || '',
            width: col.getAttribute('width') || '',
            id: col.getAttribute('id') || '',
          });
        }
      }
    }
    // gBody > row > column (실제 컬럼 ID 들)
    const gBody = findChild(el, 'gBody') || findChild(el, 'gbody');
    const bodyCols = [];
    if (gBody) {
      const bodyRow = findChild(gBody, 'row');
      if (bodyRow) {
        for (const col of bodyRow.children) {
          const colTag = (col.tagName || '').toLowerCase().replace(/^[^:]+:/, '');
          if (colTag !== 'column') continue;
          bodyCols.push({
            width: col.getAttribute('width') || '',
            id: col.getAttribute('id') || '',
          });
        }
      }
    }

    let html = `<table${attrs}>`;
    // colgroup
    if (columns.length) {
      html += '<colgroup>';
      columns.forEach(c => {
        html += c.width ? `<col style="width:${esc(c.width)}px">` : '<col>';
      });
      html += '</colgroup>';
    }
    // thead
    if (columns.length) {
      html += '<thead><tr>';
      columns.forEach(c => { html += `<th>${esc(c.value)}</th>`; });
      html += '</tr></thead>';
    }
    // tbody (placeholder)
    html += '<tbody>';
    if (opts.dataPlaceholder) {
      const span = Math.max(columns.length, bodyCols.length, 1);
      html += `<tr class="grid-placeholder"><td colspan="${span}">(데이터 영역 — ${esc(id)})</td></tr>`;
    }
    html += '</tbody>';
    html += '</table>';
    return html;
  }

  // ─── w2:tabControl ────────────────────────────────────────────

  function renderTabControl(el) {
    const opts = currentOpts();
    const tabs = [];
    const contents = [];
    for (const child of el.children) {
      const tag = (child.tagName || '').toLowerCase().replace(/^[^:]+:/, '');
      if (tag === 'tabs') tabs.push(child);
      else if (tag === 'content') contents.push(child);
    }
    const id = el.getAttribute('id') || '';
    const attrs = buildAttrs(el, opts, { drop: ['alwaysDraw', 'alwaysdraw'] });

    let html = `<div${mergeAttrStr(attrs, 'class="tbc"')}>`;
    // 탭 헤더
    html += `<div class="tbc_tabs" role="tablist">`;
    tabs.forEach((t, i) => {
      const label = t.getAttribute('label') || t.getAttribute('id') || `Tab ${i + 1}`;
      const tid = t.getAttribute('id') || `tab${i + 1}`;
      const disabled = t.getAttribute('disabled') === 'true' ? ' disabled' : '';
      const activeCls = i === 0 ? ' active' : '';
      html += `<button type="button" class="tbc_tab${activeCls}" role="tab" data-target="${esc(tid)}_panel"${disabled}>${esc(label)}</button>`;
    });
    html += `</div>`;
    // 탭 패널
    contents.forEach((c, i) => {
      const cid = c.getAttribute('id') || `content${i + 1}`;
      const activeCls = i === 0 ? ' active' : '';
      const hiddenAttr = i === 0 ? '' : ' hidden';
      html += `<div id="${esc(cid)}_panel" class="tbc_panel${activeCls}" role="tabpanel"${hiddenAttr}>`;
      html += renderChildren(c);
      html += `</div>`;
    });
    html += `</div>`;
    return html;
  }

  // ─── 속성 빌더 ────────────────────────────────────────────────

  let _currentOpts = {};
  function currentOpts() { return _currentOpts; }

  /** 표준/비표준 속성을 분리하여 출력. 비표준은 preserveAttrs 옵션 시 data-ws-* 로 보존 */
  function buildAttrs(el, opts, options) {
    opts = opts || currentOpts();
    const drop = new Set((options && options.drop) || []);
    const standard = [];
    const wsAttrs = [];

    for (const a of el.attributes) {
      const name = a.name;
      const value = a.value;
      if (drop.has(name) || drop.has(name.toLowerCase())) continue;
      const lower = name.toLowerCase();
      if (STANDARD_ATTRS.has(lower)) {
        // disabled="true"/"false" → boolean 속성
        if (lower === 'disabled') {
          if (value === 'true' || value === '' || value === 'disabled') standard.push('disabled');
          continue;
        }
        if (lower === 'readonly') {
          if (value === 'true' || value === '' || value === 'readonly') standard.push('readonly');
          continue;
        }
        // style 이 빈 값이면 출력 생략
        if (lower === 'style' && !value) continue;
        // class 가 빈 값이면 생략
        if (lower === 'class' && !value.trim()) continue;
        // id 가 빈 값이면 생략
        if (lower === 'id' && !value) continue;
        standard.push(`${lower}="${esc(value)}"`);
      } else if (opts.preserveAttrs) {
        // data-ws-* 로 prefix. 한국어 속성명은 패스 (data- 속성은 ASCII)
        if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) continue;
        const kebab = camelToKebab(name);
        wsAttrs.push(`data-ws-${kebab}="${esc(value)}"`);
      }
    }

    const all = standard.concat(wsAttrs);
    return all.length ? ' ' + all.join(' ') : '';
  }

  function mergeAttrStr(attrs, extra) {
    if (!extra) return attrs;
    if (!attrs) return ' ' + extra;
    return attrs + ' ' + extra;
  }

  function camelToKebab(s) {
    return s.replace(/[A-Z]/g, m => '-' + m.toLowerCase()).replace(/_/g, '-');
  }

  // ─── 유틸 ─────────────────────────────────────────────────────

  function findChild(el, localTag) {
    for (const c of el.children) {
      const t = (c.tagName || '').toLowerCase().replace(/^[^:]+:/, '');
      if (t === localTag.toLowerCase()) return c;
    }
    return null;
  }

  function pickLabel(el) {
    // <xf:label>…</xf:label> 자식 우선, 없으면 attribute
    const lbl = findChild(el, 'label');
    if (lbl) return textOf(lbl);
    return '';
  }

  function textOf(el) {
    return (el.textContent || '').trim();
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── 인라인 CSS 폴백 (옵션) ────────────────────────────────────
  // inlineCss=true 일 때 사용. 본 파일은 css/kb-publish.css 와 동기 유지가 원칙이지만,
  // 단독 실행 모드에서는 이 폴백이 충분한 기본 스타일을 제공한다.
  const KB_PUBLISH_CSS_FALLBACK = `
body{font-family:'Pretendard','Malgun Gothic',sans-serif;color:#1e293b;padding:20px;background:#fff}
.sub_contents{display:flex;flex-direction:column;gap:14px;max-width:1200px;margin:0 auto}
.titbox{display:flex;align-items:center;gap:10px}
.titbox h2,.titbox h3{font-size:18px;font-weight:700;margin:0;color:#0f172a}
.titbox h3{font-size:16px}
.tblbox,.schbox,.gvwbox,.btnbox{border:1px solid #e2e8f0;border-radius:6px;padding:12px;background:#fff}
.schbox{background:#f8fafc}
.w2tb.tbl,table.w2tb{width:100%;border-collapse:collapse}
.w2tb.tbl th,.w2tb.tbl td{border:1px solid #cbd5e1;padding:8px 10px;font-size:13px}
.w2tb.tbl th,.w2tb_th{background:#f1f5f9;text-align:left;font-weight:600;color:#334155;width:160px}
.w2tb.tbl td,.w2tb_td{background:#fff}
.gvwbox table.gvw{width:100%;border-collapse:collapse;table-layout:fixed}
.gvwbox table.gvw th{background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;padding:6px 8px;font-size:12px}
.gvwbox table.gvw td{border:1px solid #e2e8f0;padding:6px 8px;font-size:12px}
.gvwbox .grid-placeholder td{color:#94a3b8;text-align:center;font-style:italic;padding:30px 8px}
.btnbox{display:flex;gap:6px;align-items:center;justify-content:space-between}
.btnbox .lt,.btnbox .rt{display:flex;gap:6px;align-items:center}
.btnbox .lt{justify-content:flex-start}
.btnbox .rt{justify-content:flex-end;flex:1}
.btn_cm{padding:6px 14px;font-size:13px;font-weight:600;background:#1e293b;color:#fff;border:1px solid #1e293b;border-radius:4px;cursor:pointer}
.btn_cm.pt{background:#fff;color:#1e293b}
.btn_cm.search{background:#2563eb;border-color:#2563eb}
input,select,textarea{padding:4px 8px;border:1px solid #cbd5e1;border-radius:3px;font-size:13px;font-family:inherit}
input[disabled]{background:#f1f5f9;color:#64748b}
.txt{display:inline-block;font-size:13px;color:#334155;margin-right:6px}
.txt_red{color:#dc2626}
.tit_main{font-size:18px;font-weight:700;color:#0f172a;margin:0}
.tit_sub{font-size:14px;font-weight:600;color:#334155;margin:0}
.hidden_field{display:none!important}
.tbc{border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}
.tbc_tabs{display:flex;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.tbc_tab{padding:8px 16px;border:none;background:none;cursor:pointer;font-weight:600;color:#64748b;border-bottom:2px solid transparent}
.tbc_tab.active{color:#2563eb;border-bottom-color:#2563eb;background:#fff}
.tbc_panel{padding:12px}
.tbc_panel[hidden]{display:none}
.pgtbox{display:flex;align-items:center;gap:10px;padding:8px 0}
.pgt_tit{font-size:20px;font-weight:700;color:#0f172a}
.breadcrumb ul{display:flex;gap:4px;list-style:none;font-size:12px;color:#64748b;padding:0;margin:0}
.breadcrumb li::after{content:'›';margin-left:4px;color:#cbd5e1}
.breadcrumb li:last-child::after{content:''}
.lybox{display:flex;gap:14px}
.lybox > .col_2,.lybox > .col_3,.lybox > .col_4{flex:1}
.btn_schbox{display:flex;gap:6px;margin-top:8px;justify-content:flex-end}
.req::after{content:' *';color:#dc2626}
.output{display:inline-block;font-size:13px}
`;

  // ─── public ───────────────────────────────────────────────────

  return {
    convert,
    // 테스트/디버그용 export
    _internal: { renderNode, renderChildren, esc },
  };
})();

// CommonJS / jsdom 환경 지원 (regression 스크립트용)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = XmlToHtml;
}
