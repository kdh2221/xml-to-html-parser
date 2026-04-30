# WebSquare Publishing Editor — XML to XML

## 프로젝트 개요

본 프로젝트는 **인젠트(INZENT) 단말 iWorks를 기반으로 만들어진 WebSquare Publishing Editor 상대좌표 변환툴**이다.
iWorks/WebTop 환경에서 운용되던 절대좌표 기반의 단말 화면(.scn → WebSquare XML)을, 웹표준 흐름(반응형) 레이아웃에 맞는 상대좌표 WebSquare XML로 일괄 변환하는 것을 목적으로 한다.

샘플 파일(`samples/`, `comparison/`)에는 다음과 같은 메타정보가 포함되어 있어 변환 파이프라인의 입력 출처를 추정할 수 있다.

| 메타 단서 | 의미 |
|-----------|------|
| `meta_convertType="Craft"`, `meta_craftVer="20251209"` | 인스웨이브 Craft 도구로 1차 변환된 산출물 |
| `meta_asisFileNm="...scn"` | 원본은 WebTop/iWorks의 .scn 단말 화면 |
| `xmlns:w2="http://www.inswave.com/websquare"` | 인스웨이브 WebSquare 기반 |
| 화면 ID `KAA/KBC/KEA/KEC/KFA/KFC/KFG/KFL/KGA/KHC/KJI/KJM…` + 화면명(영업점특별선정고객정보, 구속성예금 관련 사전조회, B2B상품자기업이관신청번호조회 등) + 사번 작성자 | **KB국민은행 단말 차세대 화면** |
| `samples/[KB국민은행] 전환 매핑 요소.xlsx` | KB국민은행 전용 class 매핑 규칙 동봉 |

따라서 동봉된 샘플의 변환 파이프라인은 다음과 같다.

```
KB국민은행 .scn (WebTop/iWorks)
  → Inswave Craft : 절대좌표 WebSquare XML  (샘플 입력)
  → 본 툴(XML to XML)        : 상대좌표 WebSquare XML  (샘플 출력 *_pub.xml / *_rel_v1.xml)
```

도구 자체는 KB국민은행 전용이 아니며, 동일한 패턴의 절대좌표 WebSquare XML이라면 다른 사이트에서도 사용할 수 있다. 다만 class 매핑(`btn_def1` → `btn_cm` 등)은 KB 매핑 엑셀을 기준으로 하드코딩되어 있어, 사이트가 다르면 매핑만 별도 조정하면 된다.

## 목적

기존 XML 좌표변환은 skill MD에 정의된 규칙을 코드에 하드코딩하는 방식이라, 규칙 변경 시 JS를 직접 수정해야 하는 한계가 있었다.
XML to XML은 실제 잘 만들어진 변환 샘플(원본과 변환 결과 쌍)에서 패턴을 추출하여 변환하는 방식으로, MD 규칙에 의존하지 않는다.

## 탭 구성

본 에디터는 세 개의 탭으로 구성된다.

| 탭 | 용도 |
|----|------|
| **XML to XML** (기본) | 절대좌표 XML → 상대좌표 XML 샘플 기반 변환, 와이어프레임/검증, 폴더 일괄 변환 |
| **XML 좌표변환** | 규칙 기반(레거시) 변환기 — abs-to-rel-converter.js 사용 |
| **배치 비교** | 변환 전/후를 실 서버에서 렌더하여 스크린샷·메트릭으로 일괄 비교 (신규) |

## 기존 방식과의 차이

| 항목 | XML 좌표변환 (탭 2) | XML to XML (탭 1) |
|------|---------------------|-------------------|
| 변환 근거 | skill MD 규칙 하드코딩 | 실제 샘플 쌍에서 추출한 패턴 |
| 변환 엔진 | abs-to-rel-converter.js | sample-converter.js |
| hierarchy/orgid | 제거 | 보존 |
| 속성 순서 | 원본 순서 | 알파벳순 정렬 |
| 메인 그룹 | .sub_contents.flex_cont | .sub_contents + meta_snippet 메타 |
| .btnbox 구조 | .rt만 | .lt(숨김) + .rt(버튼) |
| 숨김 필드 | 주석 처리 | .hidden_field(display:none) |
| 태그 형식 | self-closing | open/close 태그 |

## 주요 기능

### 1. 변환
- 절대좌표 XML을 상대좌표 XML로 자동 변환
- 일반 변환 / 반응형 변환 선택 (반응형 시 adaptive, adaptiveThreshold 추가)
- 다중 파일 동시 처리
- 변환 XML 복사 / 다운로드
- **태그 리네이밍 매핑 (TAG_RENAME_MAP)**: 출력 XML의 컴포넌트 태그명을 일괄 치환할 수 있다. sample-converter.js 상단의 `TAG_RENAME_MAP`에 `'xf:input': 'w2:kb_input'` 같은 규칙을 추가하면 모든 출력 경로(섹션/그리드/숨김/버튼)에 동일하게 적용된다. 속성은 변경하지 않고 원본 그대로 유지한다. 매핑이 비어 있으면 기존 동작과 동일.
- **w2:IBSheet 정규화**: 그리드 출력 시 원본 태그가 `w2:IBSheet`인 경우 `w2:gridView`로 자동 변환된다 (그 외 그리드 태그는 원본 보존).

### 2. 폴더 일괄 변환 (신규)
- XML to XML 탭 상단의 "폴더 선택 & 일괄 변환" 버튼
- 선택한 폴더를 **하위 재귀 스캔**하여 `*.xml` 중 같은 폴더 안에 `_rel_v*.xml` 쌍이 없는 원본만 일괄 변환
- 결과는 원본 옆에 `<name>_rel_v1.xml`로 저장 (현재 선택된 일반/반응형 옵션 적용)
- 진행률은 저장 오버레이로 표시, 실패 목록은 콘솔(F12)에 출력
- File System Access API 사용 (Chromium 계열 브라우저 필요)

### 3. 와이어프레임
- 절대좌표 와이어프레임: 원본 좌표 기반 레이아웃 시각화 (GroupBox 타이틀 표시)
- 상대좌표 와이어프레임: 변환 결과의 템플릿 구조 시각화
- 라벨/ID 토글: 컴포넌트의 라벨 또는 ID를 전환하여 표시
- **셀 ID 토글 (신규)**: tblbox 등의 td/th 단위 ID 표시를 별도 버튼으로 on/off (기본 숨김, 클릭 시 노출)
- ID 불일치 빨간색 표시: 원본과 변환 간 누락된 ID 시각 확인
- **섹션 디스패처 일원화**: 미지 class·`grpbox_wrap`·class 없는 래퍼 group·직계 컴포넌트도 누락 없이 렌더 (`renderGenericGroupFromDom` / `renderGrpboxWrapFromDom` 추가)
- **섹션 헤더 표기 개선**: class 배지가 라벨 우측의 회색 괄호 표기로 정리되어 라벨 가독성 향상

### 4. 검증 (통합 탭)
- 컴포넌트 검증: 타입별 통계, 겹침/좌표 이상 검사, 전체 컴포넌트 목록
- 스크립트 검증: 이벤트 핸들러, ID 참조, ref 바인딩, dataList, 속성 보존 검증
- FAIL 항목별 구체적 오류 설명 및 영향 안내
- 누락 복구: 숨김 컴포넌트는 자동 복구, 화면 표시 컴포넌트는 수동 확인 경고

### 5. 배치 비교 (신규 탭)
실제 WebSquare 서버에 변환 전/후 XML을 띄워 스크린샷을 찍고, 보존율을 자동 계산해 비교 리포트를 만든다.

- **로컬 캡처 서비스 필요**: `tools/capture-server.js` (Puppeteer + Express, 포트 5678). `start-editor.bat` 더블클릭 시 캡처 서비스와 에디터가 함께 기동된다.
- **설정 항목**:
  - WebSquare 서버 (`172.16.0.10:8080` 형식, http/https 자동 인식)
  - 서버 루트 폴더 (URL의 `/...` 경로 시작점)
  - 비교 대상 폴더 (서버 루트 하위) → URL `w2xPath`가 자동 계산되어 미리보기에 표시
  - 리포트 폴더, 엔트리 파일명, 캡처 대기(ms), 뷰포트(W×H)
- **파일 쌍 스캔**: 비교 대상 폴더를 하위 재귀로 훑어 `foo.xml` ↔ `foo_rel_v*.xml` 쌍을 자동 매칭. 미변환 파일이 보이면 "미변환 자동 변환" 버튼으로 일반/반응형 옵션을 선택해 같은 자리에서 일괄 변환 가능.
- **실행**: 선택한 쌍을 한 번에 캡처(원본/변환 병렬). 진행률·중단 지원.
- **리포트 산출물 구조**:
  ```
  {reportDir}/
    {entryFile}              엔트리 HTML (run 목록/요약/chunk 링크)
    manifest.json            전체 메타데이터 (run·chunk·평균 보존율)
    runs/{runId}/
      chunk_NNN.html         화면 100개 단위 비교 페이지
      images/
        NNNN_orig.jpg        원본 스크린샷 (JPEG quality 80)
        NNNN_conv.jpg        변환 스크린샷
  ```
- **chunk 분리 이유**: 단일 HTML 비대화 방지(1 chunk ≤ 100), append O(N²) 제거, 새 run은 기존 chunk 미변경.
- **보존율 산출**: capture-server가 모든 frame에서 카테고리별 가시 컴포넌트(폼/버튼/링크/이미지/테이블/그리드/탭/패널) 카운트와 보이는 텍스트 토큰을 추출 → 카테고리별 `min/max` 보존율 + 텍스트 Jaccard 유사도 → 동일 가중 평균이 종합 보존율.
- **체크/메모 영속화**: 각 화면 단위로 체크박스·메모를 localStorage에 보존.
- **엔트리 열기 안내**: chunk 상대링크가 작동하려면 탐색기에서 엔트리 HTML을 직접 더블클릭. 에디터의 "엔트리 열기" 버튼은 blob URL이라 chunk 링크가 깨진다(요약 확인용).

## 변환 패턴

### 섹션 분류 (좌표 기반, 원본 순서 유지)

| 원본 구조 | 변환 결과 | 판별 기준 |
|-----------|-----------|-----------|
| class=title_h2 textbox | .titbox (tagname=h3) | class 속성 |
| Text 단독 Row (폼 없음) | .titbox (제목) | Row에 Text 1개, 폼 요소 없음 |
| * 또는 ※ 시작 Text 단독 Row | .msgbox (설명) | 라벨이 * 또는 ※로 시작 |
| Text + 폼 요소 같은 Row | .tblbox > th + td | Row에 폼 요소 있음 |
| Text-only Row + Form Row 2개 이상 | .tblbox > thead + tbody | 리스트형 테이블 |
| Text-only GroupBox | .msgbox (GroupBox 내만) | GroupBox 안 Text만 있음 |
| GridView / grd_wrap | .gvwbox (class=gvw) | ctype=IBSheet/GridView |
| TAB (w2:tabControl) | .tbcbox > w2:tabControl(class=tbc) | ctype=TAB |
| w2:pageFrame (Panel) | self-closing (독립 블록) | ctype=Panel |
| 독립 버튼 Row | .btnbox > .rt (class=btn_cm) | Row에 버튼만 있음 |
| 같은 Row의 버튼 | 테이블에 유지 | 폼 요소와 같은 Row |
| 숨김 필드 | .hidden_field (display:none) | visibility:hidden / display:none |
| 좌우 분할 GroupBox | .lybox > .col_N (2열 이상) | 같은 Y 영역 + left 분리(50px 이상) |

### 블록 컴포넌트 직전 버튼 처리
- 콘텐츠 섹션(grid/tab/groupbox) 직전의 standalone 버튼은 해당 섹션의 titbox 우측(.rt)에 배치
- Text+Button 혼합 standalone의 경우: 버튼은 titbox .rt, 텍스트는 titbox tit_main
- title_h2가 있는 섹션이면 해당 titbox에 합류, 없으면 새 titbox 생성
- GroupBox 내부(폼요소 포함)의 버튼은 추출하지 않고 테이블에 유지

### 검색영역(schbox) 판별
- 첫 번째 GroupBox + 폼 요소 포함 + 그리드 없음
- 버튼 텍스트가 정확히 "조회"/"검색"/"초기화"인 버튼 OR 우측 60% 이상 위치 버튼
- 다른 글자가 포함된 버튼(예: "상품조회", "가능번호조회")은 검색 버튼으로 판단하지 않음

### 좌표 처리
- 모든 컴포넌트의 절대좌표를 계산 (부모 좌표 누적)
- 좌표 없는 wrapper group은 자식 컴포넌트의 최소 top으로 위치 결정
- 섹션 정렬은 절대좌표 top 기준으로 원본 화면 순서 유지
- table, grid, table 순서가 변환 후에도 동일하게 유지

### 스타일 처리

| 컴포넌트 | style 처리 |
|---------|-----------|
| 폼 요소 (Edit, Calendar, SelectBox 등) | width만 유지, 나머지 삭제 |
| GridView | width:100%; height:150px; 고정 |
| GridView (display:none) | gvwbox에 style="display:none;" 적용 |
| TAB (tabControl, content, pageFrame) | style="" (전체 삭제), class="tbc" 적용 |
| Panel (w2:pageFrame) | style="" (전체 삭제), self-closing |
| Text, Button 등 기타 | style="" (전체 삭제) |
| 숨김 필드 | width + display:none |

### class 매핑 (엑셀 기준)

| AS-IS | TO-BE |
|-------|-------|
| btn_def1, btn_def2, btn_def3 | btn_cm |
| btn_ico_search | btn_cm search icon |
| btn_def_link | btn_cm |
| kb_btn_white | btn_cm pt |
| kb_txt_red | txt_red |
| kb_title_h2 | tit_main |
| kb_title_h3 | tit_sub |

참조: samples/[KB국민은행] 전환 매핑 요소.xlsx

### 태그 리네이밍 (선택)
- `js/sample-converter.js` 상단 `TAG_RENAME_MAP` 객체에 `'원본태그': '치환태그'` 형태로 추가
- 적용 범위: 모든 직렬화 경로 (섹션 컴포넌트, 그리드 컬럼/헤더, 숨김 필드, 버튼)
- 속성·자식 노드는 변경하지 않음
- 비어 있으면(`{}`) 원본 태그 그대로 유지 (현재 기본값)
- 예시:
  ```js
  const TAG_RENAME_MAP = {
    'xf:input': 'w2:kb_input',
    'xf:select1': 'w2:kb_selectbox',
    'w2:gridView': 'w2:kb_gridView',
  };
  ```

### colgroup / colspan 계산
- th-td 쌍 수 자동 계산하여 colgroup 열 수 결정 (1단/2단 자동 구분)
- Row별 사용 열 수와 colgroup 전체 열 수 비교하여 colspan 자동 적용
- td가 th보다 먼저 오는 Row(안내문구+라벨)는 앞쪽 td를 colspan으로 처리
- 폼 요소 바로 옆의 단위 텍스트(%,~,-,/ 등)는 th로 분리하지 않고 같은 td에 포함 (좌표 기반 30px 이내)
- meta_snippetName: 5_01 테이블(1단) / 5_02 테이블(2단) 자동 분기

### 리스트형 테이블 (thead/tbody)
- Text-only Row 1개 + Form-only Row 2개 이상 연속 시 감지
- thead에 Text를 th로, tbody에 Form을 컬럼 매칭하여 td로 배치
- header의 left 좌표 기준으로 form 컴포넌트를 가장 가까운 컬럼에 매칭

### ID 처리
- GroupBox 1개: sub_contents에 id, 하위 wrapper는 id=""
- GroupBox 여러 개: sub_contents에 id="", 각 wrapper에 GroupBox id
- titbox의 textbox: 원본 title 컴포넌트의 실제 id 보존
- ID는 전체 변환 결과에서 1번만 사용 (중복 방지)

### 좌우 분할 (다중 열)
- 같은 Y 영역(30px 이내)에 있는 GroupBox들을 자동 감지
- left 차이가 50px 이상이어야 좌우 분할로 판정 (같은 left면 상하 배치)
- 2열, 3열, 4열 이상 지원
- lybox 안에 col_N 비율 자동 계산 (합계 10)

### TAB 처리
- xml-parser.js에서 ctype=TAB인 w2:tabControl을 tab 섹션 타입으로 분류
- group 안에 TAB이 포함된 경우 TAB만 분리하여 별도 tab 섹션 생성
- sample-converter.js의 buildTbcbox()에서 tbcbox 래퍼 + tbc class 적용
- TAB 내부 컴포넌트: Panel이면 self-closing, 인라인이면 재귀 변환
- TAB 내부 누락 컴포넌트는 hidden_field에 자동 복구

### Panel (w2:pageFrame) 처리
- 외부 화면 참조 블록으로 독립 처리 (BLOCK_TYPES)
- 겹침 감지에서 overlayComp 흡수 제외
- style 비우고 self-closing 태그로 출력

### hidden 처리
- 부모 GroupBox가 display:none이면 자식 컴포넌트도 모두 hidden으로 전파
- hidden 섹션은 원래 섹션 구조(groupbox 등)를 유지한 채 동일한 processSection으로 변환
- 변환 결과는 hidden_field(display:none) 안에 배치
- 이미 출력된 ID(hidden gvwbox 등)는 중복 방지로 제외

### titbox 내 버튼 배치
- overlayComps 중 버튼(Button/Trigger/LinkText)은 titbox .rt 영역에 배치
- overlayComps 중 비버튼은 titbox 본문에 배치
- rtBtns(블록 직전 버튼)와 overlayComps 버튼은 하나의 .rt 그룹으로 통합

## 기술 구조

```
index.html                    <- UI (단일 HTML, XtX/XML/배치 비교 3탭)
js/
  sample-converter.js         <- 샘플 기반 변환 엔진 (핵심) — TAG_RENAME_MAP 지원
  script-validator.js         <- 스크립트/바인딩/속성 검증
  abs-wireframe-gen.js        <- 절대좌표 와이어프레임 HTML
  rel-wireframe-gen.js        <- 상대좌표 와이어프레임 HTML (디스패처 + 셀ID 토글)
  xml-parser.js               <- 공통 XML 파싱
  abs-to-rel-converter.js     <- 탭2: 규칙 기반 변환 (레거시)
  wireframe-gen.js            <- 탭2: Wireframe MD
  xml-generator.js            <- HTML -> WebSquare XML
  html-converter.js           <- HTML 파싱
samples/
  reference-pairs/            <- 변환 샘플 쌍 (파일명.xml / 파일명_pub.xml)
  horizontal division.xml     <- 좌우 분할 구조 샘플
  2_01~2_21 *.xml             <- 구조화된 템플릿 샘플
  [KB국민은행] 전환 매핑 요소.xlsx <- class 매핑 규칙 (AS-IS → TO-BE)
tools/
  capture-server.js           <- 배치 비교용 Puppeteer 캡처 서비스 (Express, :5678)
  package.json / node_modules <- puppeteer + express
  README.md                   <- 캡처 서비스 사용법
start-editor.bat              <- 캡처 서비스 + 에디터 동시 기동
comparison/                   <- 외부 비교용 샘플 XML 모음 (배치 비교 입력 예시)
```

## 실행

### 기본 (XML to XML / 와이어프레임 / 검증만 사용)
- `index.html`을 브라우저로 직접 열기 (외부 의존성 없음)

### 배치 비교 사용 시
1. 최초 1회: `cd tools && npm install` (Puppeteer + Chrome 바이너리 ~170MB)
2. 프로젝트 루트의 `start-editor.bat` 더블클릭 → 캡처 서비스(:5678)와 에디터가 함께 뜸
3. 에디터 상단 "배치 비교" 탭에서 서버/폴더/리포트 폴더 설정 후 실행

## 참조 파일

| 경로 | 용도 |
|------|------|
| samples/reference-pairs/*.xml | 원본 변환 샘플 (절대좌표) |
| samples/reference-pairs/*_pub.xml | 변환 결과 샘플 (상대좌표) |
| samples/reference-pairs/2_*.xml | 구조화 템플릿 (.schbox, .lybox 등) |
| samples/[KB국민은행] 전환 매핑 요소.xlsx | class 매핑 규칙 |
| comparison/*.xml | 배치 비교용 외부 샘플 (KAA*, KEC*, KFA* 등) |
| D:/AI_workspace/AI_WRM/WebContent/pub/wcraft/ | 실제 테스트 파일 경로 |

## 검증 항목 (스크립트 검증)

| # | 검증 | 내용 |
|---|------|------|
| 1 | 이벤트 핸들러 | scwin.{id}_OnClick 등의 대상 id 존재 여부 |
| 2 | 스크립트 ID 참조 | {id}.Value, {id}.ExcelExportS() 등 존재 여부 |
| 3 | ID 비교 | 원본 vs 변환 간 누락/추가 ID |
| 4 | ref 바인딩 | ref=data:dma_.{field} 보존 여부 |
| 5 | dataList 바인딩 | dataList=data:dlt_{id} 보존 여부 |
| 6 | 속성 보존 | disabled, displayFormat, maxlength 변경 여부 |
| 7 | 누락 복구 | 숨김은 자동복구, 화면표시는 수동확인 경고 |

## 배치 비교 보존율 카테고리

| 키 | 표시명 | 선택자 |
|----|--------|--------|
| input | 폼 필드 | input(hidden/button 제외), select, textarea |
| button | 버튼 | button, input[type=button/submit/reset], [role=button] |
| link | 링크 | a[href] |
| image | 이미지 | img |
| table / tableRow / tableCell | 테이블 / 행 / 셀 | table / tr / td,th |
| wsqGrid | 그리드 | [class*=gvw], [class*=gridview], [class*=GridView] |
| wsqTab | 탭 | [class*=tbc], [class*=tabControl] |
| wsqPanel | 패널 | [class*=pageFrame], [class*=panel] |
| text | 텍스트(토큰) | 보이는 텍스트의 단어 토큰 Jaccard |

각 카테고리는 가시(visible) 요소만 카운트. 양쪽 모두 0인 카테고리는 표에서 제외. 카테고리별 보존율 = `min(orig, conv) / max(orig, conv)`. 종합 보존율은 표시된 카테고리들의 동일 가중 평균.

## 향후 과제

- 카드형 메뉴 구조 지원 (GroupBox Caption + 버튼 그룹): 샘플 추가 후 반영
- .scn 파일 직접 지원 (현재 미지원)
- 배치 비교 — 보존율 카테고리 가중치 사용자 조정
- 배치 비교 — 항목별 픽셀 단위 diff(SSIM 등) 추가
