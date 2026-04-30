# 배치 비교 캡처 서비스

WebSquare Publishing Editor의 "배치 비교" 기능에서 사용하는 로컬 Puppeteer 서비스.

## 최초 1회 설치

```
cd tools
npm install
```

Puppeteer 설치 시 Chrome 바이너리(~170MB)가 자동 다운로드됩니다.

## 실행

### 옵션 1 — 배치파일 (권장)

프로젝트 루트의 `start-editor.bat` 더블클릭.
- 캡처 서비스가 백그라운드로 뜨고
- Editor(`index.html`)가 브라우저에 자동으로 열립니다.

### 옵션 2 — 수동

```
cd tools
node capture-server.js
```

## 엔드포인트

- `GET  http://localhost:5678/health` — 서비스 상태 확인
- `POST http://localhost:5678/capture` — PNG 캡처

요청:
```json
{
  "url": "http://server/websquare/websquare.html?w2xPath=...",
  "waitMs": 3000,
  "viewport": { "width": 1280, "height": 900 }
}
```

응답:
```json
{
  "ok": true,
  "pngBase64": "iVBORw0KG...",
  "width": 1280,
  "height": 900
}
```

## 종료

터미널 창을 닫거나 `Ctrl+C`.
