/**
 * clubs/common.js
 * 클럽 프로필이 함께 쓰는 도구 모음 (클럽 고유의 규칙은 각 클럽 파일에 둔다)
 */
import { LM } from '../analyzer.js';

/**
 * 움직임 기반 사건 검출기를 만들어 돌려준다. (tools/clubs.py 의 _detect_swing_phases 와 같아야 함)
 * 위치가 비슷한 프레임을 찾는 방식은 "올라가는 중/내려오는 중"을 구분하지 못해서,
 * 움직임으로 정의되는 사건을 먼저 찾고 기준 영상에서 계산해 둔 보정값을 더해 같은 장면을 잡는다.
 *  - 임팩트: 손목 이동 속도가 가장 빠른 프레임
 *  - 백스윙 탑: 시작부터 임팩트 직전까지 중 손목이 가장 높은 프레임
 *  - 어드레스(테이크어웨이 직전): 백스윙에서 가장 빠른 지점부터 거꾸로 가서 손이 멈춰 있던 마지막 프레임
 *  - 피니시: 임팩트 이후 손이 거의 멈추는 첫 프레임 (없으면 마지막 프레임)
 *  - 테이크어웨이 / 다운스윙 / 팔로우 스루: 앞뒤 단계 사이에서 손목 높이가 일정 비율만큼 진행한 첫 프레임
 * 반환: [어드레스, 테이크어웨이, 탑, 다운스윙, 임팩트, 팔로우 스루, 피니시] 프레임 인덱스
 */
export function makeRuleBasedDetector() {
  const smooth = (v) => v.map((_, i) => {
    const s = v.slice(Math.max(0, i - 1), i + 2);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });

  return function detectKeyFrames(frames, aspect = 1) {
    const n = frames.length;
    if (n < 6) throw new Error('유효한 포즈 프레임이 부족합니다. 전신이 보이도록 촬영하세요.');

    const y = smooth(frames.map((f) => (f.lm[LM.L_WRIST].y + f.lm[LM.R_WRIST].y) / 2)); // 작을수록 높음
    const speed = smooth([0, ...frames.slice(1).map((f, k) => {
      const a = frames[k].lm, b = f.lm;
      const dx = ((b[LM.L_WRIST].x + b[LM.R_WRIST].x - a[LM.L_WRIST].x - a[LM.R_WRIST].x) / 2) * aspect;
      const dy = (b[LM.L_WRIST].y + b[LM.R_WRIST].y - a[LM.L_WRIST].y - a[LM.R_WRIST].y) / 2;
      return Math.hypot(dx, dy) / (f.t - frames[k].t);
    })]);

    let impact = 2;
    for (let i = 2; i < n; i++) if (speed[i] > speed[impact]) impact = i;
    let top = 1;
    for (let i = 1; i < impact; i++) if (y[i] < y[top]) top = i;
    const still = 0.08 * speed[impact]; // "거의 멈춤" 기준: 최대 속도의 8%

    let address = 0;
    if (top > 1) {
      let peak = 1;
      for (let i = 1; i <= top; i++) if (speed[i] > speed[peak]) peak = i;
      for (let i = peak; i > 0; i--) if (speed[i] < still) { address = i; break; }
    }
    let finish = n - 1;
    for (let i = Math.min(impact + 3, n - 1); i < n; i++) if (speed[i] < still) { finish = i; break; }

    // 중간 단계 (y 는 작을수록 높음)
    const takeaway = firstReaching(y, address, top, y[address] - TAKEAWAY_RISE * (y[address] - y[top]), false);
    const downswing = firstReaching(y, top, impact, y[top] + DOWNSWING_DROP * (y[impact] - y[top]), true);
    const follow = firstReaching(y, impact, finish, y[impact] - FOLLOW_RISE * (y[impact] - y[finish]), false);
    return [address, takeaway, top, downswing, impact, follow, finish];
  };
}

// 중간 단계(샤프트가 지면과 평행한 순간)를 손목 높이의 "진행 비율"로 찾는 기준 (tools/clubs.py 와 같은 값)
export const TAKEAWAY_RISE = 0.25;   // 테이크어웨이: 어드레스→탑 손목 상승량의 25% 를 처음 넘는 프레임
export const DOWNSWING_DROP = 0.70;  // 다운스윙: 탑→임팩트 손목 하강량의 70% 를 처음 넘는 프레임
export const FOLLOW_RISE = 0.30;     // 팔로우 스루: 임팩트→피니시 손목 상승량의 30% 를 처음 넘는 프레임

/** lo < i < hi 범위에서 values[i] 가 target 에 처음 도달하는 i. 없으면 가운데 (rising: 값이 커지는 방향) */
function firstReaching(values, lo, hi, target, rising) {
  for (let i = lo + 1; i < hi; i++) if (rising ? values[i] >= target : values[i] <= target) return i;
  return Math.floor((lo + hi) / 2);
}

// 7단계 이름 (중간 3단계 = 샤프트가 지면과 평행한 순간). tools/clubs.py 의 STAGES_7 과 같아야 함
export const STAGES_7 = ['어드레스', '테이크어웨이', '백스윙 탑', '다운스윙', '임팩트', '팔로우 스루', '피니시'];
