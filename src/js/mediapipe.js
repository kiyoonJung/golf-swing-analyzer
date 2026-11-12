/**
 * mediapipe.js
 * MediaPipe Pose 초기화 + 영상 전체에서 프레임별 2D 랜드마크 추출
 */

const MP_VERSION = '0.5.1675469404';

// MediaPipe 파일 위치. 앱(Capacitor)에서는 번들에 넣은 로컬 파일을 먼저 쓰고(오프라인 동작),
// 로컬에 없으면(웹 개발 중 npm run build 를 안 한 경우 등) CDN 으로 대체한다.
// 로컬 파일은 `npm run build` 가 node_modules/@mediapipe/pose 에서 vendor/mediapipe-pose 로 복사한다.
const LOCAL_BASE = new URL('vendor/mediapipe-pose', document.baseURI).href;
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${MP_VERSION}`;
let mpBase = null;   // 실제로 불러온 위치
// 웹 배포(Cloudflare Workers)는 파일 하나당 25 MiB 제한이 있어서, 그보다 큰 파일(pose_landmark_heavy.tflite 26.4 MiB)은
// 빌드 때 www 에서 빼고 CDN 에서 받는다. 어떤 파일이 그런지는 빌드가 만드는 local-files.json 의 remote 목록에 적혀 있다.
// 앱(Capacitor) 빌드는 제한이 없어서 remote 가 비어 있고 전부 내장 파일을 쓴다.
let remoteFiles = new Set();
let pose = null;
let pendingResolve = null; // 현재 처리 중인 프레임의 결과를 돌려줄 resolver

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.crossOrigin = 'anonymous';
    el.onload = resolve; el.onerror = () => reject(new Error(src));
    document.head.appendChild(el);
  });
}

/** pose.js 를 로컬 → CDN 순서로 불러온다 (성공하면 window.Pose 가 생김) */
async function loadPoseLibrary() {
  if (window.Pose && mpBase) return;
  for (const base of [LOCAL_BASE, CDN_BASE]) {
    // 서버가 없는 파일에 index.html 을 200 으로 돌려주는 경우도 있어서, 불러온 뒤 window.Pose 가 생겼는지로 판단
    try { await loadScript(`${base}/pose.js`); } catch { continue; }
    if (window.Pose) {
      mpBase = base;
      if (base === LOCAL_BASE) {
        try {
          const res = await fetch(`${LOCAL_BASE}/local-files.json`, { cache: 'no-cache' });
          const info = res.ok ? await res.json() : null;
          if (Array.isArray(info?.remote)) remoteFiles = new Set(info.remote);
        } catch { /* 목록이 없으면(개발 서버 등) 전부 로컬 파일을 쓴다 */ }
      }
      return;
    }
  }
  throw new Error('MediaPipe Pose 를 불러오지 못했습니다. (앱: npm run build 로 vendor 폴더가 만들어졌는지 확인 / 웹: 네트워크 확인)');
}

/** Pose 인스턴스를 한 번만 생성/초기화 */
export async function initPose() {
  if (pose) return pose;
  await loadPoseLibrary();

  pose = new window.Pose({
<<<<<<< HEAD:swing-fixer/src/js/mediapipe.js
    locateFile: (f) => `${remoteFiles.has(f) ? CDN_BASE : mpBase}/${f}`,
=======
    locateFile: (f) => `${mpBase}/${f}`,
>>>>>>> parent of b970424 (20261111 - 11주차 모바일 화면 편의 패치.1 서버 패치):src/js/mediapipe.js
  });
  pose.setOptions({
    modelComplexity: 2,       // 가장 정확한 모델 (tools/extract_reference.py 와 동일해야 기준값과 비교가 맞음)
    smoothLandmarks: false,   // 프레임을 건너뛰며 탐색하므로 시간 평활화 비활성화
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  pose.onResults((r) => pendingResolve?.(r.poseLandmarks || null));
  await pose.initialize();
  return pose;
}

/** 현재 <video> 프레임 1장에서 랜드마크 검출 (정규화 좌표 0~1) */
function detectFrame(video) {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    pose.send({ image: video });
  });
}

/** 지정 시간으로 이동하고 'seeked' 이벤트까지 대기 */
function seekTo(video, t) {
  return new Promise((resolve) => {
    // 이미 그 시각이면 'seeked' 이벤트가 오지 않으므로 바로 끝냄
    if (Math.abs(video.currentTime - t) < 1e-3) return resolve();
    const done = () => { clearTimeout(timer); video.onseeked = null; resolve(); };
    const timer = setTimeout(done, 3000); // 이벤트가 안 와도 멈춰 있지 않도록 안전장치
    video.onseeked = done;
    video.currentTime = t;
  });
}

/** MediaRecorder(webm)는 duration 이 Infinity 인 경우가 있어 보정 */
async function fixInfiniteDuration(video) {
  if (video.duration !== Infinity) return;
  await seekTo(video, 1e6);
  await seekTo(video, 0);
}

/**
 * 영상 전체를 일정 간격으로 탐색하며 랜드마크 추출
 * @returns {Promise<Array<{t:number, lm:Array}>>} 시간(t)과 33개 랜드마크 배열.
 *          배열에 step(실제 분석 간격, 초) 속성이 붙어 있다 (미세 조정 패널이 1칸의 시간을 표시할 때 사용)
 */
export async function extractLandmarks(video, { maxFrames = 450, onProgress, redetect = false } = {}) {
  // redetect=true: 프레임마다 추적 상태를 지우고 사람을 처음부터 다시 찾음 (진단용, 이전 프레임 오류가 이어지는지 확인)
  await initPose();
  pose.reset?.(); // 이전 영상의 추적 상태를 지우고 새로 시작
  video.pause();
  await fixInfiniteDuration(video);

  const duration = video.duration;
  // 기본은 30fps(약 0.033초) 간격으로 촘촘히 분석. 긴 영상(15초 초과)만 maxFrames 한도에 맞춰 간격 확대
  // (간격이 넓어지면 미세 조정 패널이 "1칸 = 0.05초"처럼 실제 간격을 알려 줌)
  const step = Math.max(1 / 30, duration / maxFrames);
  const frames = [];

  for (let k = 0; ; k++) {
    // 프레임 경계가 아니라 "프레임 중간 시각"으로 이동해야 부동소수점 오차로 이전 프레임이 잡히는 일이 없음
    const t = (k + 0.5) * step;
    if (t >= duration) break;
    await seekTo(video, t);
    if (redetect) pose.reset?.();
    const lm = await detectFrame(video);
    if (lm) frames.push({ t, lm });
    onProgress?.(t / duration);
  }
  await seekTo(video, 0);
  frames.step = step;
  return frames;
}

/** 영상의 특정 시각 한 장면에서 랜드마크 검출 (프로 영상의 단계별 자세를 그릴 때 사용) */
export async function detectAtTime(video, t) {
  await initPose();
  pose.reset?.();
  video.pause();
  await seekTo(video, t);
  return detectFrame(video);
}
