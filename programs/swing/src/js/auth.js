/**
 * auth.js — 회원가입 / 로그인 / 로그아웃 / 비밀번호 찾기·변경 (서버 담당 파일)
 * 화면(UI) 코드는 이 파일의 함수만 호출하면 된다. 실패하면 한글 메시지가 담긴 Error 를 던진다.
 *
 *   try { await signIn(email, pw); } catch (e) { alert(e.message); }
 */
import { supabase } from './supabase.js';

/** Supabase 오류를 사용자에게 보여줄 한글 문장으로 바꾼다 (모르는 오류는 원문을 덧붙임) */
export function friendlyError(err) {
  const code = err?.code || '';
  const msg = (err?.message || '').toLowerCase();
  const MAP = {
    invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
    email_not_confirmed: '이메일 인증이 아직 안 됐어요. 받은 메일의 인증 링크를 눌러 주세요.',
    user_already_exists: '이미 가입된 이메일입니다.',
    email_exists: '이미 가입된 이메일입니다.',
    weak_password: '비밀번호가 너무 약합니다. 6자 이상(영문+숫자 권장)으로 만들어 주세요.',
    same_password: '이전과 같은 비밀번호입니다. 다른 비밀번호를 입력해 주세요.',
    over_email_send_rate_limit: '메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.',
    over_request_rate_limit: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    validation_failed: '입력한 값을 확인해 주세요. (이메일 형식 등)',
    session_not_found: '로그인이 만료됐어요. 다시 로그인해 주세요.',
  };
  if (MAP[code]) return MAP[code];
  if (msg.includes('invalid login credentials')) return MAP.invalid_credentials;
  if (msg.includes('email not confirmed')) return MAP.email_not_confirmed;
  if (msg.includes('already registered')) return MAP.user_already_exists;
  if (msg.includes('rate limit')) return MAP.over_email_send_rate_limit;
  if (msg.includes('failed to fetch') || msg.includes('network')) return '네트워크 연결을 확인해 주세요.';
  return `요청에 실패했어요. (${err?.message || '알 수 없는 오류'})`;
}

/** 오류가 있으면 한글 Error 로 바꿔 던진다 */
const check = (error) => { if (error) throw new Error(friendlyError(error)); };

/** 메일 속 링크가 돌아올 주소 = 지금 보고 있는 페이지 (Supabase 의 Redirect URLs 허용 목록에 있어야 함) */
const backUrl = () => location.origin + location.pathname;

/**
 * 회원가입
 * @returns {{user, needsConfirm:boolean}} needsConfirm=true 면 인증 메일을 눌러야 로그인됨
 */
export async function signUp(email, password, name = '') {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: name ? { name } : {}, emailRedirectTo: backUrl() },
  });
  check(error);
  // 이미 가입된 이메일은 (이메일 인증이 켜져 있으면) 오류 없이 identities 가 빈 사용자로 돌아온다
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error(friendlyError({ code: 'user_already_exists' }));
  }
  return { user: data.user, needsConfirm: !data.session };
}

/** 로그인 → 로그인된 사용자 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  check(error);
  return data.user;
}

/**
 * 카카오로 로그인 — 카카오 로그인 화면으로 이동했다가 이 주소로 돌아온다 (돌아온 뒤 세션은 onAuthChange 가 알려준다).
 * 이메일 동의 항목(account_email)은 요청하지 않는다(비즈 앱이 아니면 KOE205 오류가 나므로).
 * → Supabase 의 Kakao 설정에서 "Allow users without an email" 을 켜 두어야 한다.
 */
export async function signInWithKakao() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: backUrl(), scopes: 'profile_nickname profile_image' },
  });
  check(error);
}

/** 로그아웃 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  check(error);
}

/** 지금 로그인한 사용자 (없으면 null). 저장소의 세션을 읽으므로 빠르다 */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/**
 * 로그인 상태가 바뀔 때마다 callback(event, user) 호출. 해제 함수를 돌려준다.
 * event: 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY' | 'USER_UPDATED' ...
 * 'PASSWORD_RECOVERY' = 재설정 메일 링크를 타고 들어온 상태 → "새 비밀번호 입력" 화면을 보여주면 된다
 */
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

/** 비밀번호 찾기 1단계: 재설정 메일 보내기 (가입 안 된 이메일이어도 같은 응답이 옴) */
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: backUrl() });
  check(error);
}

/** 비밀번호 찾기 2단계: 메일 링크로 들어온 상태(PASSWORD_RECOVERY)에서 새 비밀번호 저장 */
export async function setNewPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  check(error);
}

/** 비밀번호 변경: 로그인 상태에서 현재 비밀번호를 한 번 더 확인한 뒤 바꾼다 */
export async function changePassword(currentPassword, newPassword) {
  const user = await getCurrentUser();
  if (!user?.email) throw new Error(friendlyError({ code: 'session_not_found' }));
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (verifyError) throw new Error('현재 비밀번호가 올바르지 않습니다.');
  await setNewPassword(newPassword);
}