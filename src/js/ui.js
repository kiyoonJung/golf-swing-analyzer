/**
 * ui.js
 * 화면 표시 담당: 캔버스 스켈레톤(초록/빨강), 단계 칩, 하단 피드백 카드
 */
import { JOINTS, getOffenders, getGoodJoints, headPoint, HEAD_RATIO } from './analyzer.js';

const $ = (id) => document.getElementById(id);

const JOINT_KR = { shoulder: '어깨', elbow: '팔꿈치', hip: '엉덩이', knee: '무릎' };

export function setStatus(text) { $('status').textContent = text; }

/** 스윙 단계 칩 생성 (오차 있는 단계는 빨간 테두리) */
export function renderChips(stages, onSelect, threshold) {
  const box = $('chips');
  box.innerHTML = '';
  stages.forEach((st, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (getOffenders(st, threshold).length || st.head?.bad ? ' bad' : '');
    b.textContent = st.name;
    b.onclick = () => onSelect(i);
    box.appendChild(b);
  });
}

export function setActiveChip(index) {
  document.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', i === index));
}

/** 하단 피드백 카드 갱신 (club = 클럽 프로필: 허용 오차와 조언 문구를 가짐) */
export function showFeedback(stage, view, club) {
  const card = $('feedbackCard'), text = $('feedbackText');
  const bad = getOffenders(stage, club.threshold);
  const head = stage.head?.bad ? headMessage(stage.head, view, club) : null;
  if (!bad.length && !head) {
    card.className = 'card ok';
    // 적당함: 비교한 부위의 칭찬 문구 (최대 2개). 단계별 문구가 없으면 기본 문구만
    const goods = getGoodJoints(stage, club.threshold)
      .map((j) => club.stageAdvice?.[stage.name]?.[j]?.good).filter(Boolean).slice(0, 2);
    text.innerHTML = `<strong>${stage.name}</strong>: 비교한 부위가 모두 프로와 ±${club.threshold}° 이내예요. 좋은 자세예요!`
      + (goods.length ? '<br>' + goods.join(' ') : '');
    return;
  }
  card.className = 'card bad';
  const lines = bad.slice(0, 2).map((o) => jointMessage(o, stage.name, view, club));
  if (head) lines.unshift(head); // 머리 위치는 각도와 단위가 달라 따로 맨 앞에 표시
  text.innerHTML = `<strong>${stage.name}</strong><br>` + lines.join('<br>');
}

const SIDE_KR = { L: '왼쪽', R: '오른쪽' };
const LEVEL_KR = { over: '과함', under: '부족함' };
// 각도 차이(n°)를 몸의 상태로 바꿔 말하기 (advice_driver.js 머리말의 "각도가 크다/작다의 의미"와 같음)
const JOINT_STATE = {
  shoulder: { over: (n) => `팔이 프로보다 ${n}° 더 몸통에서 들려 있어요.`, under: (n) => `팔이 프로보다 ${n}° 더 몸통에 붙어 있어요.` },
  elbow: { over: (n) => `팔꿈치가 프로보다 ${n}° 더 펴져 있어요.`, under: (n) => `팔꿈치가 프로보다 ${n}° 더 접혀 있어요.` },
  hip: { over: (n) => `상체가 프로보다 ${n}° 더 세워져 있어요.`, under: (n) => `상체가 프로보다 ${n}° 더 숙여져 있어요.` },
  knee: { over: (n) => `무릎이 프로보다 ${n}° 더 펴져 있어요.`, under: (n) => `무릎이 프로보다 ${n}° 더 굽어 있어요.` },
};

/**
 * 부위 하나의 피드백 한 줄: [부위(좌우) 과함/부족함] 상태(수치) + 고치는 법 + 미스샷
 * 단계별 문구(club.stageAdvice)가 없으면 부위별 공통 문구(club.advice[view])로 대체
 */
function jointMessage({ joint, diff, side, level }, stageName, view, club) {
  const entry = club.stageAdvice?.[stageName]?.[joint]?.[level];
  const state = JOINT_STATE[joint]?.[level]?.(diff.toFixed(0)) ?? `오차 ${diff.toFixed(0)}°.`;
  const label = `<strong>${JOINT_KR[joint]}(${SIDE_KR[side] ?? side}) ${LEVEL_KR[level]}</strong>`; // <b> 는 카드 제목 스타일이라 사용 안 함
  if (!entry) return `${label} — ${state} ${club.advice[view][joint] ?? ''}`;
  return `${label} — ${state} ${entry.fix}<br><small>⚠ 이럴 때 나오기 쉬운 미스샷: ${entry.miss}</small>`;
}

/**
 * 머리 위치 피드백 문구. 화면 방향을 골프 방향으로 바꿔 말한다 (오른손잡이, 프로와 같은 방향에서 촬영 기준).
 *  - 정면: 화면 오른쪽 = 타깃 쪽, 아래 = 머리가 내려감
 *  - 측면: 화면 오른쪽 = 공 쪽(앞), 아래 = 머리가 내려감
 * 크기는 "머리 폭(= 몸통 길이 × 0.46)의 몇 배"로 표시.
 */
function headMessage({ ex, ey }, view, club) {
  const X = view === 'side' ? ['공 쪽(앞)으로', '뒤로'] : ['타깃 쪽으로', '타깃 반대쪽으로'];
  const parts = [];
  if (Math.abs(ex) >= Math.abs(ey) * 0.5) parts.push(`${ex > 0 ? X[0] : X[1]} 머리 폭의 ${(Math.abs(ex) / (2 * HEAD_RATIO)).toFixed(1)}배`);
  if (Math.abs(ey) >= Math.abs(ex) * 0.5) parts.push(`${ey > 0 ? '아래로' : '위로'} 머리 폭의 ${(Math.abs(ey) / (2 * HEAD_RATIO)).toFixed(1)}배`);
  // "더 움직였다"가 아니라 "치우쳐 있다": 프로가 움직이고 사용자가 가만히 있어도 차이가 생기기 때문
  return `머리 위치: 어드레스 기준으로 프로보다 ${parts.join(', ')} 치우쳐 있어요. ${club.advice[view].head ?? ''}`;
}

function drawLine(ctx, a, b, color, width) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

/**
 * 머리 원의 중심/반지름(캔버스 픽셀). 중심은 analyzer.js headPoint 와 같은 점이라
 * 화면의 원과 머리 위치 비교(addHeadDiffs)가 항상 일치한다.
 * (headPoint 좌표는 x 에 aspect=W/H 를 곱한 공간이므로 H 를 곱하면 픽셀이 됨)
 * @returns {{x,y,r}|null} 얼굴 점이 하나도 안 보이면 null
 */
function headCircle(lm, W, H) {
  const h = headPoint(lm, W / H);
  if (!h.visible) return null;
  return { x: h.x * H, y: h.y * H, r: Math.max(h.torso * HEAD_RATIO * H, Math.min(W, H) * 0.02) };
}

// ===== 가려진 관절 보정 (화면 표시 전용) =====
// MediaPipe 는 가려진 관절에도 좌표를 주지만 visibility 가 낮고 위치가 크게 틀릴 때가 많다
// (예: 측면 임팩트에서 왼손목이 오른손목과 한참 떨어진 곳에 찍힘).
// 그래서 골프 자세의 규칙으로 위치를 보정해 "점선"으로 그린다.
// ※ 보정한 좌표는 그림에만 쓰고, 각도 비교(analyzer.js)에는 절대 넣지 않는다 → 추측이 오차 판정을 왜곡하지 않음.

const VIS = 0.4; // analyzer.js 와 같은 가시성 기준
// 팔다리: [시작, 가운데(꺾이는 관절), 끝] 과 반대쪽 짝
const LIMBS = {
  armL: { pts: [11, 13, 15], mirror: 'armR' }, armR: { pts: [12, 14, 16], mirror: 'armL' },
  legL: { pts: [23, 25, 27], mirror: 'legR' }, legR: { pts: [24, 26, 28], mirror: 'legL' },
};
// 그릴 뼈대 (몸통 포함)
const BONES = [[11, 12], [23, 24], [11, 23], [12, 24],
  [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];

/** 두 원(중심 A 반지름 r1, 중심 C 반지름 r2)의 교점 중 hint 에 가까운 점 → 꺾이는 관절(팔꿈치/무릎) 위치 */
function bendPoint(A, C, r1, r2, hint) {
  const dx = C.x - A.x, dy = C.y - A.y, d = Math.hypot(dx, dy);
  if (d < 1e-6 || d <= Math.abs(r1 - r2)) return hint;                       // 계산 불가 → 추정값 유지
  if (d >= r1 + r2) return { x: A.x + dx * r1 / (r1 + r2), y: A.y + dy * r1 / (r1 + r2) }; // 쭉 펴진 상태
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = A.x + dx * a / d, my = A.y + dy * a / d;
  const p1 = { x: mx - dy * h / d, y: my + dx * h / d }, p2 = { x: mx + dy * h / d, y: my - dx * h / d };
  const dist = (p) => Math.hypot(p.x - hint.x, p.y - hint.y);
  return dist(p1) <= dist(p2) ? p1 : p2;                                       // 꺾이는 방향은 MediaPipe 추정 쪽
}

/**
 * 가려진 관절을 보정한 좌표(캔버스 픽셀)와 "추정한 관절" 목록을 돌려준다.
 *  1) 손목: 한쪽만 가려졌으면 보이는 손목 위치로 (두 손이 그립을 함께 잡고 있으므로)
 *  2) 팔꿈치: 반대쪽 팔 마디 길이 / 무릎: 반대쪽 다리의 굽은 모양(비율)으로 위치 계산
 *  3) 그 밖의 가려진 관절: MediaPipe 추정 좌표를 그대로 쓰되 점선으로 표시
 *  4) 측면(view='side'): 먼 쪽 다리(왼무릎·왼발목)는 보인다고 나와도 항상 점선 (각도 비교에서도 제외됨)
 */
const FAR_LEG = { side: [25, 27] }; // analyzer.js VIEW_EXCLUDE(hip_L, knee_L) 와 짝

export function completePose(lm, W, H, view = 'front') {
  const vis = (i) => (lm[i].visibility ?? 1) > VIS;
  const pts = lm.map((p) => ({ x: p.x * W, y: p.y * H }));
  const inferred = new Set(lm.map((_, i) => i).filter((i) => !vis(i)));
  for (const i of FAR_LEG[view] ?? []) inferred.add(i);
  const len = (a, b) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);

  // 1) 손목 (그립 규칙)
  if (!vis(15) && vis(16)) pts[15] = { ...pts[16] };
  if (!vis(16) && vis(15)) pts[16] = { ...pts[15] };

  // 2) 팔꿈치: 반대쪽 팔의 마디 길이로 어깨~손목 사이 위치 계산 (리드 팔이 펴지는 골프 자세에 잘 맞음)
  // 3) 무릎: 반대쪽 다리의 "굽은 모양(비율)"을 엉덩이~발목 선에 옮겨 붙임.
  //    측면 영상에서 가려진 다리는 카메라에서 멀어 짧게 보이므로, 길이를 그대로 빌리면 무릎이 앞으로 크게 꺾여 버림
  //    (실측: 프로·사용자 측면 어드레스에서 왼무릎이 다리 앞 허공에 그려짐) → 길이가 아니라 비율을 사용.
  for (const [key, { pts: [a, b, c], mirror }] of Object.entries(LIMBS)) {
    if (vis(b)) continue;
    const [ma, mb, mc] = LIMBS[mirror].pts;
    if (![ma, mb, mc].every(vis)) continue;          // 반대쪽도 안 보이면 MediaPipe 추정 좌표 그대로
    if (key.startsWith('arm')) pts[b] = bendPoint(pts[a], pts[c], len(ma, mb), len(mb, mc), pts[b]);
    else pts[b] = copyBend(pts[ma], pts[mb], pts[mc], pts[a], pts[c], pts[b]);
  }
  return { pts, inferred };
}

/**
 * 보이는 다리(A'→B'→C')의 굽은 모양을 가려진 다리(A→?→C)에 옮긴다.
 * 무릎 위치를 "엉덩이~발목 선을 따라 몇 %, 선에서 옆으로 몇 %"로 나타내 그대로 적용.
 * 옆으로 꺾이는 방향(앞/뒤)은 MediaPipe 추정 무릎(hint)에 가까운 쪽을 고른다.
 */
function copyBend(A2, B2, C2, A, C, hint) {
  const d2 = Math.hypot(C2.x - A2.x, C2.y - A2.y), d = Math.hypot(C.x - A.x, C.y - A.y);
  if (d2 < 1e-6 || d < 1e-6) return hint;
  const u2 = { x: (C2.x - A2.x) / d2, y: (C2.y - A2.y) / d2 };
  const along = ((B2.x - A2.x) * u2.x + (B2.y - A2.y) * u2.y) / d2;        // 선을 따라 간 비율
  const side = Math.abs((B2.x - A2.x) * -u2.y + (B2.y - A2.y) * u2.x) / d2; // 선에서 벗어난 비율
  const u = { x: (C.x - A.x) / d, y: (C.y - A.y) / d }, nrm = { x: -u.y, y: u.x };
  const base = { x: A.x + u.x * along * d, y: A.y + u.y * along * d };
  const p1 = { x: base.x + nrm.x * side * d, y: base.y + nrm.y * side * d };
  const p2 = { x: base.x - nrm.x * side * d, y: base.y - nrm.y * side * d };
  const dist = (p) => Math.hypot(p.x - hint.x, p.y - hint.y);
  return dist(p1) <= dist(p2) ? p1 : p2;
}

/**
 * 뼈대 기본층: 보이는 뼈는 실선, 가려진 관절이 끼면 점선.
 * 그 위에 각도 비교 결과(초록/빨강)를 덧그린다.
 */
function drawBones(ctx, pose, color, width) {
  for (const [a, b] of BONES) {
    const guess = pose.inferred.has(a) || pose.inferred.has(b);
    ctx.save();
    if (guess) { ctx.setLineDash([width * 1.6, width * 1.4]); ctx.globalAlpha = 0.75; }
    drawLine(ctx, pose.pts[a], pose.pts[b], color, width);
    ctx.restore();
  }
}

/** 머리 원 그리기 */
function drawHead(ctx, lm, color, width) {
  const h = headCircle(lm, ctx.canvas.width, ctx.canvas.height);
  if (!h) return;
  ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

/** 현재 재생 시간에 가장 가까운 항목의 인덱스 */
const nearest = (arr, t, key) =>
  arr.reduce((best, cur, i) => (Math.abs(cur[key] - t) < Math.abs(arr[best][key] - t) ? i : best), 0);

/** 사용자 영상 위 캔버스에 스켈레톤 1프레임 그리기 */
function drawSkeleton(canvas, video, frames, stages, threshold, view, show = true) {
  const ctx = canvas.getContext('2d');
  // 캔버스 내부 해상도를 영상 원본 해상도에 맞춤 (CSS가 동일 비율로 확대/축소)
  canvas.width = video.videoWidth || 360;
  canvas.height = video.videoHeight || 640;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!frames?.length || !stages?.length) return -1;

  const t = video.currentTime;
  const frame = frames[nearest(frames, t, 't')];
  const stageIdx = nearest(stages, t, 'userT');
  const stage = stages[stageIdx];
  if (!show) return stageIdx; // 스켈레톤 끔: 그리지 않지만 재생 중 피드백 갱신용 단계 번호는 돌려줌

  const pose = completePose(frame.lm, canvas.width, canvas.height, view);
  const P = (i) => pose.pts[i];
  const w = Math.max(3, canvas.width / 150);
  ctx.lineCap = 'round';

  // 기본층(흰색): 몸 전체 뼈대 + 머리. 가려져서 추정한 부분은 점선
  drawBones(ctx, pose, '#fff', w * 0.6);
  // 머리: 비교한 단계면 초록(프로와 비슷)/빨강(차이 큼), 비교하지 않은 단계(어드레스·피니시)는 흰색
  const hc = !stage.head ? ['#fff', w * 0.6] : stage.head.bad ? ['#E5383B', w] : ['#1FA64A', w];
  drawHead(ctx, frame.lm, ...hc);

  // 비교된 관절(양쪽 모두 보이는 관절만)은 초록/빨강으로 덧그림
  for (const [name, sides] of Object.entries(JOINTS)) {
    for (const [side, [a, b, c]] of Object.entries(sides)) {
      const diff = stage.diffs[`${name}_${side}`];
      if (diff === undefined) continue;
      const bad = diff > threshold;
      const color = bad ? '#E5383B' : '#1FA64A'; // 초과: 빨강 / 이내: 초록
      drawLine(ctx, P(a), P(b), color, w);
      drawLine(ctx, P(b), P(c), color, w);
      if (bad) { // 문제 관절에 강조 링
        const p = P(b);
        ctx.beginPath(); ctx.arc(p.x, p.y, w * 4, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
      }
    }
  }
  return stageIdx;
}

/**
 * requestAnimationFrame 루프 시작
 * @param getData  () => ({ frames, stages, threshold })  최신 분석 데이터를 돌려주는 함수
 * @param onStage  (stageIdx) => void          재생 중 가까운 단계가 바뀔 때 호출
 */
export function startOverlayLoop(canvas, video, getData, onStage) {
  let lastStage = -1;
  const loop = () => {
    const { frames, stages, threshold, view, show } = getData();
    const idx = drawSkeleton(canvas, video, frames, stages, threshold, view, show !== false);
    if (idx >= 0 && !video.paused && idx !== lastStage) { lastStage = idx; onStage?.(idx); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** 영상 원본 비율에 맞춰 스테이지 박스 크기 조정 */
export function fitStageToVideo(video) {
  if (video.videoWidth) video.parentElement.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
}

// ===== 미세 조정 패널 (AI가 찾은 장면이 어긋났을 때 사람이 프레임 단위로 바로잡음) =====

/** 슬라이더/버튼 이벤트 연결. onSlide(frameIdx), onStep(+1|-1), onReset() */
export function bindAdjuster({ onSlide, onStep, onReset }) {
  $('adjSlider').oninput = (e) => onSlide(Number(e.target.value));
  $('adjPrev').onclick = () => onStep(-1);
  $('adjNext').onclick = () => onStep(1);
  $('adjReset').onclick = onReset;
}

/**
 * 선택된 단계의 현재 프레임/범위를 패널에 표시
 * @param step 분석 간격(초). 1/30초보다 넓으면(긴 영상) 버튼에 "1칸 = n초"를 표시해 실제 이동량을 알려 줌
 */
export function showAdjuster(stage, { min, max }, aiIdx, step = 1 / 30) {
  $('adjust').hidden = false;
  const slider = $('adjSlider');
  slider.min = min; slider.max = max; slider.value = stage.frameIdx;
  const d = stage.frameIdx - aiIdx;
  const coarse = step > 1 / 30 + 1e-3;
  const unit = coarse ? '칸' : '프레임';
  $('adjPrev').textContent = `◀ 1${unit}`;
  $('adjNext').textContent = `1${unit} ▶`;
  $('adjInfo').textContent =
    `${stage.name} · ${stage.userT.toFixed(2)}초 · AI 위치 대비 ${d > 0 ? '+' : ''}${d}${unit}` +
    (coarse ? ` (영상이 길어 1칸 = ${step.toFixed(3)}초)` : '');
  $('adjPrev').disabled = stage.frameIdx <= min;
  $('adjNext').disabled = stage.frameIdx >= max;
}

export function hideAdjuster() { $('adjust').hidden = true; }

// ===== 프로 스켈레톤 (프로 영상 위에 기준 자세를 선으로 표시) =====

/**
 * 프로 자세(lm)를 캔버스에 그린다. 선은 파란색, 사용자와 오차가 큰 관절에는 빨간 링을 표시.
 * @param stage 현재 단계 비교 결과 (diffs 로 어떤 관절이 어긋났는지 판단)
 */
export function drawProSkeleton(canvas, video, lm, stage, threshold, view = 'front') {
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth || 360;   // 영상 해상도에 맞춰 좌표계를 일치시킴
  canvas.height = video.videoHeight || 640;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;

  const pose = completePose(lm, canvas.width, canvas.height, view);
  const P = (i) => pose.pts[i];
  const w = Math.max(3, canvas.width / 150);
  ctx.lineCap = 'round';

  drawBones(ctx, pose, '#3B82F6', w);                                      // 몸 전체 (가려져 추정한 부분은 점선)
  drawHead(ctx, lm, stage?.head?.bad ? '#E5383B' : '#3B82F6', w * 0.8);    // 머리 (사용자와 차이가 크면 빨강)

  for (const [name, sides] of Object.entries(JOINTS)) {
    for (const [side, [, b]] of Object.entries(sides)) {
      if ((stage?.diffs?.[`${name}_${side}`] ?? 0) > threshold) {        // 사용자와 크게 다른 관절 강조 (비교된 관절만 diffs 에 있음)
        const p = P(b);
        ctx.beginPath(); ctx.arc(p.x, p.y, w * 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#E5383B'; ctx.lineWidth = w; ctx.stroke();
      }
    }
  }
}

/**
 * 프로 스켈레톤 렌더 루프. 프로 스켈레톤은 영상에서 실시간으로 찾은 게 아니라 "단계별로 저장된 자세"라서,
 * 영상이 그 단계 시각에 멈춰 있을 때만 그린다 (getPose 가 시각을 확인해 맞지 않으면 null 을 돌려줌).
 * 재생 중이거나 다른 시각(예: 동기화 재생이 끝난 피니시 화면)에 멈춰 있으면 지운다.
 * @param getPose () => ({ lm, stage, threshold }) | null
 */
export function startProOverlayLoop(canvas, video, getPose) {
  const loop = () => {
    const pose = getPose();
    if (pose && video.paused) drawProSkeleton(canvas, video, pose.lm, pose.stage, pose.threshold, pose.view);
    else canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
