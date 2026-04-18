# XML to XML (샘플 기반 변환)

## 목적

기존 XML 좌표변환은 skill MD에 정의된 규칙을 코드에 하드코딩하는 방식이라, 규칙 변경 시 JS를 직접 수정해야 하는 한계가 있었다.
XML to XML은 실제 잘 만들어진 변환 샘플(원본과 변환 결과 쌍)에서 패턴을 추출하여 변환하는 방식으로, MD 규칙에 의존하지 않는다.

## 기존 방식과의 차이

| 항목 | XML 좌표변환 (탭 1) | XML to XML (탭 2) |
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

### 2. 와이어프레임
- 절대좌표 와이어프레임: 원본 좌표 기반 레이아웃 시각화 (GroupBox 타이틀 표시)
- 상대좌표 와이어프레임: 변환 결과의 템플릿 구조 시각화
- 라벨/ID 토글: 컴포넌트의 라벨 또는 ID를 전환하여 표시
- ID 불일치 빨간색 표시: 원본과 변환 간 누락된 ID 시각 확인

### 3. 검증 (통합 탭)
- 컴포넌트 검증: 타입별 통계, 겹침/좌표 이상 검사, 전체 컴포넌트 목록
- 스크립트 검증: 이벤트 핸들러, ID 참조, ref 바인딩, dataList, 속성 보존 검증
- FAIL 항목별 구체적 오류 설명 및 영향 안내
- 누락 복구: 숨김 컴포넌트는 자동 복구, 화면 표시 컴포넌트는 수동 확인 경고

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
index.html                    <- UI (단일 HTML, 외부 의존성 없음)
js/
  sample-converter.js         <- 샘플 기반 변환 엔진 (핵심)
  script-validator.js         <- 스크립트/바인딩/속성 검증
  abs-wireframe-gen.js        <- 절대좌표 와이어프레임 HTML
  rel-wireframe-gen.js        <- 상대좌표 와이어프레임 HTML (변환 XML 파싱)
  xml-parser.js               <- 공통 XML 파싱
  abs-to-rel-converter.js     <- 탭1: 규칙 기반 변환 (기존)
  wireframe-gen.js            <- 탭1: Wireframe MD
  xml-generator.js            <- HTML -> WebSquare XML
  html-converter.js           <- HTML 파싱
samples/
  reference-pairs/            <- 변환 샘플 쌍 (파일명.xml / 파일명_pub.xml)
  horizontal division.xml     <- 좌우 분할 구조 샘플
  2_01~2_21 *.xml             <- 구조화된 템플릿 샘플
  [KB국민은행] 전환 매핑 요소.xlsx <- class 매핑 규칙 (AS-IS → TO-BE)
```

## 참조 파일

| 경로 | 용도 |
|------|------|
| samples/reference-pairs/*.xml | 원본 변환 샘플 (절대좌표) |
| samples/reference-pairs/*_pub.xml | 변환 결과 샘플 (상대좌표) |
| samples/reference-pairs/2_*.xml | 구조화 템플릿 (.schbox, .lybox 등) |
| samples/[KB국민은행] 전환 매핑 요소.xlsx | class 매핑 규칙 |
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

## 향후 과제

- 카드형 메뉴 구조 지원 (GroupBox Caption + 버튼 그룹): 샘플 추가 후 반영
- .scn 파일 직접 지원 (현재 미지원)
