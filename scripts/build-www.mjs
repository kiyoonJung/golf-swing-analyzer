/**
 * build-www.mjs  —  앱에 넣을 웹 파일을 www/ 폴더로 모은다. (npm run build)
 *
 *  1) node_modules/@mediapipe/pose  →  vendor/mediapipe-pose   (MediaPipe 를 앱에 내장, 오프라인 동작)
 *  2) index.html, src/, assets/, vendor/  →  www/              (Capacitor 가 읽는 폴더)
 *
 * 앱에 필요 없는 파일(확인용 이미지 contact_sheet_*.jpg, assets/README.txt 등)은 www/ 에 넣지 않는다 → 앱 용량 절약
 * 옵션
 *   (기본)    웹/Cloudflare 배포용. Workers 는 파일 하나당 25 MiB 제한이라, 그보다 큰 파일(pose_landmark_heavy.tflite 26.4 MiB)은
 *             www 에서 빼고 vendor/mediapipe-pose/local-files.json 의 remote 목록에 적는다 → 앱 코드(mediapipe.js)가 그 파일만 CDN 에서 받음
 *   --native  앱(Capacitor)용. 크기 제한이 없으므로 전부 내장 (remote 목록 비어 있음 → 오프라인 동작)
 *   --slim    MediaPipe 의 lite/full 모델 파일 제거 (이 프로젝트는 modelComplexity 2 = heavy 만 사용)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slim = process.argv.includes('--slim');
<<<<<<< HEAD:swing-fixer/scripts/build-www.mjs
const native = process.argv.includes('--native');
const WORKERS_MAX = 25 * 1024 * 1024; // Cloudflare Workers 정적 파일 1개 최대 크기
=======
>>>>>>> parent of b970424 (20261111 - 11주차 모바일 화면 편의 패치.1 서버 패치):scripts/build-www.mjs
const r = (...p) => path.join(root, ...p);
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

function dirSize(dir) {
  let sum = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    sum += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return sum;
}

// 1) MediaPipe → vendor/
const mpSrc = r('node_modules', '@mediapipe', 'pose');
if (!fs.existsSync(path.join(mpSrc, 'pose.js'))) {
  console.error('✖ node_modules/@mediapipe/pose 가 없습니다. 먼저 `npm install` 을 실행하세요.');
  process.exit(1);
}
const mpDst = r('vendor', 'mediapipe-pose');
fs.rmSync(mpDst, { recursive: true, force: true });
fs.cpSync(mpSrc, mpDst, {
  recursive: true,
  filter: (src) => !/(\.d\.ts|\.map|package\.json|README\.md)$/i.test(src),
});
if (slim) {
  for (const f of ['pose_landmark_lite.tflite', 'pose_landmark_full.tflite']) fs.rmSync(path.join(mpDst, f), { force: true });
}
if (!fs.existsSync(path.join(mpDst, 'pose_landmark_heavy.tflite'))) {
  console.warn('⚠ pose_landmark_heavy.tflite 가 없습니다. modelComplexity 2 를 쓰는 이 앱은 이 파일이 꼭 필요합니다. @mediapipe/pose 버전을 확인하세요.');
}

// 2) www/
const www = r('www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
fs.copyFileSync(r('index.html'), path.join(www, 'index.html'));
fs.cpSync(r('src'), path.join(www, 'src'), { recursive: true });
const mpWww = path.join(www, 'vendor', 'mediapipe-pose');
fs.cpSync(mpDst, mpWww, { recursive: true });
// 웹용: 25 MiB 초과 파일은 www 에서 빼고 목록에 기록 / 앱용: 전부 유지
const remote = [];
if (!native) {
  for (const f of fs.readdirSync(mpWww)) {
    const fp = path.join(mpWww, f);
    if (fs.statSync(fp).size > WORKERS_MAX) { remote.push(f); fs.rmSync(fp); }
  }
}
fs.writeFileSync(path.join(mpWww, 'local-files.json'), JSON.stringify({ remote }, null, 2));
fs.cpSync(r('assets'), path.join(www, 'assets'), {
  recursive: true,
  filter: (src) => !/(contact_sheet_.*\.jpg|README\.txt|_stage\d+\.jpg)$/i.test(src),
});

console.log(`✔ www/ 준비 완료 (${mb(dirSize(www))})${slim ? '  [--slim]' : ''}`);
console.log(`   MediaPipe ${mb(dirSize(mpWww))} / 프로 영상·기준값 ${mb(dirSize(path.join(www, 'assets')))}`);
console.log(native ? '   [--native] 모든 MediaPipe 파일 내장 (오프라인 동작)'
  : remote.length ? `   [웹] 25 MiB 초과 파일은 CDN 에서 받도록 제외: ${remote.join(', ')}` : '   [웹] 제외된 파일 없음');
console.log('   다음: npx cap sync   (또는 npm run ios / npm run android)');
