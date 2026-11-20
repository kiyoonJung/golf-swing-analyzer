/**
 * authui.js — 로그인 화면 + 첫 화면 로그인 창(게이트) (서버 담당 파일)
 * index.html 맨 아래의 이 한 줄이 화면 오른쪽 위 "로그인" 버튼과 로그인 창을 만든다:
 *     <script type="module" src="src/js/authui.js"></script>
 *
 * [B 단계: 첫 화면 게이트]
 * - 접속하면 닫을 수 없는 로그인 창이 먼저 뜬다. 로그인하거나 "게스트로 시작"을 눌러야 분석 화면이 보인다.
 * - 이미 로그인된 상태(저장된 세션)면 창 없이 바로 통과한다.
 * - 세션을 확인하는 동안(<html data-gate="pending">) 분석 화면은 index.html <head> 의 스타일이 가려 둔다.
 *   data-gate 값: pending(확인 중) → locked(로그인 창, 화면 가림) | open(화면 보임)
 * - 서버(CDN)에 연결하지 못하거나 5초 안에 세션 확인이 안 끝나면 자동으로 게스트로 연다 (앱이 잠기지 않게).
 *   authui.js 자체를 못 불러오는 경우는 index.html <head> 의 8초 안전장치가 화면을 연다.
 * - 게스트 A: 서버 계정을 만들지 않는다. 분석만 가능, 저장 불가. 게스트 선택은 "탭을 닫을 때까지"(sessionStorage) 기억한다.
 *   저장 버튼 등에서 가입을 안내하려면: document.dispatchEvent(new CustomEvent('swingfixer:need-login'))
 * - 로그인 상태가 바뀌면 document 에 'swingfixer:user' 이벤트(detail.user = 사용자 또는 null, detail.guest = 게스트로 쓰는 중인지)를 보낸다.
 *   (<html data-signed-in="true|false"> 도 갱신)
 * - 비밀번호 재설정 메일 링크로 돌아오면(PASSWORD_RECOVERY) 이 창에서 "새 비밀번호 설정"을 처리한다.
 * - 소셜 로그인(구글·카카오) 버튼은 자리만 있고 비활성이다. D 단계에서 연결한다.
 */
(async () => {
  const MIN_PW = 6;           // Supabase 기본 최소 비밀번호 길이
  const MAIL_COOLDOWN = 60;   // 재설정 메일은 연속으로 누르지 못하게 60초 대기 (메일 한도 보호)
  const SESSION_WAIT = 5000;  // 세션 확인을 이만큼(ms) 기다려도 안 끝나면 게스트로 연다
  const GUEST_KEY = 'swingfixer:guest';
  const root = document.documentElement;

  // ---------- 게스트 선택 기억 (저장소를 못 쓰는 환경이어도 오류 없이 동작) ----------
  const guestFlag = {
    get() { try { return sessionStorage.getItem(GUEST_KEY) === '1'; } catch { return false; } },
    set() { try { sessionStorage.setItem(GUEST_KEY, '1'); } catch { /* 무시 */ } },
    clear() { try { sessionStorage.removeItem(GUEST_KEY); } catch { /* 무시 */ } },
  };

  // ---------- 스타일 (style.css 의 색 변수를 그대로 사용, 없으면 기본색) ----------
  const style = document.createElement('style');
  style.textContent = `
    .authbar { display:flex; justify-content:flex-end; margin:0 0 4px; }
    .authbtn { max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    dialog.authdlg { border:1px solid var(--line,#CBD3C4); border-radius:14px; background:var(--card,#fff); color:var(--ink,#17231B);
      padding:16px; width:min(420px, calc(100% - 24px)); max-height:calc(100vh - 24px); max-height:calc(100dvh - 24px); overflow:auto;
      box-shadow:0 10px 40px rgba(0,0,0,.35); font-family:inherit; }
    dialog.authdlg::backdrop { background:rgba(0,0,0,.5); }
    dialog.authdlg.gate::backdrop { background:var(--bg,#EEF1E8); }
    .authdlg.gate [data-close] { display:none; }
    .authdlg .hd { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .authdlg h3 { margin:0; font-size:17px; }
    .authdlg label { display:block; font-size:13px; color:var(--sub,#5B6B5F); margin-bottom:8px; }
    .authdlg input { display:block; width:100%; margin-top:4px; padding:10px; border:1px solid var(--line,#CBD3C4); border-radius:8px;
      background:transparent; color:var(--ink,#17231B); font-size:16px; font-family:inherit; }
    .authdlg .btn.main { width:100%; margin-top:4px; }
    .authdlg .links { display:flex; justify-content:space-between; gap:8px; margin-top:10px; }
    .authdlg .link { border:0; background:none; color:var(--turf,#2F6B3A); font-size:13px; cursor:pointer; padding:6px 2px; text-decoration:underline; font-family:inherit; }
    .authdlg .msg { min-height:1.4em; font-size:13px; margin-top:8px; overflow-wrap:anywhere; }
    .authdlg .msg.err { color:var(--bad,#E5383B); }
    .authdlg .msg.ok { color:var(--ok,#1FA64A); }
    .authdlg .acct { font-size:14px; margin-bottom:6px; overflow-wrap:anywhere; }
    .authdlg .sub { font-size:13px; color:var(--sub,#5B6B5F); margin:0 0 10px; }
    .authdlg hr { border:0; border-top:1px solid var(--line,#CBD3C4); margin:12px 0; }
    .authdlg .social { display:flex; gap:8px; margin-top:12px; }
    .authdlg .social .btn { flex:1 1 0; }
    .authdlg .soon { font-size:12px; color:var(--sub,#5B6B5F); margin:6px 0 0; text-align:center; }
    .authdlg .guest { margin-top:12px; }
    .authdlg .guest .btn { width:100%; }
    .authdlg .guest small { display:block; margin-top:6px; font-size:12px; color:var(--sub,#5B6B5F); text-align:center; }
  `;
  document.head.appendChild(style);

  // ---------- 상단 버튼 ----------
  const bar = document.createElement('div');
  bar.className = 'authbar';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm authbtn';
  btn.textContent = '로그인';
  bar.appendChild(btn);
  (document.querySelector('.topbar') ?? document.body).prepend(bar);

  // ---------- 서버 모듈 불러오기 (실패하면 게스트로 열어 프로그램 본체는 정상 동작) ----------
  let A;
  try {
    A = await import('./auth.js');
  } catch {
    btn.textContent = '로그인 불가';
    btn.disabled = true;
    btn.title = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
    root.dataset.gate = 'open';
    root.dataset.signedIn = 'false';
    document.dispatchEvent(new CustomEvent('swingfixer:user', { detail: { user: null, guest: true } }));
    return;
  }

  // ---------- 상태 ----------
  const state = { user: null, view: 'login', gate: root.dataset.gate || 'pending' };
  let mailUntil = 0;     // 재설정 메일을 다시 보낼 수 있는 시각(ms)
  let mailTimer = null;
  let waitTimer = null;  // 세션 확인 제한 시간

  const locked = () => state.gate === 'locked';

  // ---------- 창(dialog) 뼈대 ----------
  const dlg = document.createElement('dialog');
  dlg.className = 'authdlg';
  dlg.setAttribute('aria-labelledby', 'authTitle');
  dlg.innerHTML = `
    <div class="hd"><h3 id="authTitle"></h3><button type="button" class="btn sm" data-close aria-label="닫기">✕</button></div>
    <div data-body></div>
    <div class="msg" role="status" aria-live="polite" data-msg></div>`;
  document.body.appendChild(dlg);
  const $title = dlg.querySelector('#authTitle');
  const $body = dlg.querySelector('[data-body]');
  const $msg = dlg.querySelector('[data-msg]');

  const say = (text = '', kind = '') => { $msg.textContent = text; $msg.className = 'msg' + (kind ? ' ' + kind : ''); };

  const field = (label, name, type, auto) =>
    `<label>${label}<input name="${name}" type="${type}" autocomplete="${auto}" required${type === 'email' ? ' inputmode="email"' : ''}></label>`;

  // 소셜 로그인 자리 (D 단계에서 연결). 지금은 비활성
  const SOCIAL = `<div class="social">
      <button type="button" class="btn" disabled>Google</button>
      <button type="button" class="btn" disabled>카카오</button>
    </div>
    <p class="soon">소셜 로그인은 준비 중이에요.</p>`;
  // 게스트 시작 (게이트 상태에서만 표시)
  const GUEST = `<div class="guest">
      <button type="button" class="btn" data-start-guest>게스트로 시작</button>
      <small>분석만 할 수 있고, 기록은 저장되지 않아요.</small>
    </div>`;

  const VIEWS = {
    login: {
      title: '로그인',
      html: `<form data-form="login" novalidate>
          ${field('이메일', 'email', 'email', 'email')}
          ${field('비밀번호', 'password', 'password', 'current-password')}
          <button class="btn main" type="submit">로그인</button>
        </form>
        <div class="links">
          <button type="button" class="link" data-go="signup">회원가입</button>
          <button type="button" class="link" data-go="forgot">비밀번호를 잊으셨나요?</button>
        </div>
        ${SOCIAL}`,
    },
    signup: {
      title: '회원가입',
      html: `<form data-form="signup" novalidate>
          ${field('이메일', 'email', 'email', 'email')}
          ${field(`비밀번호 (${MIN_PW}자 이상)`, 'password', 'password', 'new-password')}
          ${field('비밀번호 확인', 'password2', 'password', 'new-password')}
          <button class="btn main" type="submit">가입하기</button>
        </form>
        <div class="links"><button type="button" class="link" data-go="login">이미 계정이 있어요 (로그인)</button></div>`,
    },
    forgot: {
      title: '비밀번호 찾기',
      html: `<p class="sub">가입한 이메일로 비밀번호 재설정 링크를 보내드려요. 메일이 안 보이면 스팸함도 확인해 주세요.</p>
        <form data-form="forgot" novalidate>
          ${field('이메일', 'email', 'email', 'email')}
          <button class="btn main" type="submit" data-mailbtn>재설정 메일 보내기</button>
        </form>
        <div class="links"><button type="button" class="link" data-go="login">로그인으로 돌아가기</button></div>`,
    },
    recover: {
      title: '새 비밀번호 설정',
      html: `<p class="sub">재설정 링크로 들어오셨어요. 새 비밀번호를 정해 주세요.</p>
        <form data-form="recover" novalidate>
          ${field(`새 비밀번호 (${MIN_PW}자 이상)`, 'password', 'password', 'new-password')}
          ${field('새 비밀번호 확인', 'password2', 'password', 'new-password')}
          <button class="btn main" type="submit">비밀번호 저장</button>
        </form>`,
    },
    account: {
      title: '내 계정',
      html: `<div class="acct" data-acct></div>
        <hr>
        <form data-form="change" novalidate>
          ${field('현재 비밀번호', 'current', 'password', 'current-password')}
          ${field(`새 비밀번호 (${MIN_PW}자 이상)`, 'password', 'password', 'new-password')}
          ${field('새 비밀번호 확인', 'password2', 'password', 'new-password')}
          <button class="btn main" type="submit">비밀번호 변경</button>
        </form>
        <hr>
        <button type="button" class="btn" data-signout style="width:100%">로그아웃</button>`,
    },
  };

  function render(view, msg = '', kind = '') {
    state.view = view;
    $title.textContent = VIEWS[view].title;
    // 게이트(첫 화면 잠금) 상태에서는 로그인/가입/비밀번호 찾기 창 아래에 게스트 시작 버튼을 붙인다
    const withGuest = locked() && ['login', 'signup', 'forgot'].includes(view);
    $body.innerHTML = (locked() && view === 'login' ? '<p class="sub">로그인하거나 게스트로 시작하세요.</p>' : '')
      + VIEWS[view].html + (withGuest ? GUEST : '');
    say(msg, kind);
    if (view === 'account') $body.querySelector('[data-acct]').textContent = state.user?.email ?? '';
    if (view === 'forgot') tickMailButton();
    // 첫 입력칸에 커서 (모바일에서 키보드가 바로 뜨는 것이 번거로우면 이 줄을 지우세요)
    $body.querySelector('input')?.focus();
  }

  function open(view, msg, kind) { render(view, msg, kind); if (!dlg.open) dlg.showModal(); }
  // 잠긴 동안(첫 화면 게이트)에는 닫히지 않는다
  const close = () => { if (dlg.open && !locked()) dlg.close(); };

  // ---------- 게이트 ----------
  /** pending | locked | open — <html data-gate> 와 창 모양(✕ 숨김, 배경 가림)을 함께 바꾼다 */
  function setGate(g) {
    state.gate = g;
    root.dataset.gate = g;
    dlg.classList.toggle('gate', g === 'locked');
    if (g !== 'pending') { clearTimeout(waitTimer); waitTimer = null; }
  }
  /** 분석 화면을 보여 주되 로그인하지 않은 상태 */
  function startGuest() {
    guestFlag.set();
    setGate('open');
    if (dlg.open) dlg.close();
    announce();
  }
  /** 로그인 창을 잠근 채로 띄움 (로그인 또는 게스트 선택 전까지 분석 화면을 가림) */
  function lockWithLogin() { setGate('locked'); open('login'); }

  // ESC 로 닫으려 하면 막고, 그래도 닫혔다면(브라우저에 따라 ESC 를 연속으로 누르면 취소가 안 됨) 바로 다시 띄운다
  dlg.addEventListener('cancel', (e) => { if (locked()) e.preventDefault(); });
  dlg.addEventListener('close', () => { if (locked()) setTimeout(() => { if (locked() && !dlg.open) dlg.showModal(); }, 0); });

  // 재설정 메일 버튼: 보낸 뒤 60초 동안은 "다시 보내기 (n초)" 로 잠금
  function tickMailButton() {
    clearInterval(mailTimer);
    const b = $body.querySelector('[data-mailbtn]');
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
  const val = (form, name) => form.elements[name].value;
  function needPassword(pw, pw2) {
    if (pw.length < MIN_PW) throw new Error(`비밀번호는 ${MIN_PW}자 이상이어야 해요.`);
    if (pw !== pw2) throw new Error('비밀번호 확인이 일치하지 않아요.');
  }

  const ACTIONS = {
    async login(f) { await A.signIn(val(f, 'email'), val(f, 'password')); /* 성공하면 아래 onAuthChange 가 창을 닫음 */ },
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
      render('account', '새 비밀번호로 바꿨어요.', 'ok');
    },
    async change(f) {
      needPassword(val(f, 'password'), val(f, 'password2'));
      await A.changePassword(val(f, 'current'), val(f, 'password'));
      f.reset();
      say('비밀번호를 변경했어요.', 'ok');
    },
  };

  $body.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const submit = form.querySelector('[type=submit]');
    const lockedBefore = submit.disabled;
    if (lockedBefore) return;
    submit.disabled = true;          // 연속 클릭으로 같은 요청이 여러 번 가지 않게
    say('');
    try { await ACTIONS[form.dataset.form](form); }
    catch (err) { say(err.message, 'err'); }
    finally {
      if (form.dataset.form === 'forgot') tickMailButton();
      else if (submit.isConnected) submit.disabled = false;
    }
  });

  $body.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go) return render(go.dataset.go);
    if (e.target.closest("[data-start-guest]")) return startGuest();
    if (e.target.closest('[data-signout]')) {
      // 로그아웃하면 아래 onAuthChange(SIGNED_OUT) 가 첫 화면 로그인 창으로 되돌린다
      try { await A.signOut(); } catch (err) { say(err.message, 'err'); }
    }
  });
  dlg.querySelector('[data-close]').onclick = close;
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });   // 창 바깥(어두운 곳)을 누르면 닫힘 (잠긴 동안은 무시)

  // ---------- 상단 버튼 ----------
  function paintButton() {
    const u = state.user;
    if (u) {
      const name = (u.email || '').split('@')[0];
      btn.textContent = '👤 ' + (name.length > 12 ? name.slice(0, 12) + '…' : name);
      btn.title = u.email || '';
    } else if (state.gate === 'open') {
      btn.textContent = '게스트 · 로그인';
      btn.title = '게스트로 이용 중이에요. 기록을 저장하려면 로그인하세요.';
    } else { btn.textContent = '로그인'; btn.title = ''; }
  }
  btn.onclick = () => open(state.user ? 'account' : 'login');

  /** 현재 상태를 화면 표시와 다른 코드에 알림 */
  function announce() {
    const guest = !state.user && state.gate === 'open';
    paintButton();
    root.dataset.signedIn = state.user ? 'true' : 'false';
    root.dataset.guest = guest ? 'true' : 'false';
    document.dispatchEvent(new CustomEvent('swingfixer:user', { detail: { user: state.user, guest } }));
  }

  // 저장 버튼 등 다른 코드가 "로그인이 필요해요" 안내를 띄울 때 쓰는 이벤트 (detail.message 로 문구 지정 가능)
  document.addEventListener('swingfixer:need-login', (e) => {
    if (state.user || locked()) return;
    open('login', e.detail?.message ?? '기록을 저장하려면 로그인해 주세요.');
  });

  // ---------- 로그인 상태 변화 ----------
  // 첫 이벤트 INITIAL_SESSION 이 "저장된 세션 확인 끝"을 뜻한다. 그동안은 data-gate="pending" 으로 분석 화면을 가려 둔다.
  waitTimer = setTimeout(() => {
    if (state.gate !== 'pending') return;
    console.warn('[authui] 세션 확인이 늦어 게스트로 엽니다.');
    setGate('open');
    announce();
  }, SESSION_WAIT);

  A.onAuthChange((event, user) => {
    state.user = user;

    if (user) {                                   // 로그인됨 (저장된 세션 포함) → 게스트 선택은 지움
      guestFlag.clear();
      setGate('open');
    } else if (event === 'SIGNED_OUT') {           // 로그아웃 → 첫 화면 로그인 창으로 되돌림
      guestFlag.clear();
      announce();
      return lockWithLogin();
    } else if (event === 'INITIAL_SESSION' || state.gate === 'pending') {
      // 저장된 세션 없음: 이 탭에서 게스트를 골랐다면 통과, 아니면 로그인 창
      if (guestFlag.get()) setGate('open');
      else { announce(); return lockWithLogin(); }
    }
    announce();

    if (event === 'PASSWORD_RECOVERY') return open('recover');            // 재설정 메일 링크로 들어옴
    if (!dlg.open) return;
    if (user && event === 'SIGNED_IN' && ['login', 'signup', 'forgot'].includes(state.view)) close();
  });
})();