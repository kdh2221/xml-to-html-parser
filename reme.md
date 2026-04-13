# WebSquare Publishing Editor

## 목적

비개발자(기획자, 디자이너, PM 등)가 **WebSquare 퍼블리싱 작업을 직접 수행**할 수 있도록 돕는 브라우저 기반 도구.
기존에는 개발자만 할 수 있었던 WebSquare XML 레이아웃 변환 작업을, 코드를 모르는 사람도 파일을 드래그 & 드롭하는 것만으로 처리할 수 있게 한다.

## 해결하려는 문제

- WebSquare 화면 XML은 절대좌표(absolute position) 기반으로 작성되는 경우가 많음
- 절대좌표 XML은 반응형 대응이 안 되고, 유지보수가 어려움
- 상대좌표(relative/flex) 기반 레이아웃으로 변환하려면 퍼블리싱 규칙을 알아야 하고, 수작업 비용이 큼
- 이 과정을 자동화하여 비개발자도 변환 결과물을 즉시 얻을 수 있게 함

## 핵심 기능

### 1. XML 좌표변환 (메인 기능)
- WebSquare 절대좌표 XML 파일을 업로드하면 상대좌표 XML로 자동 변환
- 다중 파일 동시 처리 지원
- 변환 전/후 검증 리포트 제공 (컴포넌트 누락, 속성 변경 등 확인)
- Wireframe Markdown 자동 생성 (변환 결과의 구조를 시각적으로 확인)

### 2. HTML 변환
- HTML 파일을 WebSquare XML 형식으로 변환

### 3. 결과 출력
- 변환된 XML 복사/다운로드
- Wireframe MD 복사
- 저장 경로: `D:/AI_workspace/AI_WRM/WebContent/pub/wcraft/`
- 파일명 규칙: `{screenId}_rel_v{버전}.xml`

## 변환 규칙 요약

| 원본 구조 | 변환 결과 |
|-----------|-----------|
| GroupBox (title 포함) | `.titbox` + `.tblbox` |
| GroupBox (조회버튼 포함) | `.schbox` |
| GroupBox (일반) | `.tblbox` |
| GridView / grd_wrap | `.gvwbox` |
| standalone 버튼 (중간) | `.titbox > .rt` |
| standalone 버튼 (마지막) | `.btnbox > .rt` |
| hidden 요소 | `<!-- hidden fields -->` |

## 기술 구조

```
index.html                  ← UI (단일 HTML, 외부 의존성 없음)
js/
├── xml-parser.js           ← XML 파싱, 섹션 분류, Row/셀 분석
├── abs-to-rel-converter.js ← 절대좌표 → 상대좌표 변환 엔진
├── wireframe-gen.js        ← 변환 결과 Wireframe MD 생성
├── xml-generator.js        ← HTML → WebSquare XML 생성
└── html-converter.js       ← HTML 파싱 → 컴포넌트 추출
reference/                  ← WebSquare 참조 문서 (규칙, 스켈레톤, 스니펫)
samples/                    ← 샘플 파일
skill/                      ← Claude AI 연동용 스킬 정의 (변환 규칙 MD)
```

## 방향성

1. **제로 설치**: 브라우저만 있으면 동작. 서버/빌드/의존성 없음
2. **비개발자 친화**: 코드 지식 없이 드래그 & 드롭만으로 결과물 획득
3. **프로젝트 규칙 내장**: WRM 표준 규칙(DeepSquare), 퍼블리싱 스켈레톤/스니펫이 변환 엔진에 직접 반영
4. **검증 가능**: 변환 전/후 비교 검증으로 누락·오류를 즉시 확인
5. **AI 연동 확장**: skill 폴더의 MD를 통해 Claude AI가 동일한 변환 규칙을 참조하여 추가 작업 가능

## 대상 사용자

- 퍼블리싱 경험이 없는 기획자/PM
- WebSquare 프로젝트의 화면 레이아웃을 빠르게 전환해야 하는 담당자
- 개발자가 아닌 인원이 퍼블리싱 산출물을 직접 생성해야 하는 상황
