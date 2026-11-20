/**
 * gate.js — 첫 화면 로그인 창(게이트)  [B 단계 · 서버 담당 파일]
 *
 * 앱을 켜면 홈 화면보다 먼저 로그인 창이 뜬다. 로그인하거나 "게스트로 시작"을 눌러야 홈 화면이 보인다.
 *  - 이미 로그인된 상태(저장된 세션)이거나 이 탭에서 게스트를 골랐다면 창 없이 바로 통과한다.
 *  - <html data-gate>  pending(확인 중, 화면 가림) → locked(로그인 창, 화면 가림) | open(화면 보임)
 *  - 게스트 A: 서버 계정을 만들지 않는다. 분석만 가능하고 저장은 안 된다. 선택은 "탭을 닫을 때까지"(sessionStorage) 기억.
 *  - 서버(CDN)에 연결하지 못하거나 5초 안에 확인이 안 끝나면 게스트로 그냥 연다 (앱이 잠기지 않게).
 *    이 파일 자체를 못 불러오는 경우는 index.html <head> 의 8초 안전장치가 화면을 연다.
 *  - 스윙 분석(iframe) 안의 로그인 버튼이 postMessage 로 "swingfixer:open-login" 을 보내면 닫을 수 있는 로그인 창을 다시 연다.
 *    로그아웃하면("swingfixer:signed-out" 또는 SIGNED_OUT) 홈으로 돌아가 로그인 창을 다시 띄운다.
 *  - 비밀번호 재설정 메일 링크는 이 화면(껍데기)으로 돌아온다 → 여기서 "새 비밀번호 설정"을 처리한다.
 *  - 로그인 상태가 바뀌면 document 에 'swingfixer:user' 이벤트(detail.user, detail.guest)를 보낸다.
 *  - 소셜 로그인: 카카오는 연결됨(이메일 없이 닉네임·프사만). 구글은 보류 — 자리만 있고 비활성.
 * 서버 모듈은 스윙 쪽 파일을 그대로 쓴다(복사본을 만들지 않으려고): ../programs/swing/src/js/auth.js
 */
(async () => {
  const root = document.documentElement;
  const GUEST_KEY = 'swingfixer:guest';
  const MIN_PW = 6;           // Supabase 기본 최소 비밀번호 길이
  const MAIL_COOLDOWN = 60;   // 재설정 메일 연속 요청 방지(초)
  const SESSION_WAIT = 5000;  // 이 시간(ms) 안에 세션 확인이 안 끝나면 게스트로 연다

  const guestFlag = {
    get() { try { return sessionStorage.getItem(GUEST_KEY) === '1'; } catch { return false; } },
    set() { try { sessionStorage.setItem(GUEST_KEY, '1'); } catch { /* 무시 */ } },
    clear() { try { sessionStorage.removeItem(GUEST_KEY); } catch { /* 무시 */ } },
  };
  const setGate = (v) => { root.dataset.gate = v; };
  const emit = (user) => {
    document.dispatchEvent(new CustomEvent('swingfixer:user', { detail: { user, guest: !user && guestFlag.get() } }));
    // 열려 있는 프로그램(iframe)에도 알려서 안쪽 로그인 버튼을 갱신하게 한다
    document.querySelectorAll('iframe').forEach((f) => { try { f.contentWindow.postMessage({ type: 'swingfixer:auth-changed' }, location.origin); } catch { /* 무시 */ } });
  };

  let settled = false;       // 첫 판단(통과/잠금)이 끝났는지
  let dlg = null;
  const state = { user: null, view: 'login', dismissible: false, recovering: false };
  let mailUntil = 0, mailTimer = null;
  // 카카오 등에서 돌아왔는데 실패한 경우 주소에 error_description 이 붙어 온다 → 로그인 창에 보여준다
  let oauthError = '';
  try {
    const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const d = q.get('error_description') || h.get('error_description');
    if (d) { oauthError = '소셜 로그인에 실패했어요: ' + d.replace(/\+/g, ' '); history.replaceState(null, '', location.pathname); }
  } catch { /* 무시 */ }

  const failOpen = setTimeout(() => { if (!settled) { settled = true; setGate('open'); } }, SESSION_WAIT);
  const openApp = () => { settled = true; clearTimeout(failOpen); if (dlg?.open) dlg.close(); setGate('open'); };

  // 재설정 메일 링크로 들어왔는지(해시/쿼리에 type=recovery) — SIGNED_IN 이 먼저 오기 때문에 미리 알아둔다
  state.recovering = /type=recovery/.test(location.hash + location.search);

  // ---------- 서버 모듈 ----------
  let A;
  try { A = await import('../programs/swing/src/js/auth.js'); }
  catch (e) {
    console.warn('[gate] 서버 모듈을 불러오지 못해 게스트로 엽니다:', e);
    settled = true; clearTimeout(failOpen); setGate('open'); emit(null);
    return;
  }

  // ---------- 스타일 (껍데기 style.css 의 색 변수 사용, 없으면 기본색) ----------
  const style = document.createElement('style');
  style.textContent = `
    html[data-gate="pending"] #app, html[data-gate="locked"] #app { visibility:hidden; }
    dialog.gatedlg { border:1px solid var(--line,#CBD3C4); border-radius:16px; background:var(--card,#fff); color:var(--ink,#17231B);
      padding:20px; width:min(420px, calc(100% - 24px)); max-height:calc(100vh - 24px); max-height:calc(100dvh - 24px); overflow:auto;
      box-shadow:0 10px 40px rgba(0,0,0,.35); font:inherit; }
    dialog.gatedlg::backdrop { background:var(--bg,#EEF1E8); }
    .gatedlg.soft::backdrop { background:rgba(0,0,0,.5); }
    .gatedlg h2 { margin:0 0 4px; font-size:20px; letter-spacing:-.02em; }
    .gatedlg .brandsub { margin:0 0 14px; font-size:13px; color:var(--sub,#5B6B5F); }
    .gatedlg label { display:block; font-size:13px; color:var(--sub,#5B6B5F); margin-bottom:8px; }
    .gatedlg input { display:block; width:100%; box-sizing:border-box; margin-top:4px; padding:11px 10px; font-size:16px;
      border:1px solid var(--line,#CBD3C4); border-radius:10px; background:var(--bg,#fff); color:var(--ink,#17231B); }
    .gatedlg .g-btn { display:block; width:100%; box-sizing:border-box; margin-top:8px; padding:12px; font:inherit; font-size:15px; border-radius:10px;
      border:1px solid var(--line,#CBD3C4); background:transparent; color:var(--ink,#17231B); cursor:pointer; }
    .gatedlg .g-btn.main { background:var(--accent,#2F6B3A); color:var(--on,#fff); border-color:transparent; font-weight:600; }
    .gatedlg .g-btn:disabled { opacity:.5; cursor:not-allowed; }
    .gatedlg .links { display:flex; justify-content:space-between; gap:8px; margin-top:10px; }
    .gatedlg .link { border:0; background:none; color:var(--accent,#2F6B3A); font:inherit; font-size:13px; cursor:pointer; padding:6px 2px; text-decoration:underline; }
    .gatedlg .sub { font-size:13px; color:var(--sub,#5B6B5F); margin:0 0 10px; }
    .gatedlg .or { text-align:center; font-size:12px; color:var(--sub,#5B6B5F); margin:14px 0 2px; }
    .gatedlg .hint { font-size:12px; color:var(--sub,#5B6B5F); text-align:center; margin:6px 0 0; }
    .gatedlg .msg { min-height:1.4em; font-size:13px; margin-top:8px; overflow-wrap:anywhere; }
    .gatedlg .msg.err { color:#E5383B; } .gatedlg .msg.ok { color:#1FA64A; }
    .gatedlg .x { float:right; border:0; background:none; color:var(--sub,#5B6B5F); font-size:18px; cursor:pointer; }
  `;
  document.head.appendChild(style);

  const field = (label, name, type, auto) =>
    `<label>${label}<input name="${name}" type="${type}" autocomplete="${auto}" required${type === 'email' ? ' inputmode="email"' : ''}></label>`;

  const VIEWS = {
    login: () => `<form data-form="login" novalidate>
        ${field('이메일', 'email', 'email', 'email')}
        ${field('비밀번호', 'password', 'password', 'current-password')}
        <button class="g-btn main" type="submit">로그인</button>
      </form>
      <div class="links">
        <button type="button" class="link" data-go="signup">회원가입</button>
        <button type="button" class="link" data-go="forgot">비밀번호를 잊으셨나요?</button>
      </div>
      <div class="or">또는</div>
      <button type="button" class="g-btn" disabled title="준비 중">Google로 계속 (준비 중)</button>
      <button type="button" class="g-btn" data-kakao>카카오로 계속</button>
      <button type="button" class="g-btn" data-guest>${state.dismissible ? '게스트로 계속' : '게스트로 시작'}</button>
      <p class="hint">게스트는 분석만 할 수 있고 기록은 저장되지 않아요.</p>`,
    signup: () => `<form data-form="signup" novalidate>
        ${field('이메일', 'email', 'email', 'email')}
        ${field(`비밀번호 (${MIN_PW}자 이상)`, 'password', 'password', 'new-password')}
        ${field('비밀번호 확인', 'password2', 'password', 'new-password')}
        <button class="g-btn main" type="submit">가입하기</button>
      </form>
      <div class="links"><button type="button" class="link" data-go="login">이미 계정이 있어요 (로그인)</button></div>`,
    forgot: () => `<p class="sub">가입한 이메일로 비밀번호 재설정 링크를 보내드려요. 메일이 안 보이면 스팸함도 확인해 주세요.</p>
      <form data-form="forgot" novalidate>
        ${field('이메일', 'email', 'email', 'email')}
        <button class="g-btn main" type="submit" data-mailbtn>재설정 메일 보내기</button>
      </form>
      <div class="links"><button type="button" class="link" data-go="login">로그인으로 돌아가기</button></div>`,
    recover: () => `<p class="sub">재설정 링크로 들어오셨어요. 새 비밀번호를 정해 주세요.</p>
      <form data-form="recover" novalidate>
        ${field(`새 비밀번호 (${MIN_PW}자 이상)`, 'password', 'password', 'new-password')}
        ${field('새 비밀번호 확인', 'password2', 'password', 'new-password')}
        <button class="g-btn main" type="submit">비밀번호 저장</button>
      </form>`,
  };
  const TITLES = { login: '로그인', signup: '회원가입', forgot: '비밀번호 찾기', recover: '새 비밀번호 설정' };

  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'gatedlg';
    dlg.setAttribute('aria-labelledby', 'gateTitle');
    dlg.innerHTML = `<button type="button" class="x" data-close aria-label="닫기" hidden>✕</button>
      <h2 id="gateTitle"></h2><p class="brandsub">스윙픽서</p><div data-body></div>
      <div class="msg" role="status" aria-live="polite" data-msg></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', (e) => { if (!state.dismissible) e.preventDefault(); });   // 첫 화면 창은 Esc 로 못 닫음
    dlg.addEventListener('click', (e) => { if (e.target === dlg && state.dismissible) dlg.close(); });
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.addEventListener('submit', onSubmit);
    dlg.addEventListener('click', onClick);
    return dlg;
  }
  const $ = (sel) => dlg.querySelector(sel);
  const say = (t = '', kind = '') => { const m = $('[data-msg]'); m.textContent = t; m.className = 'msg' + (kind ? ' ' + kind : ''); };

  function render(view, msg = '', kind = '') {
    state.view = view;
    $('#gateTitle').textContent = TITLES[view];
    $('[data-body]').innerHTML = VIEWS[view]();
    $('[data-close]').hidden = !state.dismissible;
    dlg.classList.toggle('soft', state.dismissible);
    say(msg, kind);
    if (view === 'forgot') tickMail();
    $('[data-body] input')?.focus();
    if (view === 'login' && !msg && oauthError) { say(oauthError, 'err'); oauthError = ''; }
  }

  /** hard=true: 닫을 수 없는 첫 화면 창(화면 가림). hard=false: 닫을 수 있는 창(스윙 안 "로그인" 버튼에서) */
  function showGate({ view = 'login', hard = true } = {}) {
    ensureDialog();
    state.dismissible = !hard;
    if (hard) setGate('locked');
    render(view);
    if (!dlg.open) dlg.showModal();
  }

  function tickMail() {
    clearInterval(mailTimer);
    const b = $('[data-mailbtn]');
    if (!b) return;
    const paint = () => {
      const left = Math.ceil((mailUntil - Date.now()) / 1000);
      if (left > 0) { b.disabled = true; b.textContent = `다시 보내기 (${left}초)`; }
      else { b.disabled = false; b.textContent = '재설정 메일 보내기'; clearInterval(mailTimer); }
    };
    paint();
    if (mailUntil > Date.now()) mailTimer = setInterval(paint, 500);
  }

  // ---------- 폼 동작 ----------
  const val = (f, n) => f.elements[n].value;
  const needPassword = (pw, pw2) => {
    if (pw.length < MIN_PW) throw new Error(`비밀번호는 ${MIN_PW}자 이상이어야 해요.`);
    if (pw !== pw2) throw new Error('비밀번호 확인이 일치하지 않아요.');
  };
  const ACTIONS = {
    async login(f) { await A.signIn(val(f, 'email'), val(f, 'password')); /* 성공하면 onAuthChange 가 창을 닫고 화면을 연다 */ },
    async signup(f) {
      needPassword(val(f, 'password'), val(f, 'password2'));
      const { needsConfirm } = await A.signUp(val(f, 'email'), val(f, 'password'));
      if (needsConfirm) say('가입 요청을 보냈어요. 메일의 인증 링크를 누른 뒤 로그인해 주세요.', 'ok');
    },
    async forgot(f) {
      await A.sendPasswordReset(val(f, 'email'));
      mailUntil = Date.now() + MAIL_COOLDOWN * 1000;
      say('재설정 메일을 보냈어요. 메일의 링크를 이 브라우저에서 열어 주세요.', 'ok');
    },
    async recover(f) {
      needPassword(val(f, 'password'), val(f, 'password2'));
      await A.setNewPassword(val(f, 'password'));
      state.recovering = false;
      try { history.replaceState(null, '', location.pathname); } catch { /* 무시 */ }
      guestFlag.clear(); openApp(); emit(state.user);
    },
  };

  async function onSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const submit = form.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    say('');
    try { await ACTIONS[form.dataset.form](form); }
    catch (err) { say(err.message, 'err'); }
    finally {
      if (form.dataset.form === 'forgot') tickMail();
      else if (submit.isConnected) submit.disabled = false;
    }
  }

  async function onClick(e) {
    const go = e.target.closest('[data-go]');
    if (go) return render(go.dataset.go);
    if (e.target.closest('[data-kakao]')) {
      const b = e.target.closest('[data-kakao]');
      b.disabled = true; say('카카오로 이동하는 중…');
      try { await A.signInWithKakao(); }   // 성공하면 카카오 화면으로 이동한다
      catch (err) { say(err.message, 'err'); b.disabled = false; }
      return;
    }
    if (e.target.closest('[data-guest]')) {
      guestFlag.set(); openApp(); emit(null);
    }
  }

  // ---------- 로그인 상태 변화 ----------
  function lockAfterSignOut() {
    if (guestFlag.get()) return;
    if (location.hash) location.hash = '';          // 열려 있던 프로그램(카메라 포함)을 닫고 홈으로
    if (dlg?.open && !state.dismissible) return;    // 이미 첫 화면 창이 떠 있음
    showGate({ view: 'login', hard: true });
  }

  A.onAuthChange((event, user) => {
    state.user = user;
    root.dataset.signedIn = user ? 'true' : 'false';
    emit(user);
    if (event === 'PASSWORD_RECOVERY') { state.recovering = true; showGate({ view: 'recover', hard: true }); return; }
    if (user && !state.recovering) { guestFlag.clear(); openApp(); return; }
    if (!user && event === 'SIGNED_OUT') lockAfterSignOut();
  });

  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const t = e.data && e.data.type;
    if (t === 'swingfixer:open-login') showGate({ view: 'login', hard: false });
    else if (t === 'swingfixer:signed-out') lockAfterSignOut();
  });

  // ---------- 첫 판단 ----------
  try {
    const u = await A.getCurrentUser();
    if (settled) return;                              // 5초 안에 못 끝나 이미 게스트로 열림
    if (state.recovering) return;                     // PASSWORD_RECOVERY 이벤트가 창을 띄운다
    if (u || guestFlag.get()) { state.user = u; root.dataset.signedIn = u ? 'true' : 'false'; openApp(); emit(u); }
    else showGate({ view: 'login', hard: true });
  } catch (e) {
    console.warn('[gate] 세션 확인 실패, 게스트로 엽니다:', e);
    settled = true; clearTimeout(failOpen); setGate('open'); emit(null);
  }
})();