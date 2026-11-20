/**
 * authui.js — 로그인 화면 (서버 담당 파일)
 * index.html 맨 아래에 이 한 줄만 추가하면 화면 오른쪽 위에 "로그인" 버튼이 생긴다:
 *     <script type="module" src="src/js/authui.js"></script>
 *
 * - 버튼을 누르면 로그인 / 회원가입 / 비밀번호 찾기 창이 뜨고, 로그인하면 계정 창(비밀번호 변경·로그아웃)으로 바뀐다.
 * - 재설정 메일 링크로 들어오면 자동으로 "새 비밀번호 설정" 창이 열린다.
 * - 로그인은 선택 사항이다. 로그인하지 않아도 기존 분석 기능은 그대로 동작한다.
 * - 로그인 상태가 바뀌면 document 에 'swingfixer:user' 이벤트(detail.user = 사용자 또는 null)를 보낸다.
 *   → 저장 버튼 같은 다른 코드는 이 이벤트를 들으면 된다. (<html data-signed-in="true|false"> 도 갱신)
 * - 서버(CDN)에 연결하지 못해도 이 파일만 실패하고 프로그램 본체(app.js)에는 영향이 없다.
 */
(async () => {
  const MIN_PW = 6;          // Supabase 기본 최소 비밀번호 길이
  const MAIL_COOLDOWN = 60;  // 재설정 메일은 연속으로 누르지 못하게 60초 대기 (메일 한도 보호)

  // ---------- 스타일 (style.css 의 색 변수를 그대로 사용, 없으면 기본색) ----------
  const style = document.createElement('style');
  style.textContent = `
    .authbar { display:flex; justify-content:flex-end; margin:0 0 4px; }
    .authbtn { max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    dialog.authdlg { border:1px solid var(--line,#CBD3C4); border-radius:14px; background:var(--card,#fff); color:var(--ink,#17231B);
      padding:16px; width:min(420px, calc(100% - 24px)); max-height:calc(100vh - 24px); max-height:calc(100dvh - 24px); overflow:auto;
      box-shadow:0 10px 40px rgba(0,0,0,.35); font-family:inherit; }
    dialog.authdlg::backdrop { background:rgba(0,0,0,.5); }
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

  // ---------- 서버 모듈 불러오기 (실패해도 프로그램 본체는 정상) ----------
  let A;
  try {
    A = await import('./auth.js');
  } catch {
    btn.textContent = '로그인 불가';
    btn.disabled = true;
    btn.title = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
    return;
  }

  // ---------- 상태 ----------
  const state = { user: null, view: 'login' };
  let mailUntil = 0;     // 재설정 메일을 다시 보낼 수 있는 시각(ms)
  let mailTimer = null;

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
        </div>`,
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
    $body.innerHTML = VIEWS[view].html;
    say(msg, kind);
    if (view === 'account') $body.querySelector('[data-acct]').textContent = state.user?.email ?? '';
    if (view === 'forgot') tickMailButton();
    // 첫 입력칸에 커서 (모바일에서 키보드가 바로 뜨는 것이 번거로우면 이 줄을 지우세요)
    $body.querySelector('input')?.focus();
  }

  function open(view, msg, kind) { render(view, msg, kind); if (!dlg.open) dlg.showModal(); }
  const close = () => { if (dlg.open) dlg.close(); };

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
    if (e.target.closest('[data-signout]')) {
      try { await A.signOut(); close(); } catch (err) { say(err.message, 'err'); }
    }
  });
  dlg.querySelector('[data-close]').onclick = close;
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });   // 창 바깥(어두운 곳)을 누르면 닫힘

  // ---------- 상단 버튼 ----------
  function paintButton() {
    const u = state.user;
    if (u) {
      const name = (u.email || '').split('@')[0];
      btn.textContent = '👤 ' + (name.length > 12 ? name.slice(0, 12) + '…' : name);
      btn.title = u.email || '';
    } else { btn.textContent = '로그인'; btn.title = ''; }
  }
  btn.onclick = () => open(state.user ? 'account' : 'login');

  // ---------- 로그인 상태 변화 ----------
  A.onAuthChange((event, user) => {
    state.user = user;
    paintButton();
    document.documentElement.dataset.signedIn = user ? 'true' : 'false';
    document.dispatchEvent(new CustomEvent('swingfixer:user', { detail: { user } }));

    if (event === 'PASSWORD_RECOVERY') return open('recover');            // 재설정 메일 링크로 들어옴
    if (!dlg.open) return;
    if (user && event === 'SIGNED_IN' && ['login', 'signup', 'forgot'].includes(state.view)) close();
    if (!user && state.view === 'account') close();
  });
})();
