/**
 * theme.js — 화면 모드(다크 / 라이트 / 시스템 설정) 선택  [서버 담당 파일]
 *  - 선택값은 localStorage 'swingfixer:theme' 에 저장 ('dark' | 'light' | 'system', 없으면 system)
 *  - <html data-theme="dark|light"> 로 색을 강제하고, system 이면 data-theme 를 지워 기기 설정(prefers-color-scheme)을 따른다.
 *  - 껍데기(앱)와 스윙 분석(iframe)은 같은 주소 출처라서 'storage' 이벤트로 서로 바로 맞춰진다.
 *  - 쓰는 곳: 로그인 창 아래(src/gate.js), 스윙 분석 화면 맨 아래(programs/swing/index.html)
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

paint(read());
addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) paint(read()); });
