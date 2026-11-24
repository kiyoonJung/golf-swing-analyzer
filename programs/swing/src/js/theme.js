/**
 * theme.js — 화면 모드(다크 / 라이트 / 시스템 설정) 선택  [서버 담당 파일]
 *  - 선택값은 localStorage 'swingfixer:theme' 에 저장 ('dark' | 'light' | 'system', 없으면 system)
 *  - <html data-theme="dark|light"> 로 색을 강제하고, system 이면 data-theme 를 지워 기기 설정(prefers-color-scheme)을 따른다.
 *  - 껍데기(앱)와 스윙 분석(iframe)은 같은 주소 출처라서 'storage' 이벤트로 서로 바로 맞춰진다.
 *  - 쓰는 곳: 톱니바퀴(설정) 안 — 앱 위쪽(src/main.js), 로그인 창 아래(src/gate.js), 스윙 분석을 단독으로 열었을 때 맨 아래(programs/swing/index.html)
 *  - 톱니바퀴를 누르면 설정 창이 열리고 그 안에서 화면 모드를 바꾼다. 설정 항목을 더 넣을 때는 openSettings() 의 setsec 블록을 추가하면 된다.
 */
const KEY = 'swingfixer:theme';
const MODES = [['dark', '다크'], ['light', '라이트'], ['system', '시스템 설정']];

const read = () => { try { const v = localStorage.getItem(KEY); return MODES.some(([m]) => m === v) ? v : 'system'; } catch { return 'system'; } };

function paint(mode) {
  const r = document.documentElement;
  if (mode === 'system') delete r.dataset.theme; else r.dataset.theme = mode;
  document.querySelectorAll('.themesw button').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
  });
}

export const getTheme = read;
export function setTheme(mode) {
  if (!MODES.some(([m]) => m === mode)) return;
  try { localStorage.setItem(KEY, mode); } catch { /* 저장 못 해도 이 화면에서는 바뀐다 */ }
  paint(mode);
}

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .themesw { display:flex; width:fit-content; max-width:100%; margin:0 auto; border:1px solid var(--line,#CBD3C4); border-radius:10px; overflow:hidden; background:var(--card,#fff); }
    .themesw button { border:0; background:transparent; color:var(--ink,#17231B); padding:8px 14px; min-height:36px; font:inherit; font-size:13px; cursor:pointer; white-space:nowrap; }
    .themesw button + button { border-left:1px solid var(--line,#CBD3C4); }
    .themesw button.on { background:var(--accent,var(--turf,#2F6B3A)); color:var(--on,#fff); font-weight:600; }
  `;
  document.head.appendChild(s);
}

/** host 안에 세 칸짜리 선택 탭을 그린다 */
export function mountThemeSwitch(host) {
  injectStyle();
  const d = document.createElement('div');
  d.className = 'themesw'; d.setAttribute('role', 'radiogroup'); d.setAttribute('aria-label', '화면 모드');
  d.innerHTML = MODES.map(([m, t]) => `<button type="button" role="radio" data-mode="${m}">${t}</button>`).join('');
  d.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setTheme(b.dataset.mode); });
  host.append(d);
  paint(read());
  return d;
}

// ───────── 설정 (톱니바퀴) ─────────
const GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
let gearStyled = false, settingsDlg = null;
function injectGearStyle() {
  if (gearStyled) return; gearStyled = true;
  const s = document.createElement('style');
  s.textContent = `
    .gearbtn { display:grid; place-items:center; width:40px; height:40px; padding:0; border:1px solid var(--line,#CBD3C4); border-radius:50%; background:var(--card,#fff); color:var(--ink,#17231B); cursor:pointer; }
    .gearbtn:active { transform:scale(.94); }
    .gearbtn:focus-visible, .setx:focus-visible { outline:2px solid var(--accent,var(--turf,#2F6B3A)); outline-offset:2px; }
    dialog.setdlg { border:0; padding:0; background:transparent; color:var(--ink,#17231B); width:min(360px, calc(100% - 24px)); font:inherit; }
    dialog.setdlg::backdrop { background:rgba(0,0,0,.5); }
    .setcard { border:1px solid var(--line,#CBD3C4); border-radius:18px; background:var(--card,#fff); padding:18px 18px 22px; box-shadow:0 10px 40px rgba(0,0,0,.35); }
    .sethd { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
    .sethd h3 { margin:0; font-size:18px; letter-spacing:-.02em; }
    .setx { border:0; background:none; color:var(--sub,#5B6B5F); font-size:20px; line-height:1; padding:4px 8px; cursor:pointer; }
    .setlabel { font-size:13px; color:var(--sub,#5B6B5F); margin-bottom:8px; }
  `;
  document.head.appendChild(s);
}

/** 설정 창 열기 (처음 열 때 한 번 만들고 계속 재사용) */
export function openSettings() {
  injectStyle(); injectGearStyle();
  if (!settingsDlg) {
    settingsDlg = document.createElement('dialog');
    settingsDlg.className = 'setdlg'; settingsDlg.setAttribute('aria-labelledby', 'setTitle');
    settingsDlg.innerHTML = `<div class="setcard"><div class="sethd"><h3 id="setTitle">설정</h3><button type="button" class="setx" data-close aria-label="닫기">✕</button></div>
      <div class="setsec"><div class="setlabel">화면 모드</div><div data-theme-host></div></div></div>`;
    document.body.append(settingsDlg);
    mountThemeSwitch(settingsDlg.querySelector('[data-theme-host]'));
    settingsDlg.addEventListener('click', (e) => { if (e.target === settingsDlg || e.target.closest('[data-close]')) settingsDlg.close(); });
  }
  paint(read());
  if (!settingsDlg.open) settingsDlg.showModal();
}

/** host 안에 톱니바퀴 버튼을 그린다 (누르면 설정 창) */
export function mountThemeGear(host) {
  injectGearStyle();
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'gearbtn'; b.innerHTML = GEAR;
  b.setAttribute('aria-label', '설정'); b.setAttribute('aria-haspopup', 'dialog');
  b.addEventListener('click', openSettings);
  host.append(b);
  return b;
}

paint(read());
addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) paint(read()); });
