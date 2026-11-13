# 모바일 앱 빌드 가이드 (Capacitor)

기존 웹 프로그램을 iOS/Android 앱으로 감싸는 방법입니다. 웹 코드는 그대로 쓰고, `npm run build` 가 앱에 넣을 파일만 `www/` 로 모읍니다.

## 준비물
- Node.js 22 이상
- iOS: Mac + Xcode 26 이상 + Apple Developer 계정(스토어 배포 시)
- Android: Android Studio (Otter 2025.2.1 이상) + JDK 21

## 처음 한 번만
1. `capacitor.config.json` 의 `appId`(현재 `com.example.swingfixer`)를 실제 값(예: `com.회사명.swingfixer`)으로 바꾸세요. **`cap add` 전에 바꾸는 게 쉽습니다.** (스토어 등록 후에는 못 바꿈)
2. 설치: `npm install`
3. 네이티브 프로젝트 생성: `npx cap add ios` / `npx cap add android`
4. 카메라 권한 자동 추가: `npm run patch-native`
   - iOS `Info.plist` 에 카메라/마이크/앨범 사용 문구, Android `AndroidManifest.xml` 에 카메라 권한 추가 (여러 번 실행해도 안전)
   - 권한 문구는 `scripts/patch-native.mjs` 에서 수정

## 실행
- iOS: `npm run ios` → Xcode 가 열리면 실제 아이폰 선택 → ▶
- Android: `npm run android` → Android Studio 에서 기기 선택 → ▶

웹 코드(`index.html`, `src/`, `assets/`)를 고친 뒤에는 `npm run sync` 로 앱에 반영합니다.

## 모바일 전용 기능 / 데스크톱 보호
- **프로 영상 기준으로 크기 맞춤**: 프로 영상 칸이 기준 크기이고, 내 영상 칸은 **프로와 같은 높이**에 폭만 내 영상 비율대로 정해집니다(PC 화면과 같은 모양).
  칸 비율은 영상 원본 비율(가로/세로/정사각형)이라 검은 여백이 없습니다. 파일 업로드, 프로 영상 교체, 라이브 카메라, 전면/후면 전환 모두 해당.
  내 영상이 칸 폭보다 넓어지는 가로 영상(예: 16:9)은 칸 폭까지만 커져서 프로보다 낮아집니다.
- **빈 칸**: 내 영상이 아직 없을 때는 큰 검은 상자 대신, 프로 영상과 같은 크기의 안내 칸("내 영상이 여기에 표시돼요")을 보여 줍니다.
- **가로 모드(폰을 눕혔을 때, 터치 입력 또는 hover 불가 환경 + 높이 500px 이하)**: 왼쪽에 두 영상(스크롤해도 고정, 화면 높이에 맞춰 최대한 크게), 오른쪽에 설정·분석하기·재생 모드·단계 버튼·피드백·미세 조정.
  분석이 끝나면 오른쪽 칸은 결과(단계 버튼·피드백)가 위로, 설정은 아래로 이동합니다. (`:has()` 를 지원하지 않는 구형 기기에서는 설정이 계속 위에 있음)
- **데스크톱은 원본과 동일**: 위 기능과 모바일 CSS 는 전부 `@media (max-width: 640px)`, `(max-height: 500px) and (pointer: coarse)`, `(pointer: coarse)` 안에 있어
  마우스 주 입력의 넓은 화면에는 적용되지 않습니다. 처음 받은 원본과 같은 조건(1100/1440/800px, 라이트/다크, 낮은 창)에서 화면을 캡처해 픽셀 비교했을 때 차이가 없었습니다.

## 무엇이 바뀌었나
| 파일 | 내용 |
|---|---|
| `src/js/mediapipe.js` | MediaPipe 를 앱에 내장된 로컬 파일에서 먼저 불러옴(오프라인 동작). 로컬에 없으면 CDN 으로 대체 |
| `index.html` | CDN 스크립트 제거, 노치 대응 viewport, 카메라 전환 버튼 |
| `src/css/style.css` | 모바일 레이아웃(영상 2열, 칩 가로 스크롤, 큰 터치 버튼, 안전 영역), 가로 모드 레이아웃, 빈 칸 안내, 다크모드 컨트롤 |
| `src/js/ui.js` | 캔버스를 매 프레임 새로 만들던 부분 수정(발열/버벅임 방지), 선택된 칩 자동 스크롤 |
| `src/js/camera.js`, `src/app.js` | 전면/후면 카메라 전환, 모바일에서 영상 칸 자동 맞춤·빈 칸 처리, 피드백 카드 높이에 맞춘 하단 여백 |
| `scripts/*`, `package.json`, `capacitor.config.json` | 빌드/설정 |

기준 JSON 을 만든 환경과 같도록 MediaPipe 는 **0.5.1675469404 / modelComplexity 2** 를 그대로 유지했습니다. 버전을 올리면 기준값과 비교가 어긋날 수 있습니다.

## 웹(Cloudflare Workers)으로 배포

### 방법 A. 깃 연결 (푸시하면 자동 배포)
1. GitHub 에 저장소를 만들고 이 폴더를 올립니다. (영상 권리가 정리되기 전에는 **비공개(private)** 저장소 권장)
2. Cloudflare 대시보드 → Workers & Pages → `golf-swing-analyzer` Worker → Settings → Builds → Connect
3. 저장소와 브랜치(`main`)를 고르고 아래처럼 설정
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy` (기본값)
   - 프로젝트가 저장소 루트가 아니면 Advanced 의 Path 에 폴더 지정
4. 커밋을 푸시하면 빌드 → 배포가 자동으로 실행됩니다. 진행 상황은 Deployments 탭의 build history 에서 확인.

`package-lock.json` 은 지우지 말고 함께 커밋하세요. `.node-version`(22)은 빌드 서버의 Node 버전을 맞추기 위한 파일입니다.

### 25 MiB 제한 (Cloudflare Workers)
Workers 는 정적 파일 하나당 25 MiB 까지만 올릴 수 있는데, MediaPipe 모델 `pose_landmark_heavy.tflite` 는 26.4 MiB 라 한도를 넘습니다.
그래서 **웹 빌드(`npm run build`)는 25 MiB 를 넘는 파일을 `www/` 에서 빼고**, 실행 시 그 파일만 CDN(jsDelivr)에서 받습니다
(어떤 파일인지는 빌드가 만드는 `vendor/mediapipe-pose/local-files.json` 에 적힘). 나머지 MediaPipe 파일은 그대로 내장됩니다.
**앱 빌드(`npm run sync` / `ios` / `android`)는 `build:native` 를 써서 전부 내장**하므로 오프라인에서도 동작합니다.
Cloudflare 의 Build command 는 그대로 `npm run build` 입니다.

### 방법 B. 터미널에서 직접 배포
    npm install
    npx wrangler login
    npm run deploy

- `wrangler.jsonc` 의 `name` 이 기존 Worker 이름(`golf-swing-analyzer`)과 같아서 기존 주소가 새 버전으로 교체됩니다.
- 폰에서 안 바뀌어 보이면 캐시 때문일 수 있으니 새로고침(또는 시크릿 탭)으로 확인하세요.

## 웹 버전(Workers)도 같이 쓸 때
`npm run build` 가 프로젝트 루트에 `vendor/mediapipe-pose/` 도 만듭니다. 웹에 이 폴더를 같이 배포하면 CDN 없이 동작하고, 배포하지 않아도 CDN 으로 대체되어 동작합니다.

## 앱 용량 줄이기
`npm run build:slim` 은 MediaPipe 의 lite/full 모델 파일을 뺍니다(이 앱은 heavy 모델만 사용). 빼도 되는지 실기기에서 분석이 되는지 확인한 뒤 쓰세요.

## 실기기에서 꼭 확인할 것
1. 첫 분석이 끝까지 되는지 (MediaPipe WASM 로딩 — iOS WebView 에서 가장 문제가 잘 나는 곳)
2. 라이브 카메라 켜기 → 녹화 → 자동 분석
3. "내 영상 선택" 으로 앨범 영상 불러오기 (4K/60fps 영상은 분석이 느리거나 메모리가 부족할 수 있음)
4. 분석 중 화면이 꺼지거나 앱을 내리면 중단될 수 있음
5. Android 에서 상태바/제스처바와 화면이 겹치지 않는지

## 스토어 출시 전
- 앱 아이콘/스플래시: `@capacitor/assets` 로 생성
- 앱 이름: `capacitor.config.json` 의 `appName`

## 모바일에서 레이아웃이 기대와 다를 때 (진단)
주소 끝에 `?debug=1` 을 붙여 접속하면 화면 왼쪽 아래에 창 크기, 화면 방향, pointer/hover 값, 모바일/가로 모드 적용 여부가 표시됩니다.
(예: `https://…workers.dev/?debug=1`) 폰을 가로로 돌린 뒤 캡처하면 가로 모드가 왜 안 켜지는지 바로 알 수 있습니다. 평소에는 아무 영향이 없습니다.
카카오톡 등 **앱 안의 브라우저는 화면 회전이 잠겨 있는 경우**가 있으니, 가로 모드는 Safari/Chrome 에서 직접 열어 확인하세요.
