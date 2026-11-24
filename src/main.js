import { loadPrograms } from './programs.js';
// 이 파일은 "목록에 있는 프로그램"을 그리기만 한다. 프로그램을 추가해도 고칠 필요가 없다.

const NAME = '스윙픽서';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (d, c = '') => `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d || '<circle cx="12" cy="12" r="8"/>'}</svg>`;
const FLAG = svg('<path d="M7 21V3"/><path d="M7 3l11 4.5L7 12"/><path d="M3 21h8"/>');
const app = document.getElementById('app');

async function main() {
  let programs;
  try { programs = await loadPrograms(); }
  catch { app.innerHTML = '<div class="empty"><b>프로그램 목록을 불러오지 못했습니다</b><span>터미널에서 npm run dev 로 실행했는지 확인해 주세요.</span></div>'; return; }

  app.innerHTML = `
  <section class="home"><header class="top"><h1 class="brand">${FLAG}${NAME}</h1><p class="lead">프로그램을 선택하세요</p><span class="gearhost"></span></header>
    <div class="grid">${programs.map((p, i) => `<a class="tile${p.url ? '' : ' soon'}" href="#${esc(p.id)}" style="--i:${i}${p.color ? `;--c:${esc(p.color)}` : ''}"><span class="ico">${svg(p.icon)}</span>${p.url ? `<span class="go">${svg('<path d="M7 17L17 7M9 7h8v8"/>')}</span>` : `<span class="pill">${esc(p.badge ?? '준비 중')}</span>`}<span class="wm">${svg(p.icon)}</span><span class="tx"><b>${esc(p.title)}</b>${p.desc ? `<span class="d">${esc(p.desc)}</span>` : ''}</span></a>`).join('')}</div></section>
  <section class="shell" hidden>
    <header class="top bar"><a class="back" href="#" aria-label="홈으로">${svg('<path d="M15 6l-6 6 6 6"/>')}</a><h1 class="brand">${NAME}</h1><span class="gearhost"></span></header>
    <nav class="tabs" role="tablist" aria-label="프로그램">${programs.map((p) => `<button class="tab" role="tab" data-id="${esc(p.id)}">${esc(p.title)}</button>`).join('')}</nav>
    <main class="stage"></main></section>`;

  const home = app.querySelector('.home'), shell = app.querySelector('.shell');
  // 설정(톱니바퀴): 홈과 프로그램 화면 위쪽. 누르면 설정 창(화면 모드 다크/라이트/시스템). 못 불러와도 앱은 정상 동작
  import('../programs/swing/src/js/theme.js').then((m) => app.querySelectorAll('.gearhost').forEach((h) => m.mountThemeGear(h))).catch(() => {});
  const tabs = shell.querySelector('.tabs'), stage = shell.querySelector('.stage');
  let panels = {};   // 연 프로그램은 탭을 오가도 유지. 홈으로 나가면 모두 닫는다(카메라도 함께 꺼짐).

  function open(p) {
    const el = document.createElement('section');
    el.className = 'panel'; el.setAttribute('role', 'tabpanel');
    el.innerHTML = p.url && !p.message
      ? `<iframe class="frame" src="${esc(p.url)}" title="${esc(p.title)}" allow="camera; microphone; fullscreen"></iframe>`
      : `<div class="empty"><b>${esc(p.title)}</b><span>${esc(p.message ?? '준비 중입니다.')}</span></div>`;
    stage.append(el); panels[p.id] = el;
  }

  function route() {
    const p = programs.find((x) => x.id === location.hash.slice(1));
    if (!p) { home.hidden = false; shell.hidden = true; stage.replaceChildren(); panels = {}; return; }
    home.hidden = true; shell.hidden = false;
    tabs.querySelectorAll('.tab').forEach((b) => {
      const on = b.dataset.id === p.id; b.setAttribute('aria-selected', on);
      if (on) b.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
    if (!panels[p.id]) open(p);
    for (const k in panels) panels[k].hidden = k !== p.id;
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) location.hash = b.dataset.id; });
  addEventListener('hashchange', route);
  route();
}
main();