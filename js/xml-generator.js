/**
 * WebSquare XML Generator
 * 컴포넌트 목록을 받아 WebSquare XML 파일을 생성한다.
 */
const XmlGenerator = (() => {

  const XMLNS = {
    xhtml: 'http://www.w3.org/1999/xhtml',
    ev: 'http://www.w3.org/2001/xml-events',
    w2: 'http://www.inswave.com/websquare',
    xf: 'http://www.w3.org/2002/xforms',
  };

  // 컴포넌트 타입 → WebSquare 태그 매핑
  const TAG_MAP = {
    Text:      { ns: 'w2', tag: 'textbox',       ctype: 'Text' },
    Desc:      { ns: 'w2', tag: 'textbox',       ctype: 'Text' },
    Label:     { ns: 'w2', tag: 'textbox',       ctype: 'Text' },
    Edit:      { ns: 'xf', tag: 'input',         ctype: 'Edit' },
    Calendar:  { ns: 'xf', tag: 'inputCalendar', ctype: 'Calendar' },
    SelectBox: { ns: 'xf', tag: 'select1',       ctype: 'SelectBox' },
    CheckBox:  { ns: 'xf', tag: 'checkbox',      ctype: 'CheckBox' },
    TextArea:  { ns: 'xf', tag: 'textarea',      ctype: 'TextArea' },
    Button:    { ns: 'xf', tag: 'trigger',       ctype: 'Button' },
    Trigger:   { ns: 'xf', tag: 'trigger',       ctype: 'Button' },
    GridView:  { ns: 'w2', tag: 'gridView',      ctype: 'IBSheet' },
    Group:     { ns: 'xf', tag: 'group',         ctype: 'GroupBox' },
    GroupBox:  { ns: 'xf', tag: 'group',         ctype: 'GroupBox' },
    Radio:     { ns: 'xf', tag: 'select1',       ctype: 'RadioButton' },
    Image:     { ns: 'xf', tag: 'output',        ctype: 'Image' },
    Tab:       { ns: 'w2', tag: 'tabControl',    ctype: 'Tab' },
  };

  function escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // CDATA 안에서는 XML 엔티티 escape가 의미가 없는 대신 "]]>"가 섹션을 조기 종료시키므로 분할한다.
  function escapeCdata(str) {
    return String(str || '').replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  function buildStyle(comp) {
    const parts = [`position:absolute`];
    if (comp.left != null) parts.push(`left:${comp.left}px`);
    if (comp.top != null) parts.push(`top:${comp.top}px`);
    if (comp.width) parts.push(`width:${comp.width}px`);
    if (comp.height) parts.push(`height:${comp.height}px`);
    return parts.join('; ') + ';';
  }

  function generateComponentXml(comp, indent) {
    const mapping = TAG_MAP[comp.ctype] || TAG_MAP['Edit'];
    const prefix = mapping.ns;
    const tag = mapping.tag;
    const ctype = mapping.ctype;
    const style = buildStyle(comp);
    const id = escapeXml(comp.id || '');
    const label = escapeXml(comp.label || '');

    const pad = '\t'.repeat(indent);

    // 버튼은 xf:label 자식이 필요
    if (comp.ctype === 'Button' || comp.ctype === 'Trigger') {
      return [
        `${pad}<${prefix}:${tag} ctype="${ctype}" style="${style}" id="${id}" tabIndex="1" type="button">`,
        `${pad}\t<xf:label><![CDATA[${escapeCdata(comp.label || '')}]]></xf:label>`,
        `${pad}</${prefix}:${tag}>`,
      ].join('\n');
    }

    // GridView 기본 구조
    if (comp.ctype === 'GridView') {
      const cols = comp.columns || [];
      let gridXml = `${pad}<${prefix}:${tag} ctype="${ctype}" style="${style}" id="${id}" tabIndex="1">`;
      if (cols.length > 0) {
        gridXml += `\n${pad}\t<w2:header id="header1">`;
        gridXml += `\n${pad}\t\t<w2:row>`;
        cols.forEach((col, i) => {
          gridXml += `\n${pad}\t\t\t<w2:column id="column${i + 1}" inputType="text" value="${escapeXml(col.label || col.id || '')}" width="${col.width || 100}"/>`;
        });
        gridXml += `\n${pad}\t\t</w2:row>`;
        gridXml += `\n${pad}\t</w2:header>`;
        gridXml += `\n${pad}\t<w2:gBody id="gBody1">`;
        gridXml += `\n${pad}\t\t<w2:row>`;
        cols.forEach((col) => {
          gridXml += `\n${pad}\t\t\t<w2:column id="${escapeXml(col.id || '')}" inputType="text" width="${col.width || 100}"/>`;
        });
        gridXml += `\n${pad}\t\t</w2:row>`;
        gridXml += `\n${pad}\t</w2:gBody>`;
      }
      gridXml += `\n${pad}</${prefix}:${tag}>`;
      return gridXml;
    }

    // GroupBox (자식 컴포넌트 포함)
    if (comp.ctype === 'Group' || comp.ctype === 'GroupBox') {
      let groupXml = `${pad}<${prefix}:${tag} ctype="${ctype}" style="${style}" id="${id}" tabIndex="1">`;
      if (comp.children && comp.children.length > 0) {
        comp.children.forEach(child => {
          groupXml += '\n' + generateComponentXml(child, indent + 1);
        });
      }
      groupXml += `\n${pad}</${prefix}:${tag}>`;
      return groupXml;
    }

    // 일반 컴포넌트 (self-closing)
    let attrs = `ctype="${ctype}" style="${style}" id="${id}"`;
    if (label) attrs += ` label="${label}"`;
    if (comp.maxlength) attrs += ` maxlength="${comp.maxlength}"`;
    attrs += ` tabIndex="1"`;

    return `${pad}<${prefix}:${tag} ${attrs}/>`;
  }

  /**
   * 전체 WebSquare XML 생성
   * @param {Object} meta - { screenId, screenName, width, height }
   * @param {Array} components - Component 배열
   * @returns {string} XML 문자열
   */
  function generate(meta, components) {
    const screenId = escapeXml(meta.screenId || 'SCREEN001');
    const screenName = escapeXml(meta.screenName || '화면명');
    const width = meta.width || 1056;
    const height = meta.height || 600;

    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<html xmlns="${XMLNS.xhtml}" xmlns:ev="${XMLNS.ev}" xmlns:w2="${XMLNS.w2}" xmlns:xf="${XMLNS.xf}">`);

    // head
    lines.push(`\t<head meta_screenId="${screenId}" meta_screenName="${screenName}">`);
    lines.push(`\t\t<w2:type>COMPONENT</w2:type>`);
    lines.push(`\t\t<w2:buildDate/>`);
    lines.push(`\t\t<xf:model>`);
    lines.push(`\t\t\t<w2:dataCollection>`);
    lines.push(`\t\t\t</w2:dataCollection>`);
    lines.push(`\t\t</xf:model>`);
    lines.push(`\t\t<script type="text/javascript" lazy="false"><![CDATA[`);
    lines.push(`scwin.onpageload = function() {`);
    lines.push(`};`);
    lines.push(`]]></script>`);
    lines.push(`\t</head>`);

    // body
    lines.push(`\t<body ev:onpageload="scwin.onpageload">`);
    lines.push(`\t\t<xf:group screentitle="${screenName}" screenno="${screenId}" style="width:${width}px; height:${height}px;" class="content_body">`);

    // 컴포넌트
    components.forEach(comp => {
      lines.push(generateComponentXml(comp, 3));
    });

    lines.push(`\t\t</xf:group>`);
    lines.push(`\t</body>`);
    lines.push(`</html>`);

    return lines.join('\n');
  }

  /**
   * XML 문자열을 정렬(포맷)한다.
   */
  function formatXml(xml) {
    // 이미 탭 기반 인덴트가 되어 있으므로 그대로 반환
    return xml;
  }

  return { generate, formatXml, TAG_MAP, generateComponentXml };
})();

if (typeof module !== 'undefined') module.exports = XmlGenerator;
