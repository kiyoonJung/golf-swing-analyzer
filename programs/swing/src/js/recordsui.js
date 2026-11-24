/**
 * recordsui.js — 상단 "저장" / "내 기록" 버튼과 저장·목록·상세 창 (서버 담당 파일)
 * authui.js 와 같은 방식으로 스스로 화면에 붙는다. index.html 에서 authui.js 다음에 불러온다:
 *   <script type="module" src="src/js/recordsui.js"></script>
 * app.js 와는 이 약속으로만 연결된다 (app.js 의 수정 4곳):
 *   · 'swingfixer:analyzed' / 'swingfixer:reset' 이벤트 (분석 끝남 / 결과가 사라짐)
 *   · window.swingfixer.getSnapshot() → { club, view, stages, userFrames, aspect, size:{w,h}, video }
 * 규칙: 로그인한 사용자만 저장·불러오기. 게스트는 "로그인하면 저장할 수 있어요" 안내. 저장된 기록이 없으면 "내 기록"은 꺼짐.
 */
import * as A from './auth.js';
import * as R from './records.js';
import { buildFeedback, drawProSkeleton } from './ui.js';
import { CLUBS } from './clubs/index.js';

const EMBEDDED = window.parent !== window;
const CLUB_KR = (id) => CLUBS[id]?.label ?? id;
const VIEW_KR = { front: '정면', side: '측면' };
const $ = (sel, root = document) => root.querySelector(sel);

const state = { user: null, analyzed: false, records: 0, videos: 0, busy: false, view: 'save', detail: null };

// ---------- 화면 뼈대 ----------
const style = document.createElement('style');
style.textContent = `
  .recbar { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 8px; }
  dialog.recdlg { border:1px solid var(--line,#CBD3C4); border-radius:16px; background:var(--card,#fff); color:var(--ink,#17231B);
    padding:16px; width:min(480px, calc(100% - 20px)); max-height:calc(100vh - 20px); max-height:calc(100dvh - 20px); overflow:auto; font:inherit; box-shadow:0 10px 40px rgba(0,0,0,.35); }
  dialog.recdlg::backdrop { background:rgba(0,0,0,.5); }
  .recdlg h2 { margin:0 28px 10px 0; font-size:18px; }
  .recdlg .x { position:absolute; top:10px; right:12px; border:0; background:none; font-size:20px; color:var(--sub,#5B6B5F); cursor:pointer; }
  .recdlg .sub { font-size:13px; color:var(--sub,#5B6B5F); margin:0 0 10px; overflow-wrap:anywhere; }
  .recdlg label.f { display:block; font-size:13px; color:var(--sub,#5B6B5F); margin:8px 0; }
  .recdlg input[type=text] { display:block; width:100%; margin-top:4px; padding:10px; font-size:16px; border:1px solid var(--line,#CBD3C4); border-radius:10px; background:var(--bg,#fff); color:inherit; }
  .recdlg .vid { display:flex; gap:8px; align-items:flex-start; padding:10px; border:1px solid var(--line,#CBD3C4); border-radius:10px; font-size:14px; margin:10px 0; }
  .recdlg .vid input { margin-top:3px; width:18px; height:18px; }
  .recdlg .vid small { display:block; color:var(--sub,#5B6B5F); margin-top:2px; }
  .recdlg .row { display:flex; gap:8px; margin-top:10px; }
  .recdlg .row .btn { flex:1; }
  .recdlg .msg { min-height:1.4em; font-size:13px; margin-top:8px; overflow-wrap:anywhere; }
  .recdlg .msg.err { color:var(--bad,#E5383B); } .recdlg .msg.ok { color:var(--ok,#1FA64A); }
  .recdlg ul.list { list-style:none; margin:0; padding:0; }
  .recdlg li.item { display:flex; gap:6px; align-items:stretch; border-top:1px solid var(--line,#CBD3C4); padding:8px 0; }
  .recdlg li.item:first-child { border-top:0; }
  .recdlg .open { flex:1; text-align:left; border:0; background:none; color:inherit; font:inherit; cursor:pointer; padding:4px 2px; }
  .recdlg .open b { display:block; font-size:14px; } .recdlg .open span { display:block; font-size:12px; color:var(--sub,#5B6B5F); }
  .recdlg .tag { display:inline-block; font-size:11px; padding:1px 6px; border:1px solid var(--line,#CBD3C4); border-radius:999px; margin-left:4px; }
  .recdlg .tabs { display:flex; gap:4px; overflow-x:auto; margin:8px 0; padding-bottom:4px; }
  .recdlg .tabs button { flex:0 0 auto; border:1px solid var(--line,#CBD3C4); background:none; color:inherit; font:inherit; font-size:13px; padding:5px 10px; border-radius:999px; cursor:pointer; }
  .recdlg .tabs button.on { background:var(--turf,#2F6B3A); border-color:var(--turf,#2F6B3A); color:#fff; }
  .recdlg canvas.pose { display:block; width:100%; height:auto; max-height:50vh; max-height:50dvh; object-fit:contain; background:#0d1410; border-radius:10px; }
  .recdlg video { display:block; width:100%; max-height:50vh; max-height:50dvh; background:#000; border-radius:10px; margin-top:8px; }
  .recdlg .fb { margin-top:8px; padding:10px; border-left:4px solid var(--bad,#E5383B); background:rgba(127,127,127,.08); border-radius:6px; font-size:14px; }
  .recdlg .fb.ok { border-left-color:var(--ok,#1FA64A); } .recdlg .fb p { margin:0 0 4px; }
`;
document.head.appendChild(style);

const bar = document.createElement('div');
bar.className = 'recbar';
const saveBtn = Object.assign(document.createElement('button'), { className: 'btn sm', type: 'button', textContent: '💾 저장' });
const listBtn = Object.assign(document.createElement('button'), { className: 'btn sm', type: 'button', textContent: '📂 내 기록' });
bar.append(saveBtn, listBtn);
(document.querySelector('.topbar') ?? document.body).prepend(bar);

const dlg = document.createElement('dialog');
dlg.className = 'recdlg';
dlg.innerHTML = `<button type="button" class="x" aria-label="닫기">✕</button><h2></h2><div data-body></div><div class="msg" role="status" aria-live="polite"></div>`;
document.body.appendChild(dlg);
const body = $('[data-body]', dlg), msgEl = $('.msg', dlg), titleEl = $('h2', dlg);
$('.x', dlg).onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('close', () => { stopVideo(); });
const say = (t = '', kind = '') => { msgEl.textContent = t; msgEl.className = 'msg' + (kind ? ' ' + kind : ''); };
const btn = (text, cls = '') => Object.assign(document.createElement('button'), { type: 'button', className: ('btn ' + cls).trim(), textContent: text });
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
function stopVideo() { dlg.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load?.(); }); }

// ---------- 버튼 상태 ----------
function paint() {
  const signedIn = !!state.user;
  saveBtn.disabled = !state.analyzed;
  saveBtn.title = !state.analyzed ? '분석을 마친 뒤에 저장할 수 있어요' : signedIn ? '' : '로그인하면 저장할 수 있어요';
  // 게스트는 눌러서 안내를 볼 수 있게 켜 둔다. 로그인했는데 저장된 기록이 없으면 끈다.
  listBtn.disabled = signedIn && state.records === 0;
  listBtn.title = !signedIn ? '로그인하면 저장한 기록을 볼 수 있어요' : state.records === 0 ? '저장된 기록이 없어요' : '';
}
async function refreshCounts() {
  if (!state.user) { state.records = 0; state.videos = 0; paint(); return; }
  try { [state.records, state.videos] = await Promise.all([R.countRecords(), R.countVideos()]); } catch { /* 연결 문제면 이전 값 유지 */ }
  paint();
}

// ---------- 화면: 로그인 필요 ----------
function viewLogin(what) {
  state.view = 'login'; titleEl.textContent = '로그인이 필요해요'; say(); body.replaceChildren(
    el('p', { className: 'sub', textContent: `로그인하면 ${what}. 게스트는 분석만 할 수 있어요.` }),
    (() => {
      const b = btn('로그인하기', 'main');
      b.onclick = () => {
        dlg.close();
        if (EMBEDDED) window.parent.postMessage({ type: 'swingfixer:open-login' }, location.origin);   // 로그인 창은 껍데기(gate.js)가 연다
        else document.querySelector('.authbtn')?.click();                                              // 단독 실행: authui 의 로그인 버튼
      };
      return b;
    })());
}

// ---------- 화면: 저장 ----------
async function viewSave() {
  const snap = window.swingfixer?.getSnapshot?.();
  state.view = 'save'; titleEl.textContent = '분석 결과 저장'; say();
  if (!snap) { body.replaceChildren(el('p', { className: 'sub', textContent: '저장할 분석 결과가 없어요. 먼저 분석을 마쳐 주세요.' })); return; }

  const memo = el('input', { type: 'text', maxLength: 40, placeholder: '예: 연습장 3번 타석 (선택)' });
  const chk = el('input', { type: 'checkbox' });
  const chkText = el('span', {}, '영상도 함께 저장', el('small', { textContent: '확인하는 중…' }));
  chk.disabled = true;
  const save = btn('저장', 'main'), cancel = btn('취소');
  save.disabled = true;
  cancel.onclick = () => dlg.close();
  body.replaceChildren(
    el('p', { className: 'sub', textContent: `${CLUB_KR(snap.club)} · ${VIEW_KR[snap.view] ?? snap.view} · ${snap.stages.length}단계 · ${R.formatKST(new Date().toISOString())} (한국 시간)` }),
    el('label', { className: 'f' }, '메모', memo),
    el('label', { className: 'vid' }, chk, chkText),
    el('div', { className: 'row' }, cancel, save));

  let st = null;
  try { st = await R.videoStatus(snap.video); } catch (e) { st = { usable: false, reason: e.message, used: state.videos }; }
  const small = $('small', chkText);
  if (st.usable) {
    chk.disabled = false; chk.checked = true;
    small.textContent = `${R.formatMB(st.size)} · 내 영상 ${st.used}/${R.LIMITS.maxVideos}개 사용 중 (저장하면 ${st.used + 1}개)`;
  } else {
    chk.checked = false; chk.disabled = true;
    small.textContent = `${st.reason} 기록과 피드백만 저장돼요.`;
  }
  save.disabled = false;

  save.onclick = async () => {
    if (state.busy) return;
    state.busy = true; save.disabled = cancel.disabled = chk.disabled = true; say(chk.checked ? '저장하는 중… (영상 업로드는 시간이 걸릴 수 있어요)' : '저장하는 중…');
    try {
      const fresh = window.swingfixer.getSnapshot() ?? snap;   // 그 사이 단계 미세 조정을 했다면 최신 값으로
      const result = R.buildSavedResult(fresh, (stage) => buildFeedback(stage, fresh.view, CLUBS[fresh.club]));
      const out = await R.saveRecordWithVideo({ club: fresh.club, view: fresh.view, result, memo: memo.value.trim(), video: chk.checked ? fresh.video : null });
      say(`저장했어요.${out.videoSaved ? ' (영상 포함)' : ' (기록·피드백만)'}${out.note ? ' ' + out.note : ''}`, 'ok');
      cancel.textContent = '닫기'; cancel.disabled = false; save.hidden = true;
      refreshCounts();
    } catch (e) { say(e.message, 'err'); save.disabled = cancel.disabled = false; chk.disabled = !st.usable; }
    finally { state.busy = false; }
  };
}

// ---------- 화면: 목록 ----------
async function viewList() {
  state.view = 'list'; titleEl.textContent = '내 기록'; say('불러오는 중…'); body.replaceChildren();
  let rows;
  try { rows = await R.listMyRecords(); } catch (e) { say(e.message, 'err'); return; }
  state.records = rows.length; state.videos = rows.filter((r) => r.video_path).length; paint();
  if (!rows.length) { say(); body.replaceChildren(el('p', { className: 'sub', textContent: '저장된 기록이 없어요.' })); return; }
  say(`영상 ${state.videos}/${R.LIMITS.maxVideos}개 사용 중`);
  const ul = el('ul', { className: 'list' });
  for (const r of rows) {
    const open = el('button', { type: 'button', className: 'open' },
      el('b', { textContent: `${CLUB_KR(r.club)} · ${VIEW_KR[r.view] ?? r.view}` }),
      el('span', { textContent: `${R.formatKST(r.created_at)}${r.memo ? ' · ' + r.memo : ''}` }));
    if (r.video_path) open.firstChild.append(el('span', { className: 'tag', textContent: `영상 ${R.formatMB(r.video_size || 0)}` }));
    open.onclick = () => viewDetail(r.id);
    ul.append(el('li', { className: 'item' }, open, deleteButton(r, () => viewList())));
  }
  body.replaceChildren(ul);
}

/** 삭제 버튼: 한 번 누르면 "정말 삭제?"로 바뀌고, 3초 안에 한 번 더 누르면 삭제 */
function deleteButton(rec, after) {
  const b = btn('삭제', 'sm'); let armed = null;
  b.onclick = async () => {
    if (!armed) { b.textContent = '정말 삭제?'; armed = setTimeout(() => { armed = null; b.textContent = '삭제'; }, 3000); return; }
    clearTimeout(armed); armed = null; b.disabled = true; say('삭제하는 중…');
    try { await R.deleteRecordFull(rec); say('삭제했어요.', 'ok'); await refreshCounts(); await after(); }
    catch (e) { say(e.message, 'err'); b.disabled = false; b.textContent = '삭제'; }
  };
  return b;
}

// ---------- 화면: 상세 ----------
async function viewDetail(id) {
  state.view = 'detail'; titleEl.textContent = '기록 보기'; say('불러오는 중…'); body.replaceChildren();
  let rec;
  try { rec = await R.getRecordFull(id); } catch (e) { say(e.message, 'err'); return; }
  if (!rec) { say('기록을 찾을 수 없어요.', 'err'); return; }
  say();
  const res = rec.result ?? {};
  const stages = Array.isArray(res.stages) ? res.stages : [];
  const back = btn('← 목록', 'sm'); back.onclick = () => viewList();
  const head = el('p', { className: 'sub', textContent: `${CLUB_KR(rec.club)} · ${VIEW_KR[rec.view] ?? rec.view} · ${R.formatKST(rec.created_at)}${rec.memo ? ' · ' + rec.memo : ''}` });
  const hasPose = res.version >= 2 && stages.some((s) => s.lm);
  if (!hasPose) {   // 예전 방식(테스트 페이지)으로 저장된 기록: 자세·피드백이 없다
    body.replaceChildren(back, head, el('p', { className: 'sub', textContent: '자세 데이터가 없는 기록이에요. (테스트로 저장한 기록)' }),
      el('div', { className: 'row' }, deleteButton(rec, () => viewList())));
    return;
  }
  const tabs = el('div', { className: 'tabs', role: 'tablist' });
  const canvas = el('canvas', { className: 'pose' });
  const fb = el('div', { className: 'fb' });
  const vidBox = el('div');
  let video = null;
  const show = (i) => {
    const s = stages[i];
    [...tabs.children].forEach((t, k) => t.classList.toggle('on', k === i));
    if (s.lm) {
      const lm = s.lm.map(([x, y, visibility]) => ({ x, y, visibility }));
      const size = { videoWidth: res.size?.w || 360, videoHeight: res.size?.h || 640 };
      drawProSkeleton(canvas, size, lm, s, CLUBS[rec.club]?.threshold, rec.view);
    }
    fb.className = 'fb' + (s.feedback?.ok ? ' ok' : '');
    fb.replaceChildren(el('p', {}, el('strong', { textContent: s.name })),
      ...(s.feedback?.lines ?? ['저장된 피드백이 없어요.']).map((t) => el('p', { textContent: t })));
    if (video && Number.isFinite(s.userT)) { try { video.currentTime = s.userT; } catch { /* 아직 로딩 전 */ } }
  };
  stages.forEach((s, i) => { const t = el('button', { type: 'button', textContent: s.name }); t.onclick = () => show(i); tabs.append(t); });

  const actions = el('div', { className: 'row' });
  if (rec.video_path) {
    const v = btn(`영상 보기 (${R.formatMB(rec.video_size || 0)})`);
    v.onclick = async () => {
      v.disabled = true; say('영상을 불러오는 중…');
      try {
        const url = await R.getVideoUrl(rec.video_path);
        video = el('video', { controls: true, playsInline: true, preload: 'metadata', src: url });
        video.addEventListener('error', () => say('이 기기에서 재생할 수 없는 영상 형식일 수 있어요. 자세와 피드백은 위에서 확인할 수 있어요.', 'err'));
        vidBox.replaceChildren(video); say(); v.hidden = true;
        const cur = [...tabs.children].findIndex((t) => t.classList.contains('on')); if (cur >= 0) show(cur);
      } catch (e) { say(e.message, 'err'); v.disabled = false; }
    };
    actions.append(v);
  }
  actions.append(deleteButton(rec, () => viewList()));
  body.replaceChildren(back, head, tabs, canvas, fb, vidBox, actions);
  show(Math.max(0, stages.findIndex((s) => s.name === CLUBS[rec.club]?.defaultStage)));
}

// ---------- 열기 ----------
function open(viewFn) { say(); if (!dlg.open) dlg.showModal(); return viewFn(); }
saveBtn.onclick = () => open(() => (state.user ? viewSave() : viewLogin('분석 결과를 저장할 수 있어요')));
listBtn.onclick = () => open(() => (state.user ? viewList() : viewLogin('저장한 기록을 볼 수 있어요')));

// ---------- 상태 연결 ----------
document.addEventListener('swingfixer:analyzed', () => { state.analyzed = true; paint(); });
document.addEventListener('swingfixer:reset', () => { state.analyzed = false; paint(); });
A.onAuthChange((_e, user) => { state.user = user; refreshCounts(); });
A.getCurrentUser().then((u) => { state.user = u; refreshCounts(); }).catch(() => paint());
paint();
