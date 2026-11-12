/**
 * clubs/driver.js — 드라이버 프로필
 * 짝꿍 파이썬 설정: tools/clubs.py 의 CLUBS["driver"]
 */
import { makeRuleBasedDetector, STAGES_7 } from './common.js';
import { STAGE_ADVICE } from './advice_driver.js';

export default {
  id: 'driver',
  label: '드라이버',
  stages: STAGES_7,
  // 머리 위치를 비교할 단계 (어드레스는 기준, 팔로우 스루·피니시는 몸을 돌려 머리가 움직이는 게 정상이라 제외)
  headStages: ['테이크어웨이', '백스윙 탑', '다운스윙', '임팩트'],
  defaultStage: '백스윙 탑', // 분석 직후 처음 보여줄 단계
  // 프로 영상 파일이 실제보다 몇 배 느린 슬로모션인지 (배속 1x = 실제 속도로 맞추는 데 사용, player.js)
  // 추정값: 프로 영상 탑→임팩트 22프레임(0.73초) ÷ 투어 선수 실제 다운스윙 약 8프레임(30fps, Tour Tempo 6~9프레임) ≈ 2.75
  // 프로 영상을 바꾸면 이 값도 다시 재야 함 (실제 속도 영상이면 1)
  proSlowmo: { front: 2.75, side: 2.75 },
  // 단계별·부위별 과함/적당함/부족함 문구 + 미스샷 (advice_driver.js). 없는 단계는 아래 advice(부위별 공통)로 대체
  stageAdvice: STAGE_ADVICE,
  // 관절별 허용 각도 오차(도). 프로와의 차이가 이 값을 넘으면 과함/부족함으로 판정 (analyzer.js jointLimit)
  // 시작값(추정): 자세의 뼈대인 상체 숙임(hip)·무릎 굽힘(knee)은 작은 차이도 타점에 영향이 커서 엄격하게,
  // 빠르게 움직이고 MediaPipe 오차가 큰 팔꿈치(elbow)는 느슨하게. 일반인 영상으로 검증하며 조정할 값
  threshold: { shoulder: 15, elbow: 20, hip: 10, knee: 12 },

  // 시점(정면/측면) × 관절별 교정 문구 — ※ 임시 초안, 골프 아는 사람의 검수 필요
  advice: {
    front: {
      shoulder: '어깨 회전을 충분히 하되 어깨 라인이 무너지지 않게 유지하세요!',
      elbow: '팔꿈치가 몸에서 벌어지지 않게 팔 삼각형을 유지하세요!',
      hip: '엉덩이가 좌우로 밀리지 않게 제자리에서 회전하세요!',
      knee: '무릎이 좌우로 흔들리지 않게 하체를 단단히 고정하세요!',
      head: '백스윙과 임팩트에서 머리가 좌우로 크게 밀리지 않게, 공을 끝까지 보세요!',
    },
    side: {
      shoulder: '어깨가 일찍 열리지 않게 상체 회전 타이밍을 맞추세요!',
      elbow: '백스윙 탑에서 오른팔을 몸쪽에 조금 더 붙이세요!',
      hip: '엉덩이가 공 쪽으로 밀리거나 빠지지 않게 척추 각도를 유지하세요!',
      knee: '무릎 굽힘 각도를 유지하며 스윙 내내 높이를 지키세요!',
      head: '상체를 일으키거나 공 쪽으로 다가가지 말고, 어드레스의 척추 각도와 머리 높이를 유지하세요!',
    },
  },

  // 구버전 기준 JSON(자세 특징 없음)일 때만 쓰는 보조 규칙
  detectKeyFrames: makeRuleBasedDetector(),
};
