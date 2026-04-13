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
| 숨김 필드 | 주석 처리 | .btnbox .lt에 display:none |
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
| Text-only GroupBox | .msgbox (GroupBox 내만) | GroupBox 안 Text만 있음 |
| GridView / grd_wrap | .gvwbox (class=gvw) | ctype=IBSheet/GridView |
| TAB (w2:tabControl) | .tbcbox > w2:tabControl(class=tbc) | ctype=TAB |
| 독립 버튼 Row | .btnbox > .rt (class=btn_cm) | Row에 버튼만 있음 |
| 같은 Row의 버튼 | 테이블에 유지 | 폼 요소와 같은 Row |
| 숨김 필드 | .btnbox > .lt (display:none) | visibility:hidden / display:none |
| 좌우 분할 GroupBox | .lybox > .col_N (2열 이상) | 같은 Y 영역에 다중 GroupBox |

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
| TAB (tabControl, content, pageFrame) | style="" (전체 삭제), class="tbc" 적용 |
| Text, Button 등 기타 | style="" (전체 삭제) |
| 숨김 필드 | width + display:none |

### colgroup / colspan 계산
- th-td 쌍 수 자동 계산하여 colgroup 열 수 결정 (1단/2단 자동 구분)
- Row별 사용 열 수와 colgroup 전체 열 수 비교하여 colspan 자동 적용
- meta_snippetName: 5_01 테이블(1단) / 5_02 테이블(2단) 자동 분기

### ID 처리
- GroupBox 1개: sub_contents에 id, 하위 wrapper는 id=""
- GroupBox 여러 개: sub_contents에 id="", 각 wrapper에 GroupBox id
- titbox의 textbox: 원본 title 컴포넌트의 실제 id 보존

### 좌우 분할 (다중 열)
- 같은 Y 영역(30px 이내)에 있는 GroupBox들을 자동 감지
- 2열, 3열, 4열 이상 지원
- lybox 안에 col_N 비율 자동 계산 (합계 10)

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
```

## 참조 파일

| 경로 | 용도 |
|------|------|
| samples/reference-pairs/*.xml | 원본 변환 샘플 (절대좌표) |
| samples/reference-pairs/*_pub.xml | 변환 결과 샘플 (상대좌표) |
| samples/reference-pairs/2_*.xml | 구조화 템플릿 (.schbox, .lybox 등) |
| samples/reference-pairs/horizontal division.xml | 좌우 분할 구조 |
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

### TAB 처리
- xml-parser.js에서 ctype=TAB인 w2:tabControl을 `tab` 섹션 타입으로 분류
- group 안에 TAB이 포함된 경우 TAB만 분리하여 별도 `tab` 섹션 생성
- abs-to-rel-converter.js의 buildTbcbox()에서 tbcbox 래퍼 + tbc class 적용
- w2:content(TABPAGE), w2:pageFrame(Panel)의 style 비움
- w2:pageFrame 내부 구조는 원본 그대로 유지 (외부 XML 참조)

## 향후 과제

- 카드형 메뉴 구조 지원 (GroupBox Caption + 버튼 그룹): 샘플 추가 후 반영
- .scn 파일 직접 지원 (현재 미지원)
- .schbox 조회 영역 자동 판별 개선 (현재는 tblbox + btngroup으로 처리)
