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

## 무엇이 바뀌었나
| 파일 | 내용 |
|---|---|
| `src/js/mediapipe.js` | MediaPipe 를 앱에 내장된 로컬 파일에서 먼저 불러옴(오프라인 동작). 로컬에 없으면 CDN 으로 대체 |
| `index.html` | CDN 스크립트 제거, 노치 대응 viewport, 카메라 전환 버튼 |
| `src/css/style.css` | 모바일 레이아웃(영상 2열, 칩 가로 스크롤, 큰 터치 버튼, 안전 영역), 다크모드 컨트롤 |
| `src/js/ui.js` | 캔버스를 매 프레임 새로 만들던 부분 수정(발열/버벅임 방지), 선택된 칩 자동 스크롤 |
| `src/js/camera.js`, `src/app.js` | 전면/후면 카메라 전환, 피드백 카드 높이에 맞춘 하단 여백 |
| `scripts/*`, `package.json`, `capacitor.config.json` | 빌드/설정 |

기준 JSON 을 만든 환경과 같도록 MediaPipe 는 **0.5.1675469404 / modelComplexity 2** 를 그대로 유지했습니다. 버전을 올리면 기준값과 비교가 어긋날 수 있습니다.

## 웹(Cloudflare Workers)으로 배포
폰 브라우저에서 주소만 열어 쓰는 방식입니다. 앱 빌드 없이 모바일 화면 개선을 바로 확인할 수 있습니다.

    npm install
    npx wrangler login        # 처음 한 번, 브라우저에서 Cloudflare 로그인
    npm run deploy            # MediaPipe 포함 www/ 를 만들고 업로드

- `wrangler.jsonc` 의 `name` 은 테스트용(`golf-swing-analyzer-test`)이라 **기존 주소는 건드리지 않고** 별도 주소가 생깁니다. 확인이 끝난 뒤 기존 주소를 교체하려면 `name` 을 `golf-swing-analyzer` 로 바꾸고 다시 배포하세요.
- 배포 후 폰에서 접속해 안 바뀌어 보이면 브라우저 캐시 때문일 수 있으니 새로고침(또는 시크릿 탭)으로 확인하세요.

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
