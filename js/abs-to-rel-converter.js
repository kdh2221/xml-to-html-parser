/**
 * WebSquare 절대좌표 → 상대좌표 변환 엔진 (abs-to-rel-converter.js)
 *
 * xml-parser.js 공통 모듈 사용.
 *
 * 변환 원칙:
 *   1. 원본 XML의 섹션 순서를 그대로 유지
 *   2. GroupBox 단위로 섹션 분리 (.tblbox / .schbox)
 *   3. Row 내 컴포넌트를 원본 순서대로 배치 (th: Text+Desc, td: 폼 요소)
 *   4. 원본 컴포넌트 속성 전체 보존
 *   5. display:none / visibility:hidden → hidden 처리 (부모 전파)
 *   6. GridView → .gvwbox, class="gvw", height:150px
 *   7. 중간 버튼 → .titbox > .rt, 마지막 버튼만 .btnbox
 *   8. GroupBox 타이틀(title_*) → .titbox + 인접 버튼과 병합
 *   9. colspan → <w2:attributes><w2:colspan> 문법
 *  10. 버튼 class → btn_cm 계열로 교체 (btn_def1 제거)
 *  11. class 있는 컴포넌트 → 기본 스타일 제거 (폼 요소 width는 유지)
 */
const AbsToRelConverter = (() => {

  function escapeXml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function cleanStyle(parts) {
    return parts.map(s => s.replace(/;+\s*$/, '').trim()).filter(Boolean).join('; ');
  }

  /**
   * 삭제 대상 레이아웃 class (템플릿 class로 교체됨)
   * 업무 class (req, mandatory 등)는 유지
   */
  /** class 매핑 테이블: 기존 to-be → 적용 필요 클래스 */
  const CLASS_MAP = {
    'btn_ico_search': 'btn_cm search icon',
    'btn_def1': 'btn_cm', 'btn_def2': 'btn_cm', 'btn_def3': 'btn_cm',
    'btn_def_link': 'btn_cm',
    'kb_btn_white': 'btn_cm pt',
    'kb_txt_red': 'txt_red',
    'kb_txt_brown': '', 'kb_txt_black': '', 'kb_txt_blue': '', 'kb_txt_purple': '',
    'kb_title_h2': 'tit_main',
    'kb_title_h3': 'tit_sub',
  };
  const REMOVE_CLASSES = new Set([
    'kb_MiddleRight', 'kb_MiddleLeft', 'kb_MiddleCenter',
    'kb_td_body', 'kb_td_head',
    'content_body', 'conversion',
  ]);

  /** 업무 class 추출 — 매핑 적용 후 레이아웃 class 제거, 업무 class만 남김 */
  function extractBusinessClass(classStr) {
    if (!classStr) return '';
    return classStr.split(/\s+/).map(c => {
      if (CLASS_MAP[c] !== undefined) return CLASS_MAP[c];
      if (REMOVE_CLASSES.has(c)) return '';
      return c;
    }).filter(Boolean).join(' ');
  }

  /** 버튼 템플릿 class 결정 */
  function getButtonTemplateClass(comp) {
    const oldClass = comp.attributes.class || '';
    const mapped = oldClass.split(/\s+/).map(c => CLASS_MAP[c] || null).filter(Boolean);
    if (mapped.length) return mapped.join(' ');
    const label = (comp.label || '').toLowerCase();
    const id = (comp.id || '').toLowerCase();
    if (label.includes('조회') || id.includes('search') || id.includes('inqry')) return 'btn_cm sch';
    if (label.includes('저장') || id.includes('save')) return 'btn_cm pt';
    return 'btn_cm';
  }


  // ─── 컴포넌트 XML 생성 ───

  function buildCompXml(comp) {
    const tagMap = {
      Edit: 'xf:input', Calendar: 'w2:inputCalendar', SelectBox: 'xf:select1',
      Combo: 'xf:select1', CheckBox: 'xf:select', Text: 'w2:textbox',
      Desc: 'w2:textbox', TextArea: 'xf:textarea', Button: 'xf:trigger',
      Trigger: 'xf:trigger', Image: 'xf:output', Output: 'xf:output',
      LinkText: 'w2:anchor',
    };
    const tag = tagMap[comp.ctype] || comp.originalTag || 'xf:input';
    const isButton = ['Button', 'Trigger'].includes(comp.ctype);
    const isFormInput = ['Edit', 'Calendar', 'SelectBox', 'Combo', 'CheckBox', 'TextArea'].includes(comp.ctype);

    // --- class 처리: 레이아웃 class 삭제, 업무 class 유지, 템플릿 class 적용 ---
    const bizClass = extractBusinessClass(comp.attributes.class || '');
    if (isButton) {
      const tmplClass = getButtonTemplateClass(comp);
      comp.attributes.class = [tmplClass, bizClass].filter(Boolean).join(' ');
    } else {
      comp.attributes.class = bizClass; // 업무 class만 유지
    }

    // --- style 처리: 전부 삭제, 폼 요소 width만 유지 ---
    const styleParts = [];
    if (isFormInput && comp.width) {
      const w = ['SelectBox', 'Combo'].includes(comp.ctype) ? comp.width + 20 : comp.width;
      styleParts.push(`width:${w}px`);
    }
    const style = cleanStyle(styleParts);

    // --- 속성 조합 ---
    const skipAttrs = new Set(['style', 'orgid', 'hierarchy', 'id', 'class']);
    let attrs = '';
    if (comp.attributes.ctype) attrs += ` ctype="${escapeXml(comp.attributes.ctype)}"`;
    if (style) attrs += ` style="${style};"`;
    attrs += ` id="${escapeXml(comp.id)}"`;
    // class (비어있으면 생략)
    if (comp.attributes.class) attrs += ` class="${escapeXml(comp.attributes.class)}"`;
    // 나머지 속성
    for (const [key, val] of Object.entries(comp.attributes)) {
      if (key === 'ctype' || key === 'class' || skipAttrs.has(key)) continue;
      attrs += ` ${key}="${escapeXml(val)}"`;
    }

    // 버튼 라벨 줄바꿈 제거
    if (isButton) {
      if (comp.attributes.text) comp.attributes.text = comp.attributes.text.replace(/\\n|\n/g, ' ').trim();
      if (comp.innerXml) comp.innerXml = comp.innerXml.replace(/&#xA;|\n/g, ' ');
    }

    // 자식이 있는 컴포넌트 (버튼은 한 줄로)
    if (comp.innerXml && comp.innerXml.trim()) {
      if (isButton) {
        return `<${tag}${attrs}>${comp.innerXml.trim()}</${tag}>`;
      }
      return `<${tag}${attrs}>\n\t\t\t\t\t\t${comp.innerXml.trim()}\n\t\t\t\t\t</${tag}>`;
    }
    return `<${tag}${attrs}/>`;
  }


  // ─── 섹션 빌더 ───

  /** GroupBox/standalone → .tblbox */
  function buildTblbox(section, indent) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t', p2 = pad + '\t\t', p3 = pad + '\t\t\t', p4 = pad + '\t\t\t\t';

    const visibleComps = section.comps.filter(c => !c.hidden);
    if (!visibleComps.length) return '';

    // title_ 분리 → _titleLabel에 저장 (convert에서 병합 처리)
    const titleComp = visibleComps.find(c => c.isTitle);
    const formComps = visibleComps.filter(c => !c.isTitle);
    if (titleComp) section._titleLabel = titleComp.label || '';
    if (!formComps.length) return '';

    const rows = XmlParser.clusterRows(formComps);
    if (!rows.length) return '';

    const rowCells = rows.map(row => XmlParser.rowToCells(row));
    const maxCols = Math.max(...rowCells.map(cells => cells.length));
    const colPattern = rowCells.reduce((best, cells) => cells.length > best.length ? cells : best, []);

    const lines = [];
    lines.push(`${pad}<xf:group class="tblbox">`);
    lines.push(`${p1}<xf:group class="w2tb tbl" tagname="table">`);

    // colgroup
    lines.push(`${p2}<xf:group tagname="colgroup">`);
    colPattern.forEach(cell => {
      lines.push(`${p3}<xf:group style="${cell.type === 'th' ? 'width:150px;' : ''}" tagname="col"/>`);
    });
    lines.push(`${p2}</xf:group>`);

    // tr
    rowCells.forEach(cells => {
      lines.push(`${p2}<xf:group tagname="tr">`);
      const deficit = maxCols - cells.length;
      cells.forEach((cell, ci) => {
        const isLast = ci === cells.length - 1;
        const needColspan = isLast && deficit > 0;
        const cls = cell.type === 'th' ? 'w2tb_th' : 'w2tb_td';
        const tagname = cell.type === 'th' ? 'th' : 'td';

        lines.push(`${p3}<xf:group class="${cls}" tagname="${tagname}">`);
        if (needColspan) {
          lines.push(`${p4}<w2:attributes>`);
          lines.push(`${p4}\t<w2:colspan>${deficit + 1}</w2:colspan>`);
          lines.push(`${p4}</w2:attributes>`);
        }
        cell.comps.forEach(comp => { lines.push(`${p4}${buildCompXml(comp)}`); });
        lines.push(`${p3}</xf:group>`);
      });
      lines.push(`${p2}</xf:group>`);
    });

    lines.push(`${p1}</xf:group>`);
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** 조회조건 → .schbox */
  function buildSchbox(section, indent) {
    const pad = '\t'.repeat(indent), p1 = pad + '\t';
    const visibleComps = section.comps.filter(c => !c.hidden);
    if (!visibleComps.length) return '';

    const formComps = visibleComps.filter(c => !['Button', 'Trigger'].includes(c.ctype));
    const btnComps = visibleComps.filter(c => ['Button', 'Trigger'].includes(c.ctype));

    const lines = [];
    lines.push(`${pad}<xf:group class="schbox">`);
    lines.push(`${p1}<xf:group class="schbox_inner" id="tbl_search">`);
    const tableXml = buildTblbox({ comps: formComps }, indent + 2);
    if (tableXml) {
      lines.push(tableXml.replace(/<xf:group class="tblbox">/, '').replace(/<\/xf:group>\s*$/, ''));
    }
    lines.push(`${p1}</xf:group>`);
    if (btnComps.length) {
      lines.push(`${p1}<xf:group class="btn_schbox">`);
      btnComps.forEach(btn => { lines.push(`${p1}\t${buildCompXml(btn)}`); });
      lines.push(`${p1}</xf:group>`);
    }
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** GridView → .gvwbox */
  function buildGvwbox(section, indent) {
    const pad = '\t'.repeat(indent);
    const lines = [];
    lines.push(`${pad}<xf:group class="gvwbox">`);
    section.comps.filter(c => !c.hidden).forEach(comp => {
      if (comp.ctype === 'GridView' && comp.gridXml) {
        let xml = comp.gridXml;
        xml = xml.replace(/style="[^"]*"/, `class="gvw" style="width:100%; height:150px;"`);
        // autoFit="none"은 제거
        xml = xml.replace(/ autoFit="none"/g, '');
        xml.split('\n').forEach(line => { lines.push(`${pad}\t${line.trim()}`); });
      } else if (comp.ctype === 'GridView') {
        lines.push(`${pad}\t<w2:gridView id="${escapeXml(comp.id)}" ctype="IBSheet" class="gvw" style="width:100%; height:150px;"/>`);
      } else {
        lines.push(`${pad}\t${buildCompXml(comp)}`);
      }
    });
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** .titbox (타이틀 + 버튼 병합) */
  function buildTitbox(titleLabel, btnComps, indent, overlayComps) {
    const pad = '\t'.repeat(indent);
    const lines = [];
    lines.push(`${pad}<xf:group class="titbox">`);
    if (titleLabel) {
      lines.push(`${pad}\t<w2:textbox class="tit_main" label="${escapeXml(titleLabel)}" tagname="h3"/>`);
    }
    // 우측 버튼 통합: btnComps + overlayComps 중 버튼 → 하나의 rt 그룹
    const allRtBtns = [...(btnComps || [])];
    const overlayOther = [];
    if (overlayComps && overlayComps.length) {
      overlayComps.forEach(c => {
        if (['Button', 'Trigger', 'LinkText'].includes(c.ctype)) {
          allRtBtns.push(c);
        } else {
          overlayOther.push(c);
        }
      });
    }
    if (allRtBtns.length) {
      lines.push(`${pad}\t<xf:group class="rt">`);
      allRtBtns.forEach(comp => { lines.push(`${pad}\t\t${buildCompXml(comp)}`); });
      lines.push(`${pad}\t</xf:group>`);
    }
    overlayOther.forEach(comp => { lines.push(`${pad}\t${buildCompXml(comp)}`); });
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** .btnbox (마지막 버튼) */
  function buildBtnbox(comps, indent) {
    const pad = '\t'.repeat(indent);
    const lines = [];
    lines.push(`${pad}<xf:group class="btnbox">`);
    lines.push(`${pad}\t<xf:group class="rt">`);
    comps.forEach(comp => { lines.push(`${pad}\t\t${buildCompXml(comp)}`); });
    lines.push(`${pad}\t</xf:group>`);
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }

  /** .tbcbox (TAB 컨트롤 래퍼) */
  function buildTbcbox(comp, indent) {
    const pad = '\t'.repeat(indent);
    const p1 = pad + '\t';

    // tabControl 속성 조합: style 비우고 class="tbc" 적용
    const skipAttrs = new Set(['style', 'orgid', 'hierarchy', 'id', 'class', 'ctype']);
    let attrs = '';
    if (comp.attributes.ctype) attrs += ` ctype="${escapeXml(comp.attributes.ctype)}"`;
    attrs += ` style=""`;
    attrs += ` id="${escapeXml(comp.id)}"`;
    attrs += ` class="tbc"`;
    for (const [key, val] of Object.entries(comp.attributes)) {
      if (skipAttrs.has(key)) continue;
      attrs += ` ${key}="${escapeXml(val)}"`;
    }

    // innerXml 내 w2:content, w2:pageFrame, content, pageFrame style 비우기
    let inner = (comp.innerXml || '').trim();
    inner = inner.replace(/<((?:w2:)?(?:content|pageFrame))\b([^>]*?)>/gi, (_m, tagName, rest) => {
      const cleaned = rest.replace(/style="[^"]*"/, 'style=""');
      return `<${tagName}${cleaned}>`;
    });

    const tag = comp.originalTag || 'w2:tabControl';
    const lines = [];
    lines.push(`${pad}<xf:group class="tbcbox" id="" style="">`);
    lines.push(`${p1}<${tag}${attrs}>`);
    // inner 각 줄 들여쓰기
    inner.split('\n').forEach(l => lines.push(`${p1}\t${l.trim()}`));
    lines.push(`${p1}</${tag}>`);
    lines.push(`${pad}</xf:group>`);
    return lines.join('\n');
  }


  // ─── 전체 변환 ───

  function convert(xmlString) {
    const { meta, sections } = XmlParser.parseDom(xmlString);
    const analysis = XmlParser.analyze(sections);
    const hiddenStandalone = [];

    // --- 1차: 섹션을 outputItems로 수집 ---
    const outputItems = []; // [{ type:'xml'|'btngroup'|'title', content?, comps?, label? }]

    let i = 0;
    while (i < sections.length) {
      const section = sections[i];

      if (section.hidden) {
        section.comps.forEach(c => hiddenStandalone.push(c));
        i++; continue;
      }

      if (section.type === 'tab') {
        const xml = buildTbcbox(section.comps[0], 3);
        if (xml) outputItems.push({ type: 'xml', content: xml });
        i++;

      } else if (section.type === 'grid') {
        const xml = buildGvwbox(section, 3);
        if (xml) outputItems.push({ type: 'xml', content: xml });
        i++;

      } else if (section.type === 'groupbox') {
        const visComps = section.comps.filter(c => !c.hidden);
        if (!visComps.length) { i++; continue; }

        // TAB 컴포넌트 분리 → tbcbox로 별도 출력
        const tabComps = visComps.filter(c => c.ctype === 'TAB');
        const nonTabComps = visComps.filter(c => c.ctype !== 'TAB');

        // 조회 버튼 포함 여부
        const isSearchBox = nonTabComps.length > 0 && analysis.hasSearchBtn && nonTabComps.some(c =>
          ['Button', 'Trigger'].includes(c.ctype) &&
          (/(조회|search|inqry)/i.test(c.label || '') || /(조회|search|inqry)/i.test(c.id || '')));

        if (isSearchBox) {
          const xml = buildSchbox({ ...section, comps: nonTabComps }, 3);
          if (xml) outputItems.push({ type: 'xml', content: xml });
        } else if (nonTabComps.length > 0) {
          // GridView가 포함된 GroupBox → 폼/그리드/버튼 분리
          const hasGrid = nonTabComps.some(c => c.ctype === 'GridView');
          if (hasGrid) {
            const titleComp = nonTabComps.find(c => c.isTitle);
            const workComps = nonTabComps.filter(c => !c.isTitle);

            // 그리드 관련 버튼 식별 (행추가, 행삭제, 엑셀, 복사, 다운로드, 업로드, 인쇄 등)
            const gridBtnKeywords = /행추가|행삭제|행복사|엑셀|excel|다운로드|download|업로드|upload|인쇄|print|보고서|초기화|reset|copy|row_add|row_del/i;
            const isGridBtn = (c) => ['Button', 'Trigger'].includes(c.ctype) &&
              (gridBtnKeywords.test(c.label || '') || gridBtnKeywords.test(c.id || '') ||
               gridBtnKeywords.test(c.attributes?.text || '') || gridBtnKeywords.test(c.attributes?.class || ''));

            const gridBtns = workComps.filter(isGridBtn);
            const formComps = workComps.filter(c => c.ctype !== 'GridView' && !isGridBtn(c));
            const gridComps = workComps.filter(c => c.ctype === 'GridView');

            // 타이틀 출력
            if (titleComp) {
              outputItems.push({ type: 'title', label: titleComp.label || '', overlayComps: section.overlayComps || null });
            }

            // 폼 컴포넌트 → tblbox (그리드 앞)
            const formBefore = formComps.filter(c => c.top < gridComps[0].top);
            const formAfter = formComps.filter(c => c.top >= gridComps[0].top);

            if (formBefore.length) {
              const xml = buildTblbox({ comps: formBefore }, 3);
              if (xml) outputItems.push({ type: 'xml', content: xml });
            }

            // 그리드 관련 버튼 → titbox > .rt (그리드 바로 위)
            if (gridBtns.length) {
              outputItems.push({ type: 'xml', content: buildTitbox(null, gridBtns, 3) });
            }

            // GridView → gvwbox
            gridComps.forEach(c => {
              const xml = buildGvwbox({ comps: [c] }, 3);
              if (xml) outputItems.push({ type: 'xml', content: xml });
            });

            // 그리드 뒤 폼 컴포넌트 → tblbox
            if (formAfter.length) {
              const xml = buildTblbox({ comps: formAfter }, 3);
              if (xml) outputItems.push({ type: 'xml', content: xml });
            }
          } else {
            const sectionForTbl = { ...section, comps: nonTabComps };
            const xml = buildTblbox(sectionForTbl, 3);
            if (sectionForTbl._titleLabel) outputItems.push({ type: 'title', label: sectionForTbl._titleLabel, overlayComps: section.overlayComps || null });
            if (xml) outputItems.push({ type: 'xml', content: xml });
          }
        }

        // TAB 컴포넌트 → tbcbox 별도 출력
        tabComps.forEach(tc => {
          const xml = buildTbcbox(tc, 3);
          if (xml) outputItems.push({ type: 'xml', content: xml });
        });
        i++;

      } else if (section.type === 'standalone') {
        // 연속 standalone 수집 → top 순서로 폼/버튼 블록 분리
        const allStandalone = [];
        while (i < sections.length && sections[i].type === 'standalone') {
          const s = sections[i];
          if (s.hidden) { s.comps.forEach(c => hiddenStandalone.push(c)); i++; continue; }
          s.comps.forEach(c => {
            if (c.hidden) hiddenStandalone.push(c);
            else allStandalone.push(c);
          });
          i++;
        }
        allStandalone.sort((a, b) => a.top - b.top || a.left - b.left);

        let formGroup = [], btnGroup = [];
        function flushForm() {
          if (!formGroup.length) return;
          const rows = XmlParser.clusterRows(formGroup);
          // 첫 Row가 단독 Text → 타이틀 분리
          if (rows.length > 1 && rows[0].length === 1 && ['Text', 'Desc'].includes(rows[0][0].ctype)) {
            outputItems.push({ type: 'title', label: rows[0][0].label || '' });
            formGroup = formGroup.filter(c => c !== rows[0][0]);
          }
          if (formGroup.length) {
            const xml = buildTblbox({ comps: formGroup }, 3);
            if (xml) outputItems.push({ type: 'xml', content: xml });
          }
          formGroup = [];
        }
        function flushBtn() {
          if (!btnGroup.length) return;
          outputItems.push({ type: 'btngroup', comps: [...btnGroup] });
          btnGroup = [];
        }
        function flushGrid(gridComp) {
          // 그리드 앞 폼에서 그리드 관련 버튼 분리
          const gridBtns = formGroup.filter(c => ['Button', 'Trigger'].includes(c.ctype) && GRID_BTN_RE.test((c.label || '') + (c.id || '') + (c.attributes?.text || '')));
          formGroup = formGroup.filter(c => !gridBtns.includes(c));
          flushForm();
          flushBtn();
          if (gridBtns.length) {
            outputItems.push({ type: 'xml', content: buildTitbox(null, gridBtns, 3) });
          }
          const xml = buildGvwbox({ comps: [gridComp] }, 3);
          if (xml) outputItems.push({ type: 'xml', content: xml });
        }

        allStandalone.forEach(c => {
          if (c.ctype === 'TAB') { flushForm(); flushBtn(); outputItems.push({ type: 'xml', content: buildTbcbox(c, 3) }); }
          else if (c.ctype === 'GridView') { flushGrid(c); }
          else if (['Button', 'Trigger'].includes(c.ctype)) { flushForm(); btnGroup.push(c); }
          else { flushBtn(); formGroup.push(c); }
        });
        flushForm();
        flushBtn();
      } else {
        i++;
      }
    }

    // --- 2차: outputItems → XML 출력 ---
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms">`);

    // head 그대로 보존 (원본 들여쓰기 유지)
    const headMatch = xmlString.match(/<head[\s\S]*?<\/head>/i);
    if (headMatch) lines.push('\t' + headMatch[0]);

    lines.push(`\t<body ev:onpageload="scwin.onpageload">`);
    lines.push(`\t\t<xf:group class="sub_contents flex_cont">`);

    if (xmlString.includes('pageFrame') || xmlString.includes('contentHeader')) {
      lines.push(`\t\t\t<w2:pageFrame id="pfm_header" src="../../cm/xml/contentHeader.xml"/>`);
    }

    // btngroup: 뒤에 콘텐츠 없으면 btnbox, 있으면 titbox (title과 병합)
    let oi = 0;
    while (oi < outputItems.length) {
      const item = outputItems[oi];

      if (item.type === 'xml') {
        lines.push(item.content);
        oi++;
      } else if (item.type === 'title') {
        lines.push(buildTitbox(item.label, null, 3, item.overlayComps));
        oi++;
      } else if (item.type === 'btngroup') {
        const hasContentAfter = outputItems.slice(oi + 1).some(x => x.type === 'xml' || x.type === 'title');
        if (!hasContentAfter) {
          lines.push(buildBtnbox(item.comps, 3));
          oi++;
        } else {
          const next = outputItems[oi + 1];
          if (next && next.type === 'title') {
            lines.push(buildTitbox(next.label, item.comps, 3, next.overlayComps));
            oi += 2;
          } else {
            lines.push(buildTitbox(null, item.comps, 3));
            oi++;
          }
        }
      } else {
        oi++;
      }
    }

    // --- hidden fields ---
    const allComps = sections.flatMap(s => s.comps);
    const allHidden = [...hiddenStandalone, ...allComps.filter(c => c.hidden && !hiddenStandalone.includes(c))];
    const hiddenSet = new Set();
    const uniqueHidden = allHidden.filter(c => {
      if (!c.id || hiddenSet.has(c.id) || /^GroupBox/i.test(c.id) || c.id.startsWith('title_')) return false;
      hiddenSet.add(c.id); return true;
    });

    if (uniqueHidden.length > 0) {
      lines.push(`\t\t\t<!-- hidden fields -->`);
      uniqueHidden.forEach(c => {
        const tagMap = { Text: 'w2:textbox', Desc: 'w2:textbox', Edit: 'xf:input',
          Calendar: 'w2:inputCalendar', SelectBox: 'xf:select1', Combo: 'xf:select1',
          CheckBox: 'xf:select', Button: 'xf:trigger', Trigger: 'xf:trigger' };
        const tag = tagMap[c.ctype] || c.originalTag || 'xf:input';
        // class: 레이아웃 제거, 업무만 유지, 버튼은 템플릿 적용
        const isBtn = ['Button', 'Trigger'].includes(c.ctype);
        const bizClass = extractBusinessClass(c.attributes.class || '');
        if (isBtn) {
          const tmplClass = getButtonTemplateClass(c);
          c.attributes.class = [tmplClass, bizClass].filter(Boolean).join(' ');
        } else {
          c.attributes.class = bizClass;
        }
        const skipAttrs = new Set(['style', 'orgid', 'hierarchy', 'id', 'class']);
        let attrs = '';
        if (c.attributes.ctype) attrs += ` ctype="${escapeXml(c.attributes.ctype)}"`;
        attrs += ` style="display:none;" id="${escapeXml(c.id)}"`;
        if (c.attributes.class) attrs += ` class="${escapeXml(c.attributes.class)}"`;
        for (const [key, val] of Object.entries(c.attributes)) {
          if (key === 'ctype' || key === 'class' || skipAttrs.has(key)) continue;
          attrs += ` ${key}="${escapeXml(val)}"`;
        }
        lines.push(`\t\t\t<${tag}${attrs}/>`);
      });
    }

    lines.push(`\t\t</xf:group>`);
    lines.push(`\t</body>`);
    lines.push(`</html>`);

    return { convertedXml: lines.join('\n'), analysis };
  }

  return { convert };
})();

if (typeof module !== 'undefined') module.exports = AbsToRelConverter;
