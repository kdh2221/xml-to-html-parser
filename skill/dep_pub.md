## 공통 참조 문서

| 분류 | 문서명 | 경로 |
|------|--------|------|
| WRM 표준 규칙 | DeepSquare.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/DeepSquare.md` |
| 퍼블리싱 스켈레톤 | Publishing_Skeleton.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/publishing/Publishing_Skeleton.md` |
| 퍼블리싱 스니펫 | Publishing_Snippets.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/publishing/Publishing_Snippets.md` |
| 코드 작성 규칙 | CodeRules.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/codeRule/CodeRules.md` |
| GCC 참조 | GCC_Reference.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/gcc/GCC_Reference.md` |
| 공통코드 가이드 | setCommonCode_Guide.md | `D:/AI_workspace/AI_WRM/deepsquare/websquare/setCommonCode_Guide.md` |
| 프로젝트 상세 명세 | project-detail-spec.md | `D:/AI_workspace/AI_WRM/deepsquare/userspec/project-detail-spec.md` |

## 웹스퀘어 참고 파일
D:\AI_workspace\AI_WRM\WebContent\cm\template

## 변환기 내장 규칙 (abs-to-rel-converter.js)
Publishing_Skeleton.md, Publishing_Snippets.md 규칙이 변환 엔진에 직접 반영됨:
- 레이아웃: .sub_contents.flex_cont > .schbox > .gvwbox > .btnbox > .tblbox
- 조회조건: table(w2tb tbl) > colgroup(th:150px/td:auto x2) > tr > th(w2tb_th) + td(w2tb_td)
- 버튼: .btn_schbox(조회) / .btnbox > .rt(하단 액션)
- GridView: .gvwbox 내 width:100%
- 상세폼: .tblbox (2-column table)
