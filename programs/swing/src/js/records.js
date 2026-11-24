/**
 * records.js — 분석 기록 + 영상 저장 / 목록 / 상세 / 삭제 (서버 담당 파일)
 * db.js(기본 기록 저장)를 확장한다. 테이블: swing_sessions, 영상 보관: Storage 비공개 폴더 swing-videos/{user_id}/{기록id}.확장자
 *
 * 한도: 사용자당 영상 3개, 영상 1개 45MB 이하 (DB 쪽에서도 같은 한도를 강제함 — 01_영상저장_SQL.sql)
 * 영상은 "선택"이다. 영상 저장이 안 되면(용량 초과·3개 가득·업로드 실패) 기록·피드백만 저장하고 이유를 알려준다.
 *
 * 저장 순서: ① 기록 id 를 미리 만든다 → ② 영상 업로드 → ③ 기록 행 저장(영상 경로 포함)
 *            ③ 이 실패하면 올린 영상을 지운다. (영상 3개 제한에 걸리면 영상 없이 한 번 더 저장)
 * 삭제 순서: 영상 파일 → 기록 행
 */
import { supabase } from './supabase.js';
import { friendlyError, getCurrentUser } from './auth.js';
import { buildResult } from './db.js';

export const LIMITS = { maxVideos: 3, maxBytes: 47185920 };   // 45MB = 45 * 1024 * 1024
const BUCKET = 'swing-videos';
const EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp' };

const check = (error) => { if (error) throw new Error(friendlyError(error)); };
const baseMime = (t) => String(t || '').split(';')[0].trim().toLowerCase();   // 'video/webm;codecs=vp9' → 'video/webm'
const r4 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);

/** 크기 표시: 32.1MB / 8.4MB */
export const formatMB = (bytes) => `${(bytes / 1048576).toFixed(1)}MB`;

/** 한국 시간(KST)으로 'YYYY-MM-DD HH:mm:ss' */
export function formatKST(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// ---------- 개수 ----------
export async function countRecords() {
  const { count, error } = await supabase.from('swing_sessions').select('id', { count: 'exact', head: true });
  check(error);
  return count ?? 0;
}
export async function countVideos() {
  const { count, error } = await supabase.from('swing_sessions').select('id', { count: 'exact', head: true }).not('video_path', 'is', null);
  check(error);
  return count ?? 0;
}

// ---------- 저장 ----------
/**
 * 저장할 영상이 한도 안인지 미리 확인 (저장 창의 체크박스 표시용)
 * → { size, mime, ext, used, usable, reason }  usable=false 면 reason 에 한글 이유
 */
export async function videoStatus(video) {
  const used = await countVideos();
  if (!video) return { size: 0, mime: '', ext: '', used, usable: false, reason: '영상 원본을 찾지 못했어요.' };
  const mime = baseMime(video.type), ext = EXT[mime] ?? '';
  const out = { size: video.size, mime, ext, used, usable: false, reason: '' };
  if (!ext) out.reason = '이 영상 형식은 서버에 저장할 수 없어요. (mp4·webm·mov만 가능)';
  else if (video.size > LIMITS.maxBytes) out.reason = `영상이 ${formatMB(LIMITS.maxBytes)}를 넘어요. (${formatMB(video.size)})`;
  else if (used >= LIMITS.maxVideos) out.reason = `영상 ${LIMITS.maxVideos}개가 가득 찼어요. 영상이 있는 기록을 지우면 저장할 수 있어요.`;
  else out.usable = true;
  return out;
}

/** 저장용 결과 JSON(v2): 단계별 오차 + 그 단계의 자세(관절 좌표) + 저장 시점의 피드백 문구 */
export function buildSavedResult(snap, feedbackOf) {
  const base = buildResult(snap.stages);
  return {
    version: 2,
    aspect: r4(snap.aspect),
    size: { w: snap.size?.w || 0, h: snap.size?.h || 0 },
    stages: base.stages.map((s, i) => {
      const st = snap.stages[i];
      const fr = snap.userFrames?.[st.frameIdx];
      const fb = feedbackOf ? feedbackOf(st) : null;
      return {
        ...s,
        lm: fr ? fr.lm.map((p) => [r4(p.x), r4(p.y), r4(p.visibility ?? 1)]) : null,
        feedback: fb ? { ok: !!fb.ok, lines: htmlToLines(fb.html) } : null,
      };
    }),
  };
}
export const htmlToLines = (html) => String(html ?? '').split(/<br\s*\/?>/i).map((s) => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

/**
 * 기록(+선택적으로 영상) 저장
 * @param {{club:string, view:string, result:object, memo?:string, video?:Blob|File|null}} p
 * @returns {{record:object, videoSaved:boolean, note:string}}  note = 영상이 저장되지 않았을 때의 이유(없으면 '')
 */
export async function saveRecordWithVideo({ club, view, result, memo = null, video = null }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('로그인이 필요해요.');
  const id = crypto.randomUUID();
  const row = { id, club, view, result, memo: memo || null };
  let note = '', uploaded = null;

  if (video) {
    const st = await videoStatus(video);
    if (!st.usable) note = st.reason;
    else {
      const path = `${user.id}/${id}.${st.ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, video, { contentType: st.mime, upsert: false });
      if (error) note = `영상 업로드에 실패했어요. (${friendlyError(error)})`;
      else { uploaded = path; Object.assign(row, { video_path: path, video_size: video.size, video_mime: st.mime }); }
    }
  }

  const insert = (r) => supabase.from('swing_sessions')
    .insert(r).select('id, club, view, memo, created_at, video_path, video_size').single();
  let { data, error } = await insert(row);
  if (error && uploaded) {
    // 3개 제한에 걸렸거나(동시 저장 등) 다른 이유로 실패 → 올린 영상은 지우고, 제한이면 영상 없이 다시 저장
    await supabase.storage.from(BUCKET).remove([uploaded]).catch(() => {});
    if (/video_limit_reached/.test(error.message || '')) {
      note = `영상 ${LIMITS.maxVideos}개가 가득 차서 영상은 저장하지 못했어요.`;
      uploaded = null;
      const { video_path, video_size, video_mime, ...plain } = row;
      ({ data, error } = await insert(plain));
    }
  }
  check(error);
  return { record: data, videoSaved: !!data.video_path, note };
}

// ---------- 목록 / 상세 / 영상 주소 ----------
export async function listMyRecords({ limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase.from('swing_sessions')
    .select('id, club, view, memo, created_at, video_path, video_size')
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  check(error);
  return data;
}
export async function getRecordFull(id) {
  const { data, error } = await supabase.from('swing_sessions').select('*').eq('id', id).maybeSingle();
  check(error);
  return data;
}
/** 저장된 영상의 임시 재생 주소(기본 1시간). 필요할 때만 부른다 */
export async function getVideoUrl(path, seconds = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  check(error);
  return data.signedUrl;
}

// ---------- 삭제 ----------
export async function deleteRecordFull(rec) {
  if (rec.video_path) {
    const { error } = await supabase.storage.from(BUCKET).remove([rec.video_path]);
    check(error);                       // 영상 삭제가 실패하면 기록도 남겨서 다시 시도할 수 있게 함
  }
  const { error } = await supabase.from('swing_sessions').delete().eq('id', rec.id);
  check(error);
}
