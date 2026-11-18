// 스윙 분석 전용 빌드 단계. scripts/build-www.mjs 가 이 프로그램을 복사한 뒤 자동 실행한다.
//  1) node_modules/@mediapipe/pose → programs/swing/vendor/mediapipe-pose  (python serve.py 로 단독 실행할 때도 쓰임)
//  2) 같은 파일을 www/programs/swing/vendor/ 로 복사
// 옵션  native: 전부 내장(오프라인) / (기본) 웹·Cloudflare: 25 MiB 초과 파일은 빼고 CDN 에서 받음 / slim: lite·full 모델 제거
import fs from 'node:fs';
import path from 'node:path';
const WORKERS_MAX = 25 * 1024 * 1024; // Cloudflare Workers 정적 파일 1개 최대 크기
export default async function build({ out, base, root, native, slim }) {
  const src = path.join(root, 'node_modules', '@mediapipe', 'pose');
  if (!fs.existsSync(path.join(src, 'pose.js'))) { console.error('✖ node_modules/@mediapipe/pose 가 없습니다. 먼저 `npm install` 을 실행하세요.'); process.exit(1); }
  const dst = path.join(base, 'vendor', 'mediapipe-pose');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true, filter: (s) => !/(\.d\.ts|\.map|package\.json|README\.md)$/i.test(s) });
  if (slim) for (const f of ['pose_landmark_lite.tflite', 'pose_landmark_full.tflite']) fs.rmSync(path.join(dst, f), { force: true });
  if (!fs.existsSync(path.join(dst, 'pose_landmark_heavy.tflite'))) console.warn('⚠ pose_landmark_heavy.tflite 가 없습니다. modelComplexity 2 를 쓰는 이 앱은 이 파일이 꼭 필요합니다. @mediapipe/pose 버전을 확인하세요.');
  const mp = path.join(out, 'vendor', 'mediapipe-pose');
  fs.cpSync(dst, mp, { recursive: true });
  const remote = [];
  if (!native) for (const f of fs.readdirSync(mp)) { const fp = path.join(mp, f); if (fs.statSync(fp).size > WORKERS_MAX) { remote.push(f); fs.rmSync(fp); } }
  fs.writeFileSync(path.join(mp, 'local-files.json'), JSON.stringify({ remote }, null, 2));
  // 앱에 필요 없는 확인용 이미지는 넣지 않는다 (용량 절약)
  const assets = path.join(out, 'assets');
  if (fs.existsSync(assets)) for (const f of fs.readdirSync(assets, { recursive: true })) if (/(contact_sheet_.*\.jpg|README\.txt|_stage\d+\.jpg)$/i.test(f)) fs.rmSync(path.join(assets, f), { force: true });
  console.log(`   스윙 분석: ${native ? '[--native] MediaPipe 전부 내장' : remote.length ? `[웹] 25 MiB 초과 파일은 CDN 에서 받도록 제외: ${remote.join(', ')}` : '[웹] 제외된 파일 없음'}${slim ? '  [--slim]' : ''}`);
}
