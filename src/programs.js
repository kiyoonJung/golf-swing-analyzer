// 프로그램 목록은 빌드가 만든 programs.json 에서 읽는다. (프로그램을 추가해도 이 파일은 그대로)
export async function loadPrograms() {
  const r = await fetch('programs.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
