/**
 * 스크립트 검증 엔진 (script-validator.js)
 *
 * 원본 XML의 <script> 블록을 분석하여
 * 변환 XML에서 참조 ID/바인딩/속성이 보존되었는지 검증한다.
 *
 * ScriptValidator.validate(originalXml, convertedXml) → 검증 결과 객체
 */
const ScriptValidator = (() => {

  /**
   * 0. 스크립트에서 주석/문자열 리터럴을 제거하여 정규식 false positive를 줄인다.
   *    - "..." / '...' / `...` / // ... / /* ... 모두 공백으로 치환 (길이는 보존하지 않음)
   *    - 문서 주석 안의 'foo.Value' 같은 표기가 미존재 ID로 잘못 잡히는 문제 방지
   */
  function stripScriptNoise(s) {
    if (!s) return '';
    return String(s)
      // 블록 주석 /* ... */
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // 라인 주석 // ... (단 URL의 // 는 라인 시작/공백 뒤만 매칭)
      .replace(/(^|[\s;{}()=,])\/\/[^\n\r]*/g, '$1 ')
      // 문자열 리터럴 — escape sequence 고려
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/`(?:\\.|[^`\\])*`/g, '``');
  }

  /**
   * 1. 스크립트에서 참조하는 ID 추출
   */
  function extractScriptIds(scriptText) {
    const cleaned = stripScriptNoise(scriptText);
    const ids = new Set();
    const patterns = [
      // 이벤트 핸들러: scwin.{id}_OnClick, scwin.{id}_OnChange 등
      /scwin\.(\w+?)_(On\w+)\s*=/g,
      // 직접 참조: {id}.Value, {id}.Data, {id}.caption
      /\b([a-zA-Z_]\w+)\.(Value|Data|caption|Text|ExcelExport\w*|SetCellValue|GetCellValue|GetColData|SetText)\b/g,
      // 직접 참조: {id}.{method}()
      /\b([a-zA-Z_]\w+)\.(ExcelExportS|Repaint|SetFocus|GetValue|SetValue|Show|Hide|Validate)\s*\(/g,
    ];

    patterns.forEach(re => {
      let m;
      while ((m = re.exec(cleaned)) !== null) {
        const id = m[1];
        // scwin, tran, console, window, document 등 예약어 제외
        if (!['scwin', 'tran', 'console', 'window', 'document', 'Math', 'JSON',
              'Array', 'String', 'Number', 'var', 'let', 'const', 'this',
              'MessageSlide', 'SetScreenOzData', 'SetOzGridData', 'CallOZViewer50',
              'str', 'tmp', 'oarParams'].includes(id)) {
          ids.add(id);
        }
      }
    });

    return ids;
  }

  /**
   * 2. 이벤트 핸들러 목록 추출
   */
  function extractEventHandlers(scriptText) {
    const cleaned = stripScriptNoise(scriptText);
    const handlers = [];
    const re = /scwin\.(\w+?)_(On\w+)\s*=\s*function/g;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      handlers.push({ id: m[1], event: m[2], fullName: `scwin.${m[1]}_${m[2]}` });
    }
    return handlers;
  }

  /**
   * 3. XML에서 컴포넌트 ID 셋 추출
   */
  function extractXmlIds(xmlStr) {
    // CDATA 안의 텍스트(스크립트)에 우연히 id="..." 패턴이 들어 있어도 컴포넌트 ID로 잘못 잡히지 않도록 선제거.
    const sanitized = String(xmlStr || '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const ids = new Set();
    (sanitized.match(/\sid="([^"]*)"/g) || []).forEach(m => {
      const id = m.replace(/\sid="/, '').replace('"', '');
      if (id) ids.add(id);
    });
    return ids;
  }

  /**
   * 3-1. XML body 영역에서 중복 ID 검출
   *      dataMap/dataList의 key/column ID는 제외하고 body 내 컴포넌트만 검사
   */
  function findDuplicateIds(xmlStr) {
    // body 영역 추출 — CDATA 안의 텍스트가 body 정규식과 ID 패턴에 끼어들지 않도록 먼저 제거
    const sanitized = String(xmlStr || '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const bodyMatch = sanitized.match(/<body[\s>]([\s\S]*)<\/body>/i);
    const bodyStr = bodyMatch ? bodyMatch[0] : sanitized;

    const idCounts = {};
    // orgid="...", CtrlId="..." 등 오탐 방지: 공백 뒤의 id="..." 만 매칭
    const re = /\sid="([^"]+)"/g;
    let m;
    while ((m = re.exec(bodyStr)) !== null) {
      const id = m[1];
      if (!id) continue;
      idCounts[id] = (idCounts[id] || 0) + 1;
    }

    const duplicates = [];
    Object.entries(idCounts).forEach(([id, count]) => {
      if (count > 1) {
        duplicates.push({ id, count });
      }
    });
    return duplicates.sort((a, b) => b.count - a.count);
  }

  /**
   * 4. ref 바인딩 추출: id → ref 매핑
   */
  function extractBindings(xmlStr) {
    const bindings = {};
    // \s prefix로 orgid/CtrlId 오탐 방지
    const re = /\sid="([^"]*)"[^>]*\sref="([^"]*)"/g;
    let m;
    while ((m = re.exec(xmlStr)) !== null) {
      if (m[1]) bindings[m[1]] = m[2];
    }
    // 역순도 체크
    const re2 = /\sref="([^"]*)"[^>]*\sid="([^"]*)"/g;
    while ((m = re2.exec(xmlStr)) !== null) {
      if (m[2] && !bindings[m[2]]) bindings[m[2]] = m[1];
    }
    return bindings;
  }

  /**
   * 5. dataList 바인딩 추출
   */
  function extractDataLists(xmlStr) {
    const lists = {};
    // \s prefix로 orgid/CtrlId 오탐 방지
    const re = /\sid="([^"]*)"[^>]*\sdataList="([^"]*)"/g;
    let m;
    while ((m = re.exec(xmlStr)) !== null) {
      if (m[1]) lists[m[1]] = m[2];
    }
    const re2 = /\sdataList="([^"]*)"[^>]*\sid="([^"]*)"/g;
    while ((m = re2.exec(xmlStr)) !== null) {
      if (m[2] && !lists[m[2]]) lists[m[2]] = m[1];
    }
    return lists;
  }

  /**
   * 6. 주요 속성 추출: id → { disabled, displayFormat, maxlength }
   */
  function extractAttrs(xmlStr) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'text/xml');
    const attrs = {};

    const els = doc.querySelectorAll('[id]');
    els.forEach(el => {
      const id = el.getAttribute('id');
      if (!id) return;
      attrs[id] = {
        disabled: el.getAttribute('disabled') || '',
        displayFormat: el.getAttribute('displayFormat') || '',
        maxlength: el.getAttribute('maxlength') || '',
        ref: el.getAttribute('ref') || '',
        dataList: el.getAttribute('dataList') || '',
        ctype: el.getAttribute('ctype') || '',
      };
    });
    return attrs;
  }

  /**
   * 7. 스크립트 블록 추출
   */
  function extractScript(xmlStr) {
    const m = xmlStr.match(/<script[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/script>/);
    return m ? m[1] : '';
  }


  // ─── 메인 검증 ───

  function validate(originalXml, convertedXml) {
    const script = extractScript(originalXml);
    const origIds = extractXmlIds(originalXml);
    const convIds = extractXmlIds(convertedXml);

    const result = {
      hasScript: !!script.trim(),
      scriptHandlers: [],
      scriptIdRefs: [],
      idComparison: { missing: [], extra: [] },
      bindingComparison: [],
      dataListComparison: [],
      attrComparison: [],
    };

    if (!script.trim()) return result;

    // 1. 이벤트 핸들러 검증
    const handlers = extractEventHandlers(script);
    result.scriptHandlers = handlers.map(h => ({
      ...h,
      existsInOriginal: origIds.has(h.id),
      existsInConverted: convIds.has(h.id),
      // 원본에도 없으면 skip (스크립트만 있고 컴포넌트가 없는 경우)
      status: !origIds.has(h.id) && !convIds.has(h.id) ? 'skip' :
              convIds.has(h.id) ? 'pass' : 'fail',
    }));

    // 2. 스크립트 ID 참조 검증
    const scriptIds = extractScriptIds(script);
    result.scriptIdRefs = [...scriptIds].map(id => ({
      id,
      existsInOriginal: origIds.has(id),
      existsInConverted: convIds.has(id),
      status: !origIds.has(id) ? 'skip' : convIds.has(id) ? 'pass' : 'fail',
    }));

    // 3. ID 비교 (GroupBox 제외)
    const origFiltered = [...origIds].filter(id => !/^GroupBox/i.test(id));
    const convFiltered = [...convIds].filter(id => !/^GroupBox/i.test(id));
    result.idComparison.missing = origFiltered.filter(id => !convIds.has(id));
    result.idComparison.extra = convFiltered.filter(id => !origIds.has(id));

    // 4. ref 바인딩 비교
    const origBindings = extractBindings(originalXml);
    const convBindings = extractBindings(convertedXml);
    Object.entries(origBindings).forEach(([id, ref]) => {
      const convRef = convBindings[id] || '';
      result.bindingComparison.push({
        id, origRef: ref, convRef,
        status: !convRef ? 'missing' : convRef === ref ? 'pass' : 'changed',
      });
    });

    // 5. dataList 비교
    const origLists = extractDataLists(originalXml);
    const convLists = extractDataLists(convertedXml);
    Object.entries(origLists).forEach(([id, dl]) => {
      const convDl = convLists[id] || '';
      result.dataListComparison.push({
        id, origDataList: dl, convDataList: convDl,
        status: !convDl ? 'missing' : convDl === dl ? 'pass' : 'changed',
      });
    });

    // 6-0. 중복 ID 검출
    result.duplicateIds = findDuplicateIds(convertedXml);

    // 6. 주요 속성 비교
    const origAttrs = extractAttrs(originalXml);
    const convAttrs = extractAttrs(convertedXml);
    const checkKeys = ['disabled', 'displayFormat', 'maxlength'];
    Object.entries(origAttrs).forEach(([id, orig]) => {
      if (/^GroupBox/i.test(id)) return;
      const conv = convAttrs[id];
      if (!conv) return;
      const diffs = [];
      checkKeys.forEach(key => {
        if (orig[key] && orig[key] !== conv[key]) {
          diffs.push({ attr: key, origVal: orig[key], convVal: conv[key] || '(없음)' });
        }
      });
      if (diffs.length) {
        result.attrComparison.push({ id, diffs });
      }
    });

    return result;
  }

  return { validate, findDuplicateIds };
})();
