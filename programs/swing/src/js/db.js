/**
 * db.js — 분석 기록 저장 / 조회 / 삭제 (서버 담당 파일)
 * 테이블: swing_sessions (id, user_id, club, view, result, memo, created_at)
 * user_id 는 DB 가 로그인한 사용자로 자동 채우고, RLS 정책이 "내 기록만" 보게 막아 준다.
 * 로그인하지 않은 상태에서 호출하면 한글 Error 를 던진다.
 */
import { supabase } from './supabase.js';
import { friendlyError } from './auth.js';

const check = (error) => { if (error) throw new Error(friendlyError(error)); };
const round = (v, n = 1) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(n)) : v);
const roundMap = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) : o);

/**
 * 분석 결과(app.js 의 state.stages)를 저장용 JSON 으로 줄인다. (영상·프레임 원본은 저장하지 않음)
 *   result = { version:1, stages:[ { name, userT, matchDist, diffs, signed, head } ... ] }
 *   diffs  = 관절별 |사용자-프로| 각도 차이,  signed = 사용자-프로 (+ 과함 / - 부족함)
 *   head   = 머리 위치 비교 { ex, ey, err, bad } (비교하지 않는 단계는 null)
 */
export function buildResult(stages) {
  return {
    version: 1,
    stages: stages.map((st) => ({
      name: st.name,
      userT: round(st.userT, 3),
      matchDist: round(st.matchDist, 3),
      diffs: roundMap(st.diffs),
      signed: roundMap(st.signed),
      head: st.head ? { ex: round(st.head.ex, 3), ey: round(st.head.ey, 3), err: round(st.head.err, 3), bad: !!st.head.bad } : null,
    })),
  };
}

/** 기록 저장 → 저장된 행 ({ id, created_at, ... }) */
export async function saveRecord({ club, view, result, memo = null }) {
  const { data, error } = await supabase
    .from('swing_sessions')
    .insert({ club, view, result, memo })
    .select('id, club, view, memo, created_at')
    .single();
  check(error);
  return data;
}

/** 내 기록 목록 (최신순, result 는 빼서 가볍게). 더 불러오려면 offset 을 늘린다 */
export async function listRecords({ limit = 20, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('swing_sessions')
    .select('id, club, view, memo, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  check(error);
  return data;
}

/** 기록 1건 전체 (result 포함). 없거나 남의 기록이면 null */
export async function getRecord(id) {
  const { data, error } = await supabase.from('swing_sessions').select('*').eq('id', id).maybeSingle();
  check(error);
  return data;
}

/** 기록 삭제 */
export async function deleteRecord(id) {
  const { error } = await supabase.from('swing_sessions').delete().eq('id', id);
  check(error);
}
