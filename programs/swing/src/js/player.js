/**
 * player.js — 영상 재생 컨트롤 (영상별 재생·배속·탐색 + 재생 모드 3가지)
 *
 * 배속은 "실제 스윙 속도" 기준이다.
 *  - 프로 영상은 파일 자체가 슬로모션이라(클럽 프로필 proSlowmo, 기본 약 2.75배 느림)
 *    1배 = 파일을 2.75배 빠르게 재생 = 실제 속도. 0.25배 = 실제의 1/4 속도.
 *  - 사용자 영상은 실제 속도로 찍혔다고 가정 (골프존 나스모 영상: 다운스윙 0.27초로 실제 속도 확인)
 *
 * 재생 모드 (사용자 영상이 기준, 프로 영상이 따라감 — 개별 재생 제외)
 *  1) solo  개별 재생: 두 영상을 따로 조작. 각자 고른 배속으로 일정하게 재생
 *  2) sync  동기화 재생 (템포 비교): 어드레스 시점을 맞춰 함께 출발, 두 영상 모두 일정한 실제 속도
 *           → 누가 탑·임팩트에 먼저 도착하는지, 템포 차이가 그대로 보인다
 *  3) match 동작 맞춤 재생 (자세 흐름 비교): 단계(테이크어웨이·탑·임팩트…)를 비슷한 타이밍에 넘어가도록 프로가 변속
 *           - 단계 시각 쌍을 부드러운 곡선(buildCurve)으로 이어 "지금 사용자 시각에 맞는 프로 시각"을 계산
 *           - 끊겨 보이지 않게: 변속 폭을 정속의 0.5~2배로 제한하고, 속도 변화에 완충(약 0.15초)을 둔다
 *           - 그래서 아주 짧은 구간(임팩트 근처)은 완벽히 맞추지 않고 조금 뒤에 따라잡는다. 멈추면 정확히 맞춤
 *  두 동기화 모드 모두: 작은 어긋남은 속도로 메우고, 크게 어긋났을 때만 위치 이동(seek)
 *  (seek 은 영상을 키프레임부터 다시 풀어야 해서 화면이 멈칫·점프함)
 *  분석 전(단계 시각 없음)에는 지금 위치에서 두 영상을 같은 실제 속도로 함께 재생만 한다.
 */
export const SPEEDS = [0.12, 0.25, 0.5, 0.75, 1];
const CATCH_UP = 2;          // 어긋남을 약 0.5초(=1/2) 안에 메우는 속도로 보정
const SYNC_CATCH = 0.1;      // 동기화(정속): 보정은 정속의 ±10% 까지만 (눈에 띄는 변속 없음)
const MATCH_CATCH = 0.3;     // 동작 맞춤: 보정은 ±30% 까지
const MATCH_MIN = 0.5;       // 동작 맞춤: 프로 속도는 정속의 0.5배 ~
const MATCH_MAX = 2;         //            2배 사이로만 (너무 빠르면 프레임이 날아가 보이고, 너무 느리면 멈춘 듯 보임)
const SMOOTH_TAU = 0.15;     // 동작 맞춤: 속도 변화 완충 시간(초). 목표 속도로 서서히 다가감
const BIG_GAP = 0.25;        // 실제 동작 시간으로 0.25초 넘게 어긋나면 그때만 위치 이동(seek)
const SEEK_LEAD = 0.1;       // 위치 이동 시 탐색 지연만큼 앞당기는 시간(초)
const clampRate = (r) => Math.min(16, Math.max(0.0625, r)); // 브라우저가 허용하는 재생 속도 범위
// play() 직후 pause() 하면 브라우저가 거절 오류를 내므로 조용히 무시 (정상 동작)
const play = (v) => v.play().catch(() => {});

/**
 * 사용자 시각(u) → 프로 시각(p) 대응 곡선. 단계 시각 쌍(knots)을 지나는 "단조 3차 곡선"(PCHIP, Fritsch–Carlson).
 * 직선으로 이으면 단계가 바뀌는 순간 프로 재생 속도가 툭 바뀌므로, 기울기(= 프로 재생 속도)가 이어지도록 곡선으로 잇는다.
 * 단조라서 시간이 거꾸로 가는 일은 없다. 첫·마지막 단계 바깥은 outside 기울기(실제 속도)로 직선 연장.
 * @returns {{map(u):number, slope(u):number, inverse(p):number}}
 */
export function buildCurve(knots, outside) {
  const k = [];
  for (const q of [...knots].sort((a, b) => a.u - b.u)) {   // u, p 모두 증가하는 점만 사용
    if (!k.length || (q.u > k[k.length - 1].u + 1e-6 && q.p > k[k.length - 1].p + 1e-6)) k.push(q);
  }
  const n = k.length;
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(k[i + 1].u - k[i].u); d.push((k[i + 1].p - k[i].p) / h[i]); }
  const m = new Array(n).fill(outside);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);           // 가중 조화 평균 → 단조 유지
  }
  if (n > 1) { m[0] = Math.min(outside, 3 * d[0]); m[n - 1] = Math.min(outside, 3 * d[n - 2]); }
  const seg = (u) => { for (let i = 0; i < n - 1; i++) if (u <= k[i + 1].u) return i; return n - 2; };
  const map = (u) => {
    if (n === 1) return k[0].p + (u - k[0].u) * outside;
    if (u <= k[0].u) return k[0].p + (u - k[0].u) * m[0];
    if (u >= k[n - 1].u) return k[n - 1].p + (u - k[n - 1].u) * m[n - 1];
    const i = seg(u), t = (u - k[i].u) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * k[i].p + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * k[i + 1].p + (t3 - t2) * h[i] * m[i + 1];
  };
  const slope = (u) => {
    if (n === 1) return outside;
    if (u <= k[0].u) return m[0];
    if (u >= k[n - 1].u) return m[n - 1];
    const i = seg(u), t = (u - k[i].u) / h[i];
    return ((6 * t * t - 6 * t) * (k[i].p - k[i + 1].p)) / h[i] + (3 * t * t - 4 * t + 1) * m[i] + (3 * t * t - 2 * t) * m[i + 1];
  };
  const inverse = (p) => {                                    // 단조 함수라 이분 탐색으로 역함수
    let lo = k[0].u - 100, hi = k[n - 1].u + 100;
    for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (map(mid) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  return { map, slope, inverse };
}

/**
 * @param o.proVideo, o.userVideo  <video>
 * @param o.proCtl, o.userCtl      .vctl 컨테이너 (index.html)
 * @param o.modeSeg                재생 모드 버튼 묶음 (data-mode = solo | sync | match)
 * @param o.getSlowmo   () => 프로 영상 슬로모션 배율
 * @param o.getKnots    () => [{u: 사용자 시각, p: 프로 시각}, ...] 단계 순서대로 (분석 전이면 [])
 *                      sync 는 첫 단계(어드레스)만, match 는 전체 단계를 사용
 * @param o.onSyncMode     () => void  동기화 계열 모드로 바꿀 때 호출 (앱이 두 영상을 어드레스로 이동)
 * @param o.beforeSyncPlay () => void  동기화 재생 직전 호출 (단계 버튼으로 이동한 상태면 앱이 어드레스로 되돌림)
 */
export function createPlayer(o) {
  // index.html 이 예전 버전이면(재생 컨트롤 영역 없음) 재생 기능만 끄고 나머지 앱은 정상 동작하게 함
  if (!o.proCtl || !o.userCtl || !o.modeSeg) {
    console.warn('[player] 재생 컨트롤 영역(#proCtl, #userCtl, #modeSeg)이 없습니다. index.html 을 최신 버전으로 교체하고 Ctrl+Shift+R 로 새로고침하세요.');
    const noop = () => {};
    return { setReady: noop, lock: noop, pauseAll: () => { o.proVideo.pause(); o.userVideo.pause(); }, mode: 'solo', disabled: true };
  }
  const vids = { pro: o.proVideo, user: o.userVideo };
  const ctls = { pro: o.proCtl, user: o.userCtl };
  const speed = { pro: 1, user: 1 };
  const ready = { pro: false, user: false };
  let mode = 'solo', locked = false;
  let smoothRate = null, lastTick = 0;                          // 동작 맞춤: 완충된 프로 재생 속도
  const linked = () => mode !== 'solo';                          // 동기화 계열 (sync, match)

  const base = (who) => (who === 'pro' ? o.getSlowmo() : 1);       // 실제 속도로 보려면 곱할 값
  const applyRate = (who) => { vids[who].playbackRate = clampRate(speed[who] * base(who)); };
  const knots = () => o.getKnots().filter((k) => Number.isFinite(k.u) && Number.isFinite(k.p));
  const dur = (v) => (Number.isFinite(v.duration) ? v.duration : 0);

  /**
   * 지금 모드의 사용자 → 프로 대응 (분석 전이면 null)
   *  sync : 어드레스 기준 직선 (기울기 = 슬로모션 배율, 즉 정속)
   *  match: 전체 단계를 지나는 곡선
   */
  function mapping() {
    const k = knots(); if (!k.length) return null;
    const s = base('pro');
    if (mode === 'match' && k.length > 1) return buildCurve(k, s);
    const a = k[0];
    return { map: (u) => a.p + (u - a.u) * s, slope: () => s, inverse: (p) => a.u + (p - a.p) / s };
  }

  // ---- 배속 버튼 생성 ----
  for (const who of ['pro', 'user']) {
    const seg = ctls[who].querySelector('.speeds');
    seg.innerHTML = SPEEDS.map((s) => `<button data-speed="${s}" class="${s === 1 ? 'on' : ''}">${s}x</button>`).join('');
    seg.onclick = (e) => {
      const s = Number(e.target.dataset.speed); if (!s || locked) return;
      const targets = linked() ? ['pro', 'user'] : [who];        // 동기화 중엔 배속도 함께
      for (const w of targets) { speed[w] = s; applyRate(w); }
      paintSpeeds();
    };
    ctls[who].querySelector('[data-act=play]').onclick = () => togglePlay(who);
    ctls[who].querySelector('.seek').oninput = (e) => seek(who, (Number(e.target.value) / 1000) * dur(vids[who]));
  }

  o.modeSeg.onclick = (e) => {
    const m = e.target.dataset.mode; if (!m || m === mode) return;
    pauseAll(); mode = m;
    [...o.modeSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (linked()) { speed.pro = speed.user; applyRate('pro'); paintSpeeds(); o.onSyncMode?.(); alignPro(); }
    else applyRate('pro');
    refresh();
  };

  function paintSpeeds() {
    for (const who of ['pro', 'user']) {
      ctls[who].querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed[who]));
    }
  }

  /** 동기화: 지금 사용자 위치에 맞는 프로 위치로 이동 */
  function alignPro() {
    const mp = mapping(); if (!mp || !ready.pro) return;
    vids.pro.currentTime = Math.min(dur(vids.pro), Math.max(0, mp.map(vids.user.currentTime)));
  }

  function togglePlay(who) {
    if (locked) return;
    if (!linked()) {
      const v = vids[who]; if (!ready[who]) return;
      if (v.paused) { if (v.ended) v.currentTime = 0; applyRate(who); play(v); } else v.pause();
      return;
    }
    // 동기화 계열: 어느 쪽 버튼이든 둘 다
    if (!ready.user || !ready.pro) return;
    if (!vids.user.paused) return pauseAll();
    if (vids.user.ended) vids.user.currentTime = 0;
    o.beforeSyncPlay?.();
    alignPro(); applyRate('user'); applyRate('pro'); smoothRate = null;
    play(vids.user); play(vids.pro);
  }

  function seek(who, t) {
    if (locked || !ready[who]) return;
    vids[who].currentTime = t;
    if (!linked()) return;
    const mp = mapping();
    if (who === 'user') alignPro();
    else if (mp && ready.user) vids.user.currentTime = Math.max(0, Math.min(dur(vids.user), mp.inverse(t)));
  }

  function pauseAll() { vids.pro.pause(); vids.user.pause(); }

  /** 매 프레임: 동기화 보정 + 버튼/슬라이더/시간 표시 갱신 */
  function tick(now) {
    const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 1 / 60; lastTick = now;
    if (linked() && !vids.user.paused && !vids.user.ended) {
      const mp = mapping();
      if (mp) {
        const t = vids.user.currentTime, s = base('pro'), ur = vids.user.playbackRate;
        const target = mp.map(t);
        // 이 순간 프로가 가야 할 속도. 동작 맞춤은 곡선 기울기를 정속의 0.5~2배로 제한
        let want = ur * mp.slope(t);
        if (mode === 'match') want = Math.min(MATCH_MAX * ur * s, Math.max(MATCH_MIN * ur * s, want));
        const canSeek = !vids.pro.seeking;   // 이전 위치 이동이 끝난 뒤에만 다시 이동 (안 그러면 탐색이 끝나지 않음)
        if (target >= dur(vids.pro)) {                          // 프로 영상 끝 이후: 마지막 장면에서 대기
          vids.pro.pause();
          if (canSeek && dur(vids.pro) - vids.pro.currentTime > 0.05) vids.pro.currentTime = dur(vids.pro);
        } else if (target < 0) {                                // 프로 영상 시작 전: 0초에서 대기
          vids.pro.pause();
          if (canSeek && vids.pro.currentTime > 0.01) vids.pro.currentTime = 0;
        } else {
          if (vids.pro.paused) play(vids.pro);
          const err = target - vids.pro.currentTime;           // + 면 프로가 뒤처짐 (프로 영상 초)
          if (canSeek && Math.abs(err) > BIG_GAP * s) {
            // 크게 어긋났을 때만 위치 이동. 탐색 지연만큼 앞을 내다보고 이동
            vids.pro.currentTime = Math.min(dur(vids.pro), target + SEEK_LEAD * want);
            smoothRate = want; vids.pro.playbackRate = clampRate(want);
          } else {
            // 작은 어긋남은 속도로 메움 (뒤처지면 조금 빠르게, 앞서면 조금 느리게)
            const lim = (mode === 'match' ? MATCH_CATCH : SYNC_CATCH) * want;
            const rate = want + Math.max(-lim, Math.min(lim, CATCH_UP * err));
            if (mode === 'match') {
              // 속도 완충: 목표 속도로 서서히 다가감 → 단계가 바뀌어도 속도가 툭 바뀌지 않음
              smoothRate = smoothRate == null ? rate : smoothRate + (rate - smoothRate) * (1 - Math.exp(-dt / SMOOTH_TAU));
              vids.pro.playbackRate = clampRate(smoothRate);
            } else vids.pro.playbackRate = clampRate(rate);
          }
        }
      }
    }
    refresh();
    requestAnimationFrame(tick);
  }

  // 동기화 중 사용자 영상이 멈추거나 끝나면(ended 도 pause 이벤트를 냄) 프로 영상을 정확한 대응 위치로 맞춤
  vids.user.addEventListener('pause', () => { if (linked()) { vids.pro.pause(); alignPro(); } });

  function refresh() {
    for (const who of ['pro', 'user']) {
      const v = vids[who], c = ctls[who], d = dur(v);
      const playing = linked() ? !vids.user.paused : !v.paused;
      const okNow = ready[who] && (!linked() || (ready.pro && ready.user));
      const btn = c.querySelector('[data-act=play]');
      btn.textContent = playing ? '⏸' : '▶';
      btn.disabled = !okNow || locked;
      c.querySelectorAll('[data-speed]').forEach((b) => { b.disabled = !ready[who] || locked; });
      const seekEl = c.querySelector('.seek');
      seekEl.disabled = !okNow || locked;
      if (d && document.activeElement !== seekEl) seekEl.value = Math.round((v.currentTime / d) * 1000);
      c.querySelector('.time').textContent = `${v.currentTime.toFixed(2)}s / ${d ? d.toFixed(2) : '–'}s`;
    }
  }
  requestAnimationFrame(tick);

  return {
    /** 영상 준비 상태 (로딩 완료/해제) */
    setReady(who, ok) { ready[who] = ok; if (ok) applyRate(who); refresh(); },
    /** 분석 중 등에는 조작 잠금 */
    lock(on) { locked = on; if (on) pauseAll(); refresh(); },
    pauseAll,
    get mode() { return mode; },
  };
}
