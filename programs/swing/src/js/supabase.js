/**
 * supabase.js — Supabase 연결 (서버 담당 파일)
 * 다른 파일(auth.js, db.js)이 이 파일의 supabase 하나만 공유해서 쓴다.
 *
 * ※ 아래 anon 키는 공개 코드에 넣어도 되는 키다 (보안은 DB 쪽 RLS 정책이 지킴).
 *    service_role 키는 절대 이 파일이나 어떤 프론트엔드 코드에도 넣지 말 것.
 * ※ SDK 는 CDN 에서 불러온다 (버전 고정: 2.118.0). 로그인·저장은 어차피 인터넷이 필요하다.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

export const SUPABASE_URL = 'https://ebqhrdppzykpcinqgela.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVicWhyZHBwenlrcGNpbnFnZWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NDYyNjIsImV4cCI6MjExMDMyMjI2Mn0.ByLthNoaWKtutvRK_piIBCUAel35_ip3GGpkSr1Do0k';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // 새로고침해도 로그인 유지 (브라우저 저장소 사용)
    autoRefreshToken: true,    // 로그인 토큰 자동 갱신
    detectSessionInUrl: true,  // 비밀번호 재설정 메일 링크로 들어오면 자동으로 인식
  },
});
