/**
 * analyzer.js
 * 클럽 종류와 무관한 공통 계산 모듈: 각도 계산 / 자세 유사도 매칭 / 프로 대비 오차 계산
 * (DOM 의존성 없음 → 단위 테스트 및 확장이 쉬움)
 * 클럽별 설정(단계 이름, 허용 오차, 조언 문구, 보조 포착 규칙)은 src/js/clubs/ 에 있다.
 */

// MediaPipe 랜드마크 인덱스
export const LM = { L_SHOULDER: 11, R_SHOULDER: 12, L_WRIST: 15, R_WRIST: 16 };

// 관절별 [점A, 꼭짓점B, 점C] 랜드마크 인덱스 (L=왼쪽, R=오른쪽)
export const JOINTS = {
  shoulder: { L: [23, 11, 13], R: [24, 12, 14] }, // 엉덩이-어깨-팔꿈치
  elbow:    { L: [11, 13, 15], R: [12, 14, 16] }, // 어깨-팔꿈치-손목
  hip:      { L: [11, 23, 25], R: [12, 24, 26] }, // 어깨-엉덩이-무릎
  knee:     { L: [23, 25, 27], R: [24, 26, 28] }, // 엉덩이-무릎-발목
};

/** 세 점 a-b-c 에서 꼭짓점 b 의 2D 각도(0~180도) */
export function angle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const cross = v1.x * v2.y - v1.y * v2.x;
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
}

/**
 * 한 프레임의 모든 관절 각도 → { shoulder_L: 값, ... } (가시성 낮은 관절은 제외)
 * aspect = 영상 가로/세로 비율. 정규화 좌표(0~1)는 가로·세로 스케일이 달라
 * 각도가 왜곡되므로 x 에 aspect 를 곱해 실제 픽셀 비율로 맞춘다.
 * (tools/extract_reference.py 와 반드시 같은 방식이어야 비교가 정확함)
 */
export function computeFrameAngles(lm, aspect = 1) {
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const out = {};
  for (const [name, sides] of Object.entries(JOINTS)) {
    for (const [side, idx] of Object.entries(sides)) {
      const visible = idx.every((i) => (lm[i].visibility ?? 1) > 0.4);
      if (visible) out[`${name}_${side}`] = angle(P(idx[0]), P(idx[1]), P(idx[2]));
    }
  }
  return out;
}

/**
 * 장면 매칭용 자세 특징: 양 손목의 위치를 "엉덩이 중심 기준, 몸통 길이로 정규화"한 4개 숫자
 * [왼손목x, 왼손목y, 오른손목x, 오른손목y]
 * - 사람 크기/카메라 거리/화면 내 위치가 달라도 비교 가능
 * - 비교 대상인 관절 각도와 별개 기준이라, 틀린 자세가 매칭 단계에서 숨겨지지 않음
 * - 측면 영상처럼 일부가 가려져도 MediaPipe 추정 좌표를 그대로 사용 (visibility 로 걸러내지 않음)
 * - tools/extract_reference.py 의 pose_feature 와 동일해야 함
 */
export function poseFeature(lm, aspect = 1) {
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const hip = mid(P(23), P(24)), sh = mid(P(11), P(12));
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y) || 1e-6;
  return [15, 16].flatMap((i) => [(P(i).x - hip.x) / torso, (P(i).y - hip.y) / torso]);
}

// MediaPipe 랜드마크의 좌/우 짝 (얼굴 1↔4 … 발끝 31↔32)
const LR_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18],
  [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * 좌우 뒤집힘 보정 (골프 전용 규칙: 스윙 중 두 발은 제자리에 있다)
 * 백스윙 탑처럼 몸통이 크게 돌고 팔이 얼굴을 가리면, MediaPipe 가 "카메라를 등진 사람"으로 착각해
 * 몸 전체의 왼쪽/오른쪽 이름을 뒤바꾸는 일이 있다 (실측: 사용자 정면 영상 백스윙 1.08~1.72초).
 * 발목 위치가 평소와 반대로 붙은 프레임을 찾아 몸 전체의 좌/우 랜드마크를 다시 맞바꾼다.
 *  - 기준 발 위치: 전체 프레임의 발목 중앙값 (뒤집힌 프레임이 소수라는 가정) → 보정 후 한 번 더 계산
 *  - 두 발이 가까우면(측면 영상 등, 몸통 길이의 30% 미만) 판단이 불확실하므로 보정하지 않음
 *  - 반대로 붙였을 때 거리 합이 절반 이하로 줄 때만 뒤집힘으로 판단 (애매하면 그대로 둠)
 * tools/extract_reference.py 의 fix_left_right_flips 와 같은 규칙.
 * @returns {{frames:Array, flipped:number[]}} 보정된 프레임(원본은 그대로) + 뒤집혀 있던 프레임 번호
 */
export function fixLeftRightFlips(frames, aspect = 1) {
  if (frames.length < 6) return { frames, flipped: [] };
  const P = (lm, i) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const torso = median(frames.map(({ lm }) => {
    const sh = { x: (P(lm, 11).x + P(lm, 12).x) / 2, y: (P(lm, 11).y + P(lm, 12).y) / 2 };
    const hp = { x: (P(lm, 23).x + P(lm, 24).x) / 2, y: (P(lm, 23).y + P(lm, 24).y) / 2 };
    return d(sh, hp);
  }));

  let lms = frames.map((f) => f.lm), flipped = [];
  for (let iter = 0; iter < 2; iter++) {
    const L = { x: median(lms.map((lm) => P(lm, 27).x)), y: median(lms.map((lm) => P(lm, 27).y)) };
    const R = { x: median(lms.map((lm) => P(lm, 28).x)), y: median(lms.map((lm) => P(lm, 28).y)) };
    if (d(L, R) < 0.3 * torso) return { frames, flipped: [] };            // 두 발이 너무 가까움 → 보정 안 함
    flipped = [];
    lms = frames.map(({ lm }, k) => {
      const keep = d(P(lm, 27), L) + d(P(lm, 28), R);
      const swap = d(P(lm, 27), R) + d(P(lm, 28), L);
      if (swap >= 0.5 * keep) return lm;
      flipped.push(k);
      const out = lm.slice();
      for (const [a, b] of LR_PAIRS) { out[a] = lm[b]; out[b] = lm[a]; }
      return out;
    });
  }
  return { frames: frames.map((f, k) => (lms[k] === f.lm ? f : { ...f, lm: lms[k] })), flipped };
}

const LEG_POINTS = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]; // 엉덩이·무릎·발목·뒤꿈치·발끝
const SPIKE_HALF = 3;      // 앞뒤 3프레임(30fps 기준 ±0.1초)과 비교
const SPIKE_LIMIT = 0.15;  // 주변 프레임 중앙값에서 몸통 길이의 15% 넘게 튀면 "순간 오인식"

/**
 * 하체 순간 튐 보정: 1~2프레임만 엉뚱한 곳에 찍혔다가 돌아오는 하체 관절을 앞뒤 프레임 중앙값으로 교체.
 * (실측: 사용자 정면 영상 1.12·1.15·1.52초에 한쪽 발목이 다리 사이로 찍힘)
 * - 피니시에서 뒷발이 들리는 것처럼 "서서히, 계속" 움직이는 건 앞뒤도 같이 움직이므로 걸리지 않음
 * - 교체한 점은 visibility 를 0 으로 낮춤 → 화면에는 점선(추정), 각도 비교에서는 제외 (추정값으로 피드백하지 않음)
 * tools/extract_reference.py 의 fix_leg_spikes 와 같은 규칙.
 * @returns {{frames:Array, fixedCount:number}}
 */
export function fixLegSpikes(frames, aspect = 1) {
  const n = frames.length;
  if (n < 2 * SPIKE_HALF + 1) return { frames, fixedCount: 0 };
  const P = (lm, i) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const torso = median(frames.map(({ lm }) => Math.hypot(
    (P(lm, 11).x + P(lm, 12).x - P(lm, 23).x - P(lm, 24).x) / 2,
    (P(lm, 11).y + P(lm, 12).y - P(lm, 23).y - P(lm, 24).y) / 2)));
  let fixedCount = 0;
  const out = frames.map((f, k) => {
    const lo = Math.max(0, k - SPIKE_HALF), hi = Math.min(n, k + SPIKE_HALF + 1);
    let lm = null;
    for (const i of LEG_POINTS) {
      const win = frames.slice(lo, hi).map((g) => g.lm[i]);
      const mx = median(win.map((p) => p.x)), my = median(win.map((p) => p.y));
      if (Math.hypot((f.lm[i].x - mx) * aspect, f.lm[i].y - my) > SPIKE_LIMIT * torso) {
        lm ??= f.lm.slice();
        lm[i] = { ...f.lm[i], x: mx, y: my, visibility: 0 };
        fixedCount++;
      }
    }
    return lm ? { ...f, lm } : f;
  });
  return { frames: out, fixedCount };
}

/**
 * MediaPipe 결과 정리: 좌우 뒤집힘 → 하체 순간 튐 순서로 보정 (각도 계산 전에 호출)
 * @returns {{frames:Array, flipped:number[], spikes:number}}
 */
export function cleanupPose(frames, aspect = 1) {
  const a = fixLeftRightFlips(frames, aspect);
  const b = fixLegSpikes(a.frames, aspect);
  return { frames: b.frames, flipped: a.flipped, spikes: b.fixedCount };
}

// ===== 머리 위치 비교 =====
export const HEAD_RATIO = 0.23; // 머리 반지름 = 몸통(어깨 중점~엉덩이 중점) 길이 × 0.23
const HEAD_LIFT = 0.35;          // 귀 중점에서 정수리 쪽으로 반지름 × 0.35 만큼 올림 (귀는 머리 중심보다 약간 아래)
const HEAD_LIMIT = 0.15;         // 프로와의 머리 이동 차이가 몸통 길이의 15%(머리 폭의 약 1/3) 넘으면 지적

/**
 * 머리 중심 (화면에 그리는 머리 원과 같은 점). 좌표는 x 에 aspect 를 곱한 비율 보정 공간.
 * 중심 = 두 귀의 중점을 목 방향(어깨 중점→귀 중점)으로 조금 올린 점. 귀가 둘 다 안 보이면 코 사용.
 * @returns {{x, y, torso, visible}} torso = 몸통 길이(같은 공간), visible = 얼굴 점이 하나라도 보이는지
 */
export function headPoint(lm, aspect = 1) {
  const vis = (i) => (lm[i].visibility ?? 1) > 0.4;
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const sh = mid(P(11), P(12)), hip = mid(P(23), P(24));
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y) || 1e-6;
  const base = vis(7) || vis(8) ? mid(P(7), P(8)) : P(0);
  const ux = base.x - sh.x, uy = base.y - sh.y, n = Math.hypot(ux, uy) || 1;
  const lift = torso * HEAD_RATIO * HEAD_LIFT;
  return { x: base.x + (ux / n) * lift, y: base.y + (uy / n) * lift, torso, visible: [0, 7, 8].some(vis) };
}

/** 어드레스 대비 머리 이동량 (몸통 길이 단위). 어느 한쪽 얼굴이 안 보이면 null */
function headShift(lm0, lm, aspect) {
  const h0 = headPoint(lm0, aspect), h = headPoint(lm, aspect);
  if (!h0.visible || !h.visible) return null;
  return { dx: (h.x - h0.x) / h0.torso, dy: (h.y - h0.y) / h0.torso };
}

/**
 * 단계별 머리 위치 비교 결과를 stages[s].head 에 붙인다.
 * "어드레스 대비 머리가 얼마나 움직였나"를 프로와 사용자 각각 계산해 그 차이를 본다.
 *  - 비교 단계: headStages(클럽 프로필의 단계 이름 목록). 없으면 처음(어드레스)·마지막(피니시)만 제외
 *    → 드라이버/아이언: 테이크어웨이, 백스윙 탑, 다운스윙, 임팩트
 *      (어드레스는 기준이라 항상 0, 팔로우 스루·피니시는 몸을 돌려 머리가 움직이는 게 정상)
 *  - ex, ey: (사용자 이동 - 프로 이동), 몸통 길이 단위. 화면 기준 x+ = 오른쪽, y+ = 아래
 * 미세 조정으로 어드레스가 바뀌면 다른 단계 값도 달라지므로, 단계가 바뀔 때마다 전체를 다시 계산한다.
 */
export function addHeadDiffs(reference, userFrames, stages, aspect = 1, headStages = null) {
  const refAsp = reference.aspect ?? 1;
  const refLm = (s) => reference.stages[s].landmarks?.map(([x, y, visibility]) => ({ x, y, visibility }));
  const pro0 = refLm(0), user0 = userFrames[stages[0].frameIdx].lm;
  const compare = (st, s) => (headStages ? headStages.includes(st.name) : s > 0 && s < stages.length - 1);
  stages.forEach((st, s) => {
    st.head = null;
    if (s === 0 || !compare(st, s) || !pro0) return;
    const pro = headShift(pro0, refLm(s), refAsp), user = headShift(user0, userFrames[st.frameIdx].lm, aspect);
    if (!pro || !user) return;
    const ex = user.dx - pro.dx, ey = user.dy - pro.dy;
    st.head = { ex, ey, err: Math.hypot(ex, ey), bad: Math.hypot(ex, ey) > HEAD_LIMIT };
  });
  return stages;
}

/** 추출된 프레임들에 각도(ang)와 자세 특징(feat)을 붙여 반환 */
export function annotateFrames(frames, aspect = 1) {
  return frames.map((f) => ({ ...f, ang: computeFrameAngles(f.lm, aspect), feat: poseFeature(f.lm, aspect) }));
}

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/**
 * 기준 자세(특징 벡터)와 가장 비슷한 프레임을 단계별로 찾는다.
 * 단, 단계 순서(어드레스 < 탑 < 임팩트 < 피니시)를 지키도록 동적계획법으로 전체 합이 최소인 조합을 선택.
 * @returns {{indices:number[], dists:number[]}} 단계별 프레임 인덱스와 매칭 거리(작을수록 비슷)
 */
export function matchStages(refFeatures, frames) {
  const K = refFeatures.length, n = frames.length, INF = 1e9;
  const cost = refFeatures.map((rf) => frames.map((f) => (f.feat ? dist(rf, f.feat) : INF)));
  const dp = Array.from({ length: K }, () => new Array(n).fill(INF));
  const from = Array.from({ length: K }, () => new Array(n).fill(-1));
  for (let i = 0; i < n; i++) dp[0][i] = cost[0][i];
  for (let s = 1; s < K; s++) {
    let best = INF, bestJ = -1;                    // 앞 단계의 최소 누적 비용(이전 프레임들 중)
    for (let i = 0; i < n; i++) {
      if (i > 0 && dp[s - 1][i - 1] < best) { best = dp[s - 1][i - 1]; bestJ = i - 1; }
      if (best < INF && cost[s][i] < INF) { dp[s][i] = best + cost[s][i]; from[s][i] = bestJ; }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i++) if (dp[K - 1][i] < dp[K - 1][end]) end = i;
  if (dp[K - 1][end] >= INF) throw new Error('기준 동작과 비교할 수 있는 프레임이 부족합니다. 전신이 나오게 촬영하세요.');
  const indices = new Array(K);
  for (let s = K - 1, i = end; s >= 0; s--) { indices[s] = i; i = from[s][i]; }
  return { indices, dists: indices.map((idx, s) => cost[s][idx]) };
}

const MAX_SHIFT = 0.6; // 보정값 상한(초)

/** t 에 가장 가까운 프레임의 인덱스 */
const nearestIndex = (frames, t) =>
  frames.reduce((best, f, i) => (Math.abs(f.t - t) < Math.abs(frames[best].t - t) ? i : best), 0);

/**
 * 시점별로 비교에서 빼는 관절 각도.
 * 측면(오른손잡이, 타깃 반대편에서 촬영)에서는 왼다리가 오른다리 뒤에 겹쳐 MediaPipe 가 자주 틀린 곳에 찍는다
 * (실측: 프로 측면 어드레스에서 왼발목이 오른다리 정강이 위에 visibility 0.58 로 찍힘).
 * 틀린 값으로 피드백하지 않도록 먼 쪽 다리가 들어가는 각도(엉덩이·무릎 왼쪽)는 비교하지 않는다.
 * 화면에서는 같은 다리를 점선으로 표시한다 (ui.js FAR_LEG).
 */
export const VIEW_EXCLUDE = { front: [], side: ['hip_L', 'knee_L'] };

/**
 * 사용자 영상의 idx 번째 프레임을 해당 단계로 삼아 기준과의 각도 차이를 계산한다.
 * AI 자동 매칭과 사용자의 수동 미세 조정이 모두 이 함수를 쓴다.
 * @param view 'front' | 'side' — VIEW_EXCLUDE 에 있는 각도는 비교에서 뺀다
 * @returns {{name, proT, userT, frameIdx, diffs, matchDist}} diffs: { 관절_좌우: |Δθ| }
 */
export function buildStage(refStage, userFrames, idx, view = 'front') {
  const f = userFrames[idx];
  const skip = VIEW_EXCLUDE[view] ?? [];
  const diffs = {};   // |사용자 - 프로| (크기만, 색칠·판정용)
  const signed = {};  // 사용자 - 프로 (+ 면 사용자 각도가 큼 = 과함, - 면 작음 = 부족함)
  for (const k in f.ang) {
    if (k in refStage.angles && !skip.includes(k)) {
      signed[k] = f.ang[k] - refStage.angles[k];
      diffs[k] = Math.abs(signed[k]);
    }
  }
  const matchDist = refStage.feature && f.feat ? dist(refStage.feature, f.feat) : null;
  return { name: refStage.name, proT: refStage.time, userT: f.t, frameIdx: idx, diffs, signed, matchDist };
}

/**
 * 미세 조정 슬라이더가 움직일 수 있는 프레임 범위.
 * AI가 찾은 위치 ±window 프레임 안이면서, 앞/뒤 단계와 순서가 뒤바뀌지 않는 범위로 제한한다.
 */
export function adjustRange(stages, aiIdx, i, nFrames, window = 12) {
  const lo = i === 0 ? 0 : stages[i - 1].frameIdx + 1;
  const hi = i === stages.length - 1 ? nFrames - 1 : stages[i + 1].frameIdx - 1;
  return { min: Math.max(lo, aiIdx[i] - window), max: Math.min(hi, aiIdx[i] + window) };
}

/**
 * 기준 JSON(Python으로 미리 추출) vs 사용자 영상 단계별 비교
 * - 기준 JSON 에 feature 가 있으면: 기준 자세와 "비슷한 장면"을 사용자 영상에서 찾아 비교
 * - 없으면(구버전 JSON): 클럽 프로필의 detectKeyFrames(보조 규칙)로 대체
 * @param reference  assets/reference_*.json 내용 ({ stages:[{name,time,angles}] })
 * @param userFrames annotateFrames() 결과
 * @param club       클럽 프로필 (src/js/clubs/*.js). 구버전 JSON 대체 규칙에만 필요
 * @param view       'front' | 'side' (측면은 먼 쪽 다리 각도를 비교에서 뺌)
 * @returns {Array} buildStage() 결과의 배열
 */
export function compareSwings(reference, userFrames, aspect = 1, club = null, view = 'front') {
  const hasFeat = reference.stages.every((st) => Array.isArray(st.feature));
  let idx;
  if (hasFeat) idx = matchStages(reference.stages.map((st) => st.feature), userFrames).indices;
  else {
    if (!club?.detectKeyFrames) throw new Error('기준 파일이 구버전입니다. tools/extract_reference.py 로 다시 만들어 주세요.');
    // 규칙은 클럽 프로필의 단계(7개)를 모두 찾으므로, 기준 파일에 있는 단계만 이름으로 골라 씀 (4단계 구버전 대응)
    const found = club.detectKeyFrames(userFrames, aspect);
    const byName = Object.fromEntries(club.stages.map((name, i) => [name, found[i]]));
    idx = reference.stages.map((st) => byName[st.name]);
    if (idx.some((v) => v === undefined)) throw new Error('기준 파일의 단계 이름이 클럽 설정과 다릅니다. tools/extract_reference.py 로 다시 만들어 주세요.');
  }
  return reference.stages.map((ref, s) => buildStage(ref, userFrames, idx[s], view));
}

/**
 * 한 단계에서 임계값을 넘는 관절 목록 (오차 큰 순, 좌/우 중 더 크게 틀린 쪽 사용)
 * @returns {Array<{joint, diff, signed, side, level}>}
 *   diff = |차이|, signed = 사용자 - 프로, side = 'L'|'R', level = 'over'(과함) | 'under'(부족함)
 */
export function getOffenders(stage, threshold = 15) {
  const worst = {};
  for (const k in stage.diffs) {
    const [joint, side] = k.split('_');
    if (!worst[joint] || stage.diffs[k] > worst[joint].diff) {
      const signed = stage.signed?.[k] ?? stage.diffs[k];
      worst[joint] = { joint, diff: stage.diffs[k], signed, side, level: signed > 0 ? 'over' : 'under' };
    }
  }
  return Object.values(worst).filter((o) => o.diff > threshold).sort((a, b) => b.diff - a.diff);
}

/** 허용 오차 이내로 비교된 관절 목록 (적당함 문구용) */
export function getGoodJoints(stage, threshold = 15) {
  const joints = [...new Set(Object.keys(stage.diffs).map((k) => k.split('_')[0]))];
  const bad = new Set(getOffenders(stage, threshold).map((o) => o.joint));
  return joints.filter((j) => !bad.has(j));
}
