# 스윙픽서

골프 프로그램을 모아 실행하는 앱입니다. 홈에서 프로그램 버튼을 누르면 들어가고, 안에서는 상단 탭으로 프로그램끼리 바로 전환합니다.
iOS/Android 앱(Capacitor)과 웹(Cloudflare)으로 배포합니다. 현재 프로그램: **스윙 분석** (미니게임·룰북·에티켓은 준비 중)

## 구조
```
index.html, src/          앱 화면 (홈 버튼 · 상단 탭 · 디자인). 프로그램이 늘어도 고치지 않음
programs/
  swing/                  스윙 분석 — 기존 프로그램을 통째로 넣은 폴더 (자세한 사용법: programs/swing/README.md)
    program.json          앱에 표시할 이름·설명·아이콘·색·순서
    build.mjs             이 프로그램 전용 빌드 단계 (MediaPipe 복사)
    index.html, src/, assets/, tools/, serve.py, start.bat ...   원본 그대로
  minigame/ rulebook/ etiquette/   준비 중 (program.json 만 있음)
scripts/build-www.mjs     programs/ 를 훑어 www/ 와 www/programs.json 생성
scripts/dev-server.mjs    개발용 서버
scripts/patch-native.mjs  iOS/Android 카메라 권한 추가
capacitor.config.json     앱 이름·ID        wrangler.jsonc   Cloudflare 배포 설정
```

## 실행 (개발)
```
npm install
npm run dev          # http://localhost:3000  (Windows 는 start-app.bat 더블클릭)
```
스윙 분석만 따로 개발할 때는 기존처럼 `programs/swing/` 안에서 `python serve.py` (또는 그 폴더의 `start.bat`).

## 명령 정리
| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 빌드(앱용, 전부 내장) 후 개발 서버 실행 |
| `npm run build` | 웹/Cloudflare 배포용 `www/` 생성 (25 MiB 초과 파일은 CDN) |
| `npm run build:native` | 앱용 `www/` 생성 (전부 내장, 오프라인 동작) |
| `npm run build:slim` | 웹용 + MediaPipe lite/full 모델 제거 |
| `npm run sync` / `ios` / `android` | 앱용 빌드 후 Capacitor 에 반영 / Xcode / Android Studio 열기 |
| `npm run patch-native` | `npx cap add ios/android` 후 카메라 권한 추가 |
| `npm run deploy` | 웹 빌드 후 Cloudflare 배포 |

모바일 앱·배포 상세는 `MOBILE.md` 참고.

## 프로그램 추가하는 법 (앱 화면 코드는 안 건드림)
1. `programs/새이름/` 폴더를 만든다.
2. `program.json` 작성: `{ "id": "새이름", "order": 5, "title": "표시 이름", "desc": "한 줄 설명", "icon": "<svg path>", "color": "#5AA2F7" }`
3. 완성된 프로그램은 `programs/새이름/web/index.html` (+ 필요한 파일)을 넣는다. `web/`이 없으면 "준비 중"으로 표시된다.
   - 화면 폴더 이름이 다르면 `"entry"`, 그 안에서 앱에 넣을 파일만 고르려면 `"include": ["index.html","src"]` 를 쓴다. (`swing/program.json` 참고)
4. 특별한 빌드가 필요하면 `build.mjs`를 두고 `export default async function ({ out, base, root, native, slim }) {}` 를 내보낸다. (`swing/build.mjs` 참고)
5. `npm run dev` 를 다시 실행하면 홈 버튼과 탭에 자동으로 나타난다. "준비 중" 폴더를 완성할 때는 같은 폴더에 `web/`만 넣으면 된다.

## 깃에 반영하는 법
이 폴더의 내용으로 저장소를 통째로 교체합니다. (폴더 구조가 바뀌어서 옛 파일을 지워야 합니다)
1. 저장소 폴더에서 `.git` 만 남기고 나머지를 모두 삭제
2. 이 폴더의 모든 파일(숨김 파일 `.gitignore`, `.node-version` 포함)을 저장소 폴더에 복사
3. `git add -A` → `git commit -m "스윙픽서 앱 구조로 변경"` → `git push`

주의: 배포 주소(Cloudflare)의 첫 화면이 프로그램 선택 화면으로 바뀌고, 스윙 분석은 `/programs/swing/` 에서 열립니다.
