/**
 * app.js
 * 메인 진입점: 각 모듈(camera / mediapipe / analyzer / ui)을 연결한다.
 * 프로 영상은 브라우저에서 분석하지 않고, Python으로 미리 만든
 * assets/reference_{클럽}_{front|side}.json (단계별 기준 각도)을 불러와 비교한다.
 * 클럽별 설정(단계, 허용 오차, 조언 문구)은 src/js/clubs/ 의 프로필에서 가져온다.
 */
import { startCamera, stopCamera, startRecording, stopRecording, toObjectUrl, loadVideo } from './js/camera.js';
import { extractLandmarks, detectAtTime } from './js/mediapipe.js';
import { annotateFrames, compareSwings, buildStage, adjustRange, cleanupPose, addHeadDiffs } from './js/analyzer.js';
import { CLUBS, DEFAULT_CLUB } from './js/clubs/index.js';
import { setStatus, renderChips, setActiveChip, showFeedback, startOverlayLoop, fitStageToVideo,
  bindAdjuster, showAdjuster, hideAdjuster, startProOverlayLoop } from './js/ui.js';
import { createPlayer } from './js/player.js';

const $ = (id) => document.getElementById(id);
const proVideo = $('proVideo');
const userVideo = $('userVideo');

// ===== 모바일 전용 동작 (style.css 의 '모바일 레이아웃'과 같은 기준) =====
// 세로 폰(폭 640px 이하) + 가로 폰(높이 500px 이하 + 터치). 데스크톱은 기존 동작을 그대로 둔다.
const mobileMQ = window.matchMedia('(max-width: 640px), (max-height: 500px) and (pointer: coarse)');
const proStage = $('proStage');
const userStage = $('userStage');

// 영상 칸을 영상 원본 비율(가로/세로/정사각형)에 자동으로 맞춤 → 위아래/좌우 검은 여백이 생기지 않음.
// 파일 업로드·프로 영상 교체는 기존 코드(setUserVideo 등)가 이미 처리하고,
// 여기서는 라이브 카메라 켜기·전면/후면 전환처럼 영상 크기가 나중에 정해지거나 바뀌는 경우를 모바일에서 보완한다.
// (fitStageToVideo 는 칸 비율과 함께 CSS 변수 --ar 도 넣어서, CSS 가 '화면 높이를 넘지 않는 폭'을 계산하게 함)

/** 내 영상 칸 정리: 영상이 아직 없으면 프로 영상 칸과 같은 모양의 안내 칸(.empty)으로, 있으면 영상 비율에 맞춤 */
function syncUserStage() {
  if (!mobileMQ.matches) return;                 // 데스크톱은 건드리지 않음
  const empty = !userVideo.videoWidth;
  userStage.classList.toggle('empty', empty);
  if (empty) {
    // 영상이 없는 동안 큰 검은 상자가 보이지 않도록, 프로 영상 칸과 같은 크기로 맞춤 (프로 영상이 아직 없으면 기본 비율)
    const ar = proStage.style.getPropertyValue('--ar');
    if (ar) { userStage.style.setProperty('--ar', ar); userStage.style.aspectRatio = proStage.style.aspectRatio; }
  } else {
    fitStageToVideo(userVideo);
  }
}

proVideo.addEventListener('loadedmetadata', () => { if (mobileMQ.matches) { fitStageToVideo(proVideo); syncUserStage(); } });
proVideo.addEventListener('resize', () => { if (mobileMQ.matches) { fitStageToVideo(proVideo); syncUserStage(); } });
// 'resize' = <video> 의 videoWidth/Height 가 바뀔 때(카메라 전환 등), 'emptied' = 영상/카메라가 해제될 때
for (const ev of ['loadedmetadata', 'resize', 'emptied']) userVideo.addEventListener(ev, syncUserStage);

// 폰을 돌리거나 창 크기가 바뀌어 모바일 ↔ 데스크톱 기준이 바뀔 때
mobileMQ.addEventListener('change', () => {
  if (mobileMQ.matches) {
    if (proVideo.videoWidth) fitStageToVideo(proVideo);
    syncUserStage();
  } else if (!userVideo.videoWidth) {
    // 데스크톱으로 돌아가면 빈 칸의 모바일용 비율을 지워 원래 기본 비율(9:16)로
    userStage.classList.remove('empty');
    userStage.style.removeProperty('aspect-ratio'); userStage.style.removeProperty('--ar');
  }
});
syncUserStage();
const guideImg = $('guideImg');

// ===== 앱 상태 =====
const state = {
  club: DEFAULT_CLUB, // 'driver' | 'iron' ... (src/js/clubs/index.js 에 등록된 id)
  view: 'front',     // 'front' | 'side'
  input: 'file',     // 'file' | 'live'
  facing: 'user',    // 라이브 카메라 방향: 'user'(전면) | 'environment'(후면)
  reference: null,   // 기준 JSON (단계별 기준 각도 + 프로 영상 시각)
  userFrames: null,
  stages: null,      // 단계별 비교 결과 (미세 조정하면 해당 단계가 갱신됨)
  sampleStep: 1 / 30, // 사용자 영상 분석 간격(초). 긴 영상은 1/30초보다 넓어질 수 있음
  aspect: 1,          // 사용자 영상 가로/세로 (미세 조정 시 머리 비교 재계산용)
  showSkel: { pro: true, user: true }, // 스켈레톤 표시 여부 (영상별 켜기/끄기 버튼)
  atStage: false,     // 단계 버튼으로 이동해 멈춘 상태인지 (동기화 재생을 어드레스부터 시작할지 판단)
  aiIdx: [],         // AI가 처음 찾은 단계별 프레임 번호 (되돌리기/조정 범위 기준)
  selected: 0,       // 현재 선택된 단계 번호
  proLms: [],        // 프로 스켈레톤 표시용 단계별 랜드마크
  userReady: false,
  busy: false,
};

const currentClub = () => CLUBS[state.club]; // 현재 선택된 클럽 프로필

// ===== 영상 재생 컨트롤 (영상별 재생·배속·탐색, 개별/동기화 모드) =====
// 배속은 실제 속도 기준: 프로 영상은 클럽 프로필의 proSlowmo 만큼 빠르게 재생해야 1x = 실제 속도
// 동기화 기준점: 분석으로 찾은 단계별 (사용자 시각, 프로 시각) 쌍
const player = createPlayer({
  proVideo, userVideo, proCtl: $('proCtl'), userCtl: $('userCtl'), modeSeg: $('modeSeg'),
  getSlowmo: () => currentClub().proSlowmo?.[state.view] ?? 1,
  getKnots: () => (state.stages ?? []).map((st) => ({ u: st.userT, p: proSeekTime(st.proT) })),
  // 동기화 재생은 어드레스에서 함께 출발하는 템포 비교용 → 모드를 바꾸면 두 영상을 어드레스로 이동
  onSyncMode: () => { if (state.stages) selectStage(addressIndex()); },
  // 단계 버튼으로 특정 자세를 보던 중이면 재생을 어드레스부터 다시 시작 (재생 중 일시정지 후 재개는 그 자리에서 이어감)
  beforeSyncPlay: () => { if (state.stages && state.atStage) selectStage(addressIndex()); },
});
const addressIndex = () => Math.max(0, (state.stages ?? []).findIndex((st) => st.name === '어드레스'));
// 재생이 시작되면 "단계 버튼으로 이동한 상태"가 풀림
userVideo.addEventListener('play', () => { state.atStage = false; });

// ===== 진단 모드 (주소 뒤에 붙여서 사용) =====
//  ?debug=1             분석이 끝나면 프레임별 랜드마크를 pose_debug_track.json 으로 내려받음
//  ?debug=1&redetect=1  프레임마다 사람을 새로 찾는 방식으로 분석 → pose_debug_redetect.json
// 두 파일을 비교하면 "앞 프레임의 추적 오류가 이어지는 문제"인지 "그 장면 자체를 못 읽는 문제"인지 구분할 수 있다.
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const REDETECT = params.get('redetect') === '1';

/** 진단용: 영상 정보 + 프레임별 33개 관절 [x, y, visibility] 를 JSON 파일로 저장 */
function downloadDebug(raw, video) {
  const data = {
    mode: REDETECT ? 'redetect' : 'track',
    video: { width: video.videoWidth, height: video.videoHeight, duration: video.duration },
    step: raw.step,
    frames: raw.map((f) => ({ t: +f.t.toFixed(4), lm: f.lm.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +(p.visibility ?? 1).toFixed(3)]) })),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `pose_debug_${data.mode}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * 프로 영상을 통째로 내려받아 메모리(blob)에서 재생한다.
 * python -m http.server 는 영상의 중간 구간 요청(Range)을 지원하지 않아,
 * URL 로 바로 재생하면 브라우저가 특정 시각으로 이동하지 못하는 경우가 있다.
 */
let proBlobUrl = null;
async function loadProVideoFile(url, token) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('프로 영상을 찾지 못했습니다: ' + url);
  const blob = await res.blob();
  if (token !== loadToken) return; // 그 사이 클럽/시점이 바뀌었으면 옛 영상은 버림
  const blobUrl = URL.createObjectURL(blob);
  if (proBlobUrl) URL.revokeObjectURL(proBlobUrl);
  proBlobUrl = blobUrl;
  await loadVideo(proVideo, proBlobUrl);
  fitStageToVideo(proVideo);
  player.setReady('pro', true);
}

/**
 * 프로 영상을 단계 시각으로 이동할 때 쓰는 시각. 프레임 경계가 아니라 "프레임 중간"으로 가야
 * 부동소수점 오차로 바로 앞 프레임이 보이는 일이 없다 (임팩트처럼 빠른 구간에서 특히 중요).
 */
const proSeekTime = (t) => t + 0.5 / (state.reference?.fps || 30);

/** 프로 스켈레톤용 단계별 랜드마크 준비. 기준 파일에 없으면(구버전) 프로 영상에서 직접 검출 */
async function loadProLandmarks() {
  const out = [];
  for (const st of state.reference.stages) {
    if (Array.isArray(st.landmarks)) {
      out.push(st.landmarks.map(([x, y, visibility]) => ({ x, y, visibility })));
    } else if (proVideo.videoWidth) {
      try { out.push(await detectAtTime(proVideo, proSeekTime(st.time))); } catch { out.push(null); }
    } else out.push(null);
  }
  return out;
}
// ===== 프로 영상 + 기준 JSON + 가이드 이미지 로딩 =====
// 클럽/시점 버튼을 빠르게 연달아 누르면 로딩이 겹친다. 호출마다 번호를 매기고,
// 늦게 도착한 옛 응답(번호가 최신이 아님)은 버려서 현재 선택과 다른 기준이 쓰이지 않게 한다.
let loadToken = 0;
async function loadProReference() {
  const token = ++loadToken;
  const { club, view } = state;
  state.reference = null; state.stages = null; state.userFrames = null;
  $('chips').innerHTML = ''; $('analyzeBtn').disabled = true;
  hideAdjuster();
  player.setReady('pro', false); player.pauseAll();

  // 프로 영상은 화면 비교용으로만 재생 (실패해도 분석은 가능)
  state.proLms = [];
  loadProVideoFile(`assets/${club}_pro_${view}.mp4`, token).catch(() => {});

  try {
    const res = await fetch(`assets/reference_${club}_${view}.json`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (token !== loadToken) return; // 옛 요청 → 무시
    state.reference = data;
    setStatus('기준 데이터 로딩 완료. 내 영상을 올리거나 카메라로 촬영하세요.');
    if (state.userReady) $('analyzeBtn').disabled = false;
  } catch {
    if (token !== loadToken) return;
    setStatus(`기준 데이터(assets/reference_${club}_${view}.json)가 없습니다. 먼저 tools/extract_reference.py 를 --club ${club} --view ${view} 로 실행하세요. (README 참고)`);
  }

  // 라이브 모드에서만 반투명 가이드 표시, 이미지가 없으면 숨김
  guideImg.onload = () => { guideImg.hidden = state.input !== 'live'; };
  guideImg.onerror = () => { guideImg.hidden = true; };
  guideImg.src = `assets/${state.club}_guide_${state.view}.png`;
}

// ===== 사용자 영상 지정 =====
async function setUserVideo(url) {
  state.stages = null; state.userFrames = null; state.userReady = false;
  $('chips').innerHTML = '';
  hideAdjuster();
  player.setReady('user', false);
  await loadVideo(userVideo, url);
  fitStageToVideo(userVideo);
  state.userReady = true;
  player.setReady('user', true);
  $('analyzeBtn').disabled = !state.reference;
  if (state.reference) setStatus('영상 준비 완료. "분석하기"를 누르세요.');
}

// ===== 분석 파이프라인 =====
async function runAnalysis() {
  if (state.busy || !state.userReady || !state.reference) return;
  state.busy = true; $('analyzeBtn').disabled = true;
  player.lock(true); // 분석 중에는 영상을 앞뒤로 옮기며 읽으므로 재생 조작 잠금
  const ref = state.reference; // 분석 도중 클럽/시점이 바뀌어도 이 기준으로 끝까지 계산
  const stale = () => ref !== state.reference; // 바뀌었으면 결과를 화면에 내지 않음
  try {
    const aspect = userVideo.videoWidth / userVideo.videoHeight; // 각도 왜곡 보정용
    const raw = await extractLandmarks(userVideo, {
      onProgress: (p) => setStatus(`내 영상 분석 중${REDETECT ? '(매 프레임 새로 찾기)' : ''}… ${Math.round(p * 100)}%`),
      redetect: REDETECT,
    });
    if (DEBUG) downloadDebug(raw, userVideo);
    if (stale()) return setStatus('분석 중에 클럽/시점이 바뀌었습니다. "분석하기"를 다시 눌러 주세요.');
    state.sampleStep = raw.step; // 분석 간격(초). 미세 조정 버튼 1칸의 실제 시간
    // MediaPipe 오인식 보정 (좌우 뒤집힘, 하체 순간 튐) 후 각도 계산
    const clean = cleanupPose(raw, aspect);
    state.userFrames = annotateFrames(clean.frames, aspect);
    state.stages = compareSwings(ref, state.userFrames, aspect, currentClub(), ref.view ?? state.view);
    state.aspect = aspect;
    addHeadDiffs(ref, state.userFrames, state.stages, aspect, currentClub().headStages); // 머리 위치 비교
    state.aiIdx = state.stages.map((st) => st.frameIdx);
    setStatus('프로 자세 준비 중…');
    const proLms = await loadProLandmarks();
    if (stale()) { state.stages = null; return setStatus('분석 중에 클럽/시점이 바뀌었습니다. "분석하기"를 다시 눌러 주세요.'); }
    state.proLms = proLms;
    renderChips(state.stages, selectStage, currentClub().threshold);
    // 처음 보여줄 단계: 클럽 프로필의 defaultStage(백스윙 탑). 기준 파일에 없으면 두 번째 단계
    const first = state.stages.findIndex((st) => st.name === currentClub().defaultStage);
    selectStage(first >= 0 ? first : Math.min(1, state.stages.length - 1));
    const worst = Math.max(...state.stages.map((st) => st.matchDist ?? 0));
    // 진단용: 단계별로 찾은 시각(기준 시각). 기준 영상을 그대로 올린 테스트에서는 두 값이 거의 같아야 함
    const detail = state.stages
      .map((st, i) => `${st.name} ${st.userT.toFixed(2)}s(기준 ${state.reference.stages[i].time.toFixed(2)}s)`)
      .join(' · ');
    const fixes = clean.flipped.length || clean.spikes
      ? `  [인식 보정: 좌우 뒤집힘 ${clean.flipped.length}프레임, 하체 튐 ${clean.spikes}곳]` : '';
    setStatus((worst > 0.5
      ? '분석 완료. 다만 일부 단계에서 기준과 비슷한 자세를 찾지 못했어요. 전신이 나오는지, 프로와 같은 방향에서 찍었는지 확인하세요.'
      : '분석 완료. 단계 버튼을 눌러 프로와 비교해 보세요.') + `  [찾은 시각(기준 시각): ${detail}]` + fixes);
  } catch (e) {
    setStatus('분석 실패: ' + e.message);
  } finally {
    state.busy = false; $('analyzeBtn').disabled = false;
    player.lock(false);
  }
}

/** 단계 선택: 두 영상을 해당 키 프레임으로 이동하고 피드백/미세 조정 패널 표시 */
function selectStage(i) {
  state.selected = i;
  state.atStage = true; // 단계 버튼(또는 미세 조정)으로 이 단계 장면에 멈춘 상태
  const st = state.stages[i];
  proVideo.pause(); userVideo.pause();
  proVideo.currentTime = proSeekTime(st.proT);
  userVideo.currentTime = st.userT;
  setActiveChip(i);
  showFeedback(st, state.view, currentClub());
  showAdjuster(st, adjustRange(state.stages, state.aiIdx, i, state.userFrames.length), state.aiIdx[i], state.sampleStep);
}

/** 미세 조정: 선택된 단계를 다른 프레임으로 옮기고 오차/피드백을 다시 계산 */
function moveStage(frameIdx) {
  const i = state.selected;
  const { min, max } = adjustRange(state.stages, state.aiIdx, i, state.userFrames.length);
  const idx = Math.min(max, Math.max(min, frameIdx));
  state.stages[i] = buildStage(state.reference.stages[i], state.userFrames, idx, state.reference.view ?? state.view);
  addHeadDiffs(state.reference, state.userFrames, state.stages, state.aspect, currentClub().headStages); // 어드레스가 바뀌면 다른 단계 머리 값도 바뀌므로 전체 재계산
  renderChips(state.stages, selectStage, currentClub().threshold); // 오차 유무에 따라 칩 색 갱신
  selectStage(i);
}
bindAdjuster({
  onSlide: (idx) => moveStage(idx),
  onStep: (d) => moveStage(state.stages[state.selected].frameIdx + d),
  onReset: () => moveStage(state.aiIdx[state.selected]),
});

// ===== 이벤트 연결 =====
// 클럽 선택 버튼은 등록된 프로필(CLUBS)에서 자동으로 만든다
$('clubSeg').innerHTML = Object.values(CLUBS)
  .map((c) => `<button data-club="${c.id}" class="${c.id === state.club ? 'on' : ''}">${c.label}</button>`).join('');
/** 시점 버튼 글자를 현재 클럽 이름에 맞춤 (예: "아이언 정면") */
const VIEW_KR = { front: '정면', side: '측면' };
function updateViewLabels() {
  [...$('viewSeg').children].forEach((b) => { b.textContent = `${currentClub().label} ${VIEW_KR[b.dataset.view]}`; });
}
updateViewLabels();

$('clubSeg').onclick = (e) => {
  const id = e.target.dataset.club; if (!id || id === state.club) return;
  state.club = id;
  [...$('clubSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.club === id));
  updateViewLabels();
  loadProReference();
};

$('viewSeg').onclick = (e) => {
  const v = e.target.dataset.view; if (!v || v === state.view) return;
  state.view = v;
  [...$('viewSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  loadProReference();
};

$('inputSeg').onclick = (e) => {
  const mode = e.target.dataset.input; if (!mode) return;
  state.input = mode;
  [...$('inputSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.input === mode));
  $('filePanel').hidden = mode !== 'file';
  $('livePanel').hidden = mode !== 'live';
  guideImg.hidden = mode !== 'live' || !guideImg.naturalWidth;
  if (mode === 'file') { stopCamera(userVideo); $('flipBtn').disabled = true; }
};

$('userFile').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try { await setUserVideo(toObjectUrl(file)); } catch (err) { setStatus(err.message); }
};

$('camBtn').onclick = async () => {
  try {
    player.setReady('user', false); // 카메라 화면은 재생 컨트롤 대상이 아님
    await startCamera(userVideo, state.facing);
    $('startRecBtn').disabled = false;
    $('flipBtn').disabled = false;
    setStatus('가이드 이미지에 맞춰 자세를 잡고 녹화를 시작하세요.');
  } catch (err) { setStatus('카메라 접근 실패: ' + err.message); }
};

// 전면/후면 카메라 전환 (녹화 중에는 막음)
$('flipBtn').onclick = async () => {
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  try {
    await startCamera(userVideo, state.facing);
    setStatus(state.facing === 'user' ? '전면 카메라로 전환했어요.' : '후면 카메라로 전환했어요.');
  } catch (err) { setStatus('카메라 전환 실패: ' + err.message); }
};

$('startRecBtn').onclick = () => {
  try {
    startRecording();
    $('startRecBtn').disabled = true; $('stopRecBtn').disabled = false; $('flipBtn').disabled = true;
    setStatus('녹화 중…');
  } catch (err) { setStatus(err.message); }
};

$('stopRecBtn').onclick = async () => {
  $('stopRecBtn').disabled = true; $('flipBtn').disabled = true;
  try {
    const blob = await stopRecording();
    stopCamera(userVideo);
    guideImg.hidden = true;
    await setUserVideo(toObjectUrl(blob));
    runAnalysis(); // 녹화 종료 즉시 비교 엔진으로 전달
  } catch (err) { setStatus(err.message); }
};

$('analyzeBtn').onclick = runAnalysis;


// 오버레이 렌더 루프 시작 (재생 중 가까운 단계로 피드백 자동 갱신)
startOverlayLoop(
  $('overlay'), userVideo,
  () => ({ frames: state.userFrames, stages: state.stages, threshold: currentClub().threshold, view: state.view, show: state.showSkel.user }),
  (i) => { setActiveChip(i); showFeedback(state.stages[i], state.view, currentClub()); },
);

// 피드백 카드는 영상이 재생 중일 때(개별·동기화 모두) 숨기고, 두 영상이 모두 멈추면 다시 보임
// (재생 중에는 화면을 가리지 않고 영상 비교에 집중. 멈추면 그 시점 단계의 피드백이 보임)
const updateCard = () => { $('feedbackCard').hidden = !(proVideo.paused && userVideo.paused); };
for (const v of [proVideo, userVideo]) for (const ev of ['play', 'pause', 'ended']) v.addEventListener(ev, updateCard);

// 프로 영상 위에 기준 자세 스켈레톤 표시. 저장된 "단계별 자세"라서, 영상이 그 단계 시각에 멈춰 있을 때만 그린다
// (예전엔 멈춰 있기만 하면 선택된 단계 자세를 그려, 동기화 재생이 끝난 피니시 화면에 탑 자세가 겹치는 문제가 있었음)
startProOverlayLoop($('proOverlay'), proVideo, () => {
  if (!state.stages || !state.showSkel.pro) return null;
  const tol = 1 / (state.reference?.fps || 30); // 1프레임 이내면 같은 장면
  const i = state.stages.findIndex((st) => Math.abs(proVideo.currentTime - proSeekTime(st.proT)) < tol);
  const lm = i >= 0 && state.proLms[i];
  return lm ? { lm, stage: state.stages[i], threshold: currentClub().threshold, view: state.view } : null;
});

// 스켈레톤 켜기/끄기 (영상마다 따로)
for (const who of ['pro', 'user']) {
  const btn = document.querySelector(`#${who}Ctl [data-act=skel]`);
  if (!btn) continue; // 예전 index.html
  btn.onclick = () => {
    state.showSkel[who] = !state.showSkel[who];
    btn.classList.toggle('on', state.showSkel[who]);
    btn.setAttribute('aria-pressed', String(state.showSkel[who]));
  };
}

loadProReference().then(() => {
  // index.html 이 예전 버전이면 재생 컨트롤만 꺼진 상태 → 원인과 해결법 안내 (기준 로딩 문구 뒤에 표시)
  if (player.disabled) setStatus('⚠ index.html 이 예전 버전이라 영상 재생 컨트롤이 꺼져 있습니다. '
    + 'index.html 을 최신 버전으로 교체하고 Ctrl+Shift+R 로 새로고침하세요. (분석은 정상 작동)');
});

// 하단 피드백 카드는 화면에 고정(fixed)이라 내용이 길어지면 카드 높이가 변한다.
// 카드 높이를 CSS 변수(--card-h)로 알려 줘서, 카드에 가려지지 않게 페이지 맨 아래 여백을 맞춘다.
new ResizeObserver(() => {
  const card = $('feedbackCard');
  document.documentElement.style.setProperty('--card-h', (card.hidden ? 0 : card.offsetHeight) + 'px');
}).observe($('feedbackCard'));

// 끝까지 실행됐다는 표시 (index.html 의 로딩 실패 안내가 이 값을 확인함)
window.__appStarted = true;
