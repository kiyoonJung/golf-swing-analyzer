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

## 서버 (Supabase) · 로그인 · 기록 저장
서버는 **Supabase 무료 플랜**입니다. 별도 서버 코드는 없고, 브라우저가 Supabase 에 직접 접속합니다. (프로젝트 주소와 anon 키는 `programs/swing/src/js/supabase.js` 에 있으며, anon 키는 공개용입니다. **service_role 키와 각종 client secret 은 절대 저장소에 넣지 않습니다.**)

### 파일 역할
| 파일 | 역할 |
|---|---|
| `src/gate.js` | 앱 첫 화면 로그인 창 (로그인·가입·비밀번호 재설정·게스트). 로그인 전에는 홈 화면이 가려짐 |
| `programs/swing/src/js/auth.js` | 로그인·가입·로그아웃·비밀번호 재설정 함수 |
| `programs/swing/src/js/authui.js` | 스윙 화면 상단의 로그인 상태 표시 (앱 안에서는 로그인 창을 부모 화면에 요청) |
| `programs/swing/src/js/records.js` | 기록 저장·목록·상세·삭제, 영상 업로드와 용량 제한 |
| `programs/swing/src/js/recordsui.js` | 상단 💾 저장 / 📂 내 기록 버튼과 창 |
| `programs/swing/src/js/db.js`, `auth-test.html` | 초기 DB 시험용 (`auth-test.html` 은 앱 빌드에 포함되지 않음, 포트 8010 에서만 동작) |

### 동작 규칙
- **게스트**: 분석은 가능하고 저장은 불가. 저장·내 기록을 누르면 로그인 안내가 나옴. 게스트 상태는 `sessionStorage` 에만 있음.
- **저장 내용**: 단계별 오차, 단계별 자세(관절 좌표), 저장 시점의 피드백 문구, 메모. 시각은 한국 시간(KST)으로 표시.
- **영상**: 선택 저장. **1인당 3개, 영상당 45MB**. 초과하면 기록·피드백만 저장. 영상은 상세 화면에서 "영상 보기"를 눌러야 불러옴(비공개 저장소, 1시간짜리 임시 주소).
- **삭제**: 두 번 눌러야 삭제. 영상 파일을 먼저 지우고 기록을 지움.

### DB 구성 (SQL 은 Supabase 대시보드 → SQL Editor 에서 실행)
- 테이블 `public.swing_sessions` : 행 단위 보안(RLS)으로 `auth.uid() = user_id` 인 본인 행만 읽기·쓰기. 영상 컬럼 `video_path`, `video_size`, `video_mime`.
- 제약: 영상 경로는 `본인ID/...` 형식, 크기 45MB 이하. 트리거 `limit_swing_videos` 가 1인당 3개를 넘으면 `video_limit_reached` 오류를 냄.
- 저장소 버킷 `swing-videos` : **비공개**, 파일 한도 45MB, webm·mp4·quicktime·3gpp 만 허용. 본인 폴더(`본인ID/`)만 읽기·쓰기·삭제.
- 확인용 쿼리는 `02_확인용_SQL.sql` 참고.

### Supabase 설정값 (대시보드)
- Authentication → URL Configuration: **Redirect URLs** 에 `http://localhost:8010/**`, `http://localhost:3000/**`, Cloudflare 주소를 등록. (Site URL 은 아직 localhost:8010, 배포 후 Cloudflare 주소로 바꾸는 것을 검토)
- 이메일 인증 메일은 기본 메일 서버를 쓰는 중이라 **시간당 발송 한도가 매우 낮음**. 사용자 모집 전에 사용자 지정 SMTP 로 교체 예정(보류, 도메인 필요).

### 소셜·전화 로그인 (보류)
- 코드는 준비돼 있으나 꺼 둠. 카카오는 `src/gate.js` 의 `const SOCIAL = { kakao: false };` 를 `true` 로 바꾸면 버튼이 켜짐. 단, Supabase 카카오 연동이 이메일 동의(`account_email`)를 요구해 **비즈 앱 전환이 필요**(비용·소요 확실하지 않음).
- 구글은 비용 문제로 보류, 전화번호(Twilio)는 체험 30일 후 유료라 보류. **비용이 드는 항목은 팀 합의 후 결정.**

### 운영 주의
- Supabase 무료 프로젝트는 **7일간 활동이 없으면 일시 중지**됩니다. 발표 전에 대시보드에서 상태를 꼭 확인하세요.
- 무료 저장소는 전체 1GB. 영상 3개×45MB×사용자 수를 고려해야 합니다.
- 6MB가 넘는 업로드는 공식 문서가 이어 올리기(resumable)를 권장합니다. 모바일에서 업로드가 자주 끊기면 이 방식으로 교체합니다.

### 통합 시험 체크리스트 (배포 전 / 큰 수정 후)
`npm run dev` (PC) 와 Cloudflare 배포 주소(Galaxy Chrome)에서 각각 확인합니다.
1. 첫 화면에 로그인 창이 뜨고 홈이 가려져 있다. 게스트로 시작하면 홈이 열린다.
2. 가입 → 로그인 → 새로고침해도 로그인 유지 → 로그아웃하면 다시 로그인 창.
3. 비밀번호 재설정 메일 링크로 들어오면 새 비밀번호 입력 창이 뜬다.
4. 영상 분석 후 **저장** (영상 포함 / 미포함 각각) → Storage `swing-videos` 와 `swing_sessions` 에 반영.
5. **내 기록**: 목록, 단계 탭, 자세 그림, 피드백, 영상 보기, 탭 클릭 시 영상 이동.
6. 삭제 후 목록과 Storage 파일이 모두 사라진다.
7. 4번째 영상 저장 시 "기록만 저장" 안내. 45MB 초과 영상은 영상 체크가 꺼지고 이유가 표시.
8. 게스트로 저장 클릭 시 로그인 안내. 다른 계정으로는 남의 기록이 보이지 않는다.
9. 카메라 녹화(webm) 저장·재생 (아이폰 Safari 재생은 확실하지 않음).
10. Galaxy 세로·가로 모드에서 창이 화면 안에 들어온다.

## 깃에 반영하는 법
이 폴더의 내용으로 저장소를 통째로 교체합니다. (폴더 구조가 바뀌어서 옛 파일을 지워야 합니다)
1. 저장소 폴더에서 `.git` 만 남기고 나머지를 모두 삭제
2. 이 폴더의 모든 파일(숨김 파일 `.gitignore`, `.node-version` 포함)을 저장소 폴더에 복사
3. `git add -A` → `git commit -m "스윙픽서 앱 구조로 변경"` → `git push`

주의: 배포 주소(Cloudflare)의 첫 화면이 프로그램 선택 화면으로 바뀌고, 스윙 분석은 `/programs/swing/` 에서 열립니다.