/**
 * www/ 생성 (Capacitor 가 읽는 폴더).
 *   앱 화면      index.html, src/          → www/
 *   각 프로그램  programs/<이름>/<entry>/  → www/programs/<이름>/   (+ 있으면 programs/<이름>/build.mjs 실행)
 *   목록         programs/각이름/program.json → www/programs.json     (앱 화면이 이걸 읽어 버튼·탭을 만든다)
 * 옵션  --native 오프라인 내장 / --slim 가벼운 빌드
 * 프로그램을 추가해도 이 파일과 src/ 는 고칠 필요가 없다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const native = process.argv.includes('--native'), slim = process.argv.includes('--slim');
const www = r('www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
fs.copyFileSync(r('index.html'), path.join(www, 'index.html'));
fs.cpSync(r('src'), path.join(www, 'src'), { recursive: true });

const list = [];
for (const dir of fs.readdirSync(r('programs'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const base = r('programs', dir.name), manifestPath = path.join(base, 'program.json');
  if (!fs.existsSync(manifestPath)) continue;
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // entry: 프로그램 화면이 있는 폴더 (기본 'web'). include: 그 안에서 앱에 넣을 파일/폴더 목록 (없으면 전부)
  const id = m.id || dir.name, entry = path.join(base, m.entry ?? 'web'), ready = fs.existsSync(path.join(entry, 'index.html'));
  if (ready) {
    const out = path.join(www, 'programs', id);
    if (m.include) for (const n of m.include) fs.cpSync(path.join(entry, n), path.join(out, n), { recursive: true });
    else fs.cpSync(entry, out, { recursive: true });
    const hook = path.join(base, 'build.mjs');
    if (fs.existsSync(hook)) await (await import(pathToFileURL(hook).href)).default({ out, base, root, native, slim });
  }
  list.push({ id, order: m.order ?? 99, title: m.title ?? id, desc: m.desc ?? '', icon: m.icon ?? '', color: m.color, badge: m.badge, message: m.message, url: ready ? `programs/${id}/index.html` : null });
}
list.sort((a, b) => a.order - b.order);
fs.writeFileSync(path.join(www, 'programs.json'), JSON.stringify(list, null, 2));
console.log(`✔ www/ 준비 완료${native ? ' [--native]' : ''} — 프로그램 ${list.length}개: ${list.map((p) => p.title + (p.url ? '' : '(준비 중)')).join(', ')}`);
console.log('   다음: npx cap sync   (또는 npm run ios / npm run android)');
