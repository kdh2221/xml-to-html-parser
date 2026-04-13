## Skill폴더에 있는 MD는 무조건 참고

## 공통 참조 문서

| 분류 | 문서명 | 경로 |
|------|--------|------|
| WRM 표준 규칙 | DeepSquare.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/DeepSquare.md` |
| 퍼블리싱 스켈레톤 | Publishing_Skeleton.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/publishing/Publishing_Skeleton.md` |
| 퍼블리싱 스니펫 | Publishing_Snippets.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/publishing/Publishing_Snippets.md` |
| 코드 작성 규칙 | CodeRules.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/codeRule/CodeRules.md` |
| GCC 참조 | GCC_Reference.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/gcc/GCC_Reference.md` |
| 참고 템플릿 | 02_Multi | `D:/AI_workspace/AI_WRM/WebContent/cm/template/page/02_Multi/` |

---

# WebSquare 절대좌표 → 상대좌표 XML 변환 Skill

## 모듈 구조

```
js/
├── xml-parser.js           ← 공통: XML 파싱, 섹션 분류, Row/셀 분석
├── abs-to-rel-converter.js ← 변환: 절대좌표 → 상대좌표 XML 생성
├── wireframe-gen.js        ← MD: 변환 후 구조 와이어프레임
├── xml-generator.js        ← HTML → WebSquare XML 생성
└── html-converter.js       ← HTML 파싱 → 컴포넌트 추출
```

## 변환 규칙 요약

### 섹션 구조 (원본 순서 유지)
| 원본 | 변환 |
|------|------|
| GroupBox (title_ 포함) | `.titbox` + `.tblbox` |
| GroupBox (조회버튼 포함) | `.schbox` |
| GroupBox (일반) | `.tblbox` |
| GridView / grd_wrap | `.gvwbox` (class="gvw", height:150px) |
| standalone 버튼 (중간) | `.titbox > .rt` (타이틀과 병합) |
| standalone 버튼 (마지막) | `.btnbox > .rt` |
| standalone 폼 (Text+Edit) | `.tblbox` |
| display:none / hidden | `<!-- hidden fields -->` |

### th/td 판별
- **th**: Text이고 같은 Row 뒤에 폼 요소가 있는 경우 (연속 Text/Desc 포함)
- **td**: 폼 요소 (Edit, Calendar, SelectBox, CheckBox, Button 등) + 뒤따르는 Desc

### 컴포넌트 처리
- 원본 속성 전체 보존 (orgid, hierarchy 제외)
- 버튼 class: `btn_def1` → `btn_cm` 계열로 교체 (`btn_ico_search`는 유지)
- class 있는 컴포넌트: 기본 스타일(color, background, font 등) 제거 (폼 요소 width는 유지)
- colspan: `<w2:attributes><w2:colspan>N</w2:colspan></w2:attributes>`
- title_* 컴포넌트: `.titbox` 변환
- 부모 hidden → 자식 hidden 전파

### 출력
- 경로: `D:/AI_workspace/AI_WRM/WebContent/pub/wcraft/`
- 파일명: `{screenId}_rel_v{버전}.xml`
