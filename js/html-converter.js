/**
 * HTML → WebSquare Component Converter
 * HTML 파일을 파싱하여 WebSquare 컴포넌트 목록으로 변환한다.
 */
const HtmlConverter = (() => {

  // HTML 요소 → WebSquare 컴포넌트 타입 매핑
  const ELEMENT_MAP = {
    'input[type=text]':     'Edit',
    'input[type=password]': 'Edit',
    'input[type=number]':   'Edit',
    'input[type=email]':    'Edit',
    'input[type=tel]':      'Edit',
    'input[type=search]':   'Edit',
    'input[type=date]':     'Calendar',
    'input[type=datetime-local]': 'Calendar',
    'input[type=checkbox]': 'CheckBox',
    'input[type=radio]':    'Radio',
    'input[type=button]':   'Button',
    'input[type=submit]':   'Button',
    'input[type=reset]':    'Button',
    'select':               'SelectBox',
    'textarea':             'TextArea',
    'button':               'Button',
    'table':                'GridView',
    'label':                'Text',
    'span':                 'Desc',
    'h1':                   'Text',
    'h2':                   'Text',
    'h3':                   'Text',
    'h4':                   'Text',
    'h5':                   'Text',
    'h6':                   'Text',
    'p':                    'Desc',
    'img':                  'Image',
    'div':                  'Group',
    'section':              'Group',
    'fieldset':             'GroupBox',
    'form':                 'Group',
    'nav':                  'Group',
    'header':               'Group',
    'footer':               'Group',
    'a':                    'Button',
  };

  let idCounter = 0;

  function resetIdCounter() {
    idCounter = 0;
  }

  function generateId(ctype) {
    idCounter++;
    const prefixMap = {
      Text: 'txt', Desc: 'txt', Edit: 'edt', Calendar: 'cal',
      SelectBox: 'sel', CheckBox: 'chk', Radio: 'rdo', TextArea: 'txa',
      Button: 'btn', Trigger: 'btn', GridView: 'grd', Group: 'grp',
      GroupBox: 'grp', Image: 'img', Tab: 'tab',
    };
    const prefix = prefixMap[ctype] || 'comp';
    return `${prefix}_${String(idCounter).padStart(3, '0')}`;
  }

  function getElementType(el) {
    const tag = el.tagName.toLowerCase();

    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return ELEMENT_MAP[`input[type=${type}]`] || 'Edit';
    }

    return ELEMENT_MAP[tag] || null;
  }

  function getElementLabel(el) {
    const tag = el.tagName.toLowerCase();

    // input 요소: placeholder, value, 연결된 label 확인
    if (['input', 'select', 'textarea'].includes(tag)) {
      const id = el.getAttribute('id');
      if (id) {
        const doc = el.ownerDocument;
        const label = doc.querySelector(`label[for="${id}"]`);
        if (label) return label.textContent.trim();
      }
      return el.getAttribute('placeholder') || el.getAttribute('value') || el.getAttribute('title') || '';
    }

    // 버튼: 텍스트 내용
    if (tag === 'button' || tag === 'a') {
      return el.textContent.trim().substring(0, 30);
    }

    // 텍스트 요소
    if (['label', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      return el.textContent.trim().substring(0, 50);
    }

    // fieldset legend
    if (tag === 'fieldset') {
      const legend = el.querySelector('legend');
      return legend ? legend.textContent.trim() : '';
    }

    return '';
  }

  function getElementRect(el) {
    const rect = el.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function extractTableColumns(tableEl) {
    const columns = [];
    const headers = tableEl.querySelectorAll('th');
    if (headers.length > 0) {
      headers.forEach((th, i) => {
        columns.push({
          id: `col_${i + 1}`,
          label: th.textContent.trim(),
          width: Math.max(th.offsetWidth || 100, 60),
        });
      });
    } else {
      // th가 없으면 첫 행의 td 개수로 추정
      const firstRow = tableEl.querySelector('tr');
      if (firstRow) {
        const cells = firstRow.querySelectorAll('td');
        cells.forEach((td, i) => {
          columns.push({
            id: `col_${i + 1}`,
            label: `컬럼${i + 1}`,
            width: Math.max(td.offsetWidth || 100, 60),
          });
        });
      }
    }
    return columns;
  }

  /**
   * HTML 문자열에서 컴포넌트를 추출한다.
   * iframe에 렌더링하여 실제 좌표를 계산한다.
   * @param {string} htmlString - HTML 소스 문자열
   * @returns {Promise<{meta: Object, components: Array}>}
   */
  function parseFromString(htmlString) {
    return new Promise((resolve) => {
      resetIdCounter();

      // iframe으로 렌더링하여 좌표 계산
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed; left:-9999px; top:0; width:1100px; height:800px; border:none;';
      document.body.appendChild(iframe);

      iframe.onload = () => {
        try {
          const doc = iframe.contentDocument;
          const body = doc.body;
          const bodyRect = body.getBoundingClientRect();

          const meta = {
            screenId: 'SCREEN001',
            screenName: extractTitle(doc),
            width: Math.max(Math.round(bodyRect.width), 1056),
            height: Math.max(Math.round(bodyRect.height), 600),
          };

          const components = [];
          const skipTags = new Set(['script', 'style', 'link', 'meta', 'title', 'head', 'html', 'body', 'br', 'hr']);
          const processedTables = new Set();

          function walk(el) {
            const tag = el.tagName.toLowerCase();
            if (skipTags.has(tag)) return;

            // table 내부의 개별 요소는 건너뜀 (table 자체를 GridView로 변환)
            if (el.closest('table') && tag !== 'table') {
              // table 내부 input 등은 수집하지 않음 (GridView로 통합)
              if (processedTables.has(el.closest('table'))) return;
            }

            const ctype = getElementType(el);
            if (!ctype) {
              // 매핑 안 되는 요소는 자식만 탐색
              Array.from(el.children).forEach(walk);
              return;
            }

            // 빈 div/group은 건너뜀
            if ((ctype === 'Group' || ctype === 'GroupBox') && tag !== 'fieldset') {
              Array.from(el.children).forEach(walk);
              return;
            }

            const rect = getElementRect(el);
            // 너무 작거나 보이지 않는 요소 제외
            if (rect.width < 5 && rect.height < 5) {
              Array.from(el.children).forEach(walk);
              return;
            }

            const comp = {
              id: el.getAttribute('id') || el.getAttribute('name') || generateId(ctype),
              ctype: ctype,
              label: getElementLabel(el),
              left: rect.left,
              top: rect.top,
              width: rect.width || null,
              height: rect.height || null,
            };

            // 특수 처리
            if (ctype === 'Edit') {
              comp.maxlength = el.getAttribute('maxlength') || '';
            }

            if (ctype === 'GridView') {
              processedTables.add(el);
              comp.columns = extractTableColumns(el);
            }

            components.push(comp);

            // table이 아닌 경우에만 자식 탐색
            if (ctype !== 'GridView') {
              Array.from(el.children).forEach(walk);
            }
          }

          Array.from(body.children).forEach(walk);

          // 좌표 정규화 (body 기준 오프셋)
          const offsetX = bodyRect.left;
          const offsetY = bodyRect.top;
          components.forEach(c => {
            c.left = Math.max(c.left - offsetX, 0);
            c.top = Math.max(c.top - offsetY, 0);
          });

          document.body.removeChild(iframe);
          resolve({ meta, components });
        } catch (e) {
          document.body.removeChild(iframe);
          resolve({ meta: { screenId: 'SCREEN001', screenName: '변환 오류', width: 1056, height: 600 }, components: [] });
        }
      };

      const doc = iframe.contentDocument;
      doc.open();
      doc.write(htmlString);
      doc.close();
    });
  }

  function extractTitle(doc) {
    const title = doc.querySelector('title');
    if (title && title.textContent.trim()) return title.textContent.trim();
    const h1 = doc.querySelector('h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim().substring(0, 30);
    return '변환된 화면';
  }

  /**
   * File 객체에서 HTML을 읽어 컴포넌트로 변환
   * @param {File} file
   * @returns {Promise<{meta: Object, components: Array}>}
   */
  function parseFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        parseFromString(e.target.result).then(resolve);
      };
      reader.onerror = reject;
      reader.readAsText(file, 'UTF-8');
    });
  }

  return { parseFromString, parseFromFile, ELEMENT_MAP };
})();

if (typeof module !== 'undefined') module.exports = HtmlConverter;
