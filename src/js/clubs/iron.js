/**
 * clubs/iron.js — 아이언 프로필 (드라이버와 별도로 관리)
 * 짝꿍 파이썬 설정: tools/clubs.py 의 CLUBS["iron"]
 *
 * 드라이버와 단계 이름은 같지만, 문구·허용 오차·포착 규칙을 이 파일에서 독립적으로 고친다.
 * 아래 값은 모두 "시작값"이다. 실제 아이언 영상으로 확인하며 조정할 것.
 */
import { makeRuleBasedDetector, STAGES_7 } from './common.js';
import { STAGE_ADVICE } from './advice_driver.js'; // TODO: 아이언 전용 문구(advice_iron.js)로 교체

export default {
  id: 'iron',
  label: '아이언',
  stages: STAGES_7,
  headStages: ['테이크어웨이', '백스윙 탑', '다운스윙', '임팩트'], // TODO: 아이언 영상으로 확인 후 조정
  defaultStage: '백스윙 탑',
  proSlowmo: { front: 1, side: 1 }, // TODO: 아이언 프로 영상을 넣으면 슬로모션 배율을 재서 입력 (driver.js 설명 참고)
  stageAdvice: STAGE_ADVICE, // 지금은 드라이버 문구를 그대로 사용 (아이언 영상 확인 후 따로 작성)
  threshold: 15, // TODO: 아이언 영상으로 확인 후 조정

  // ※ 임시 초안, 골프 아는 사람의 검수 필요
  advice: {
    front: {
      shoulder: '어깨를 충분히 돌린 뒤, 임팩트에서는 어깨선이 목표 방향을 향해 열리도록 하세요!',
      elbow: '아이언은 팔을 몸 가까이 두세요. 오른쪽 팔꿈치를 옆구리 쪽에 유지하세요!',
      hip: '임팩트에서 체중을 왼발로 옮기며 엉덩이를 목표 쪽으로 회전하세요!',
      knee: '무릎 굽힘을 유지하세요. 다운스윙에서 일어서면 뒤땅이나 토핑이 나옵니다!',
      head: '머리를 공 위에 두고 좌우로 움직이지 마세요. 아이언은 머리가 밀리면 타점이 크게 흔들립니다!',
    },
    side: {
      shoulder: '임팩트까지 어깨가 먼저 열리지 않게 하고, 공을 내려치는 느낌으로 어깨를 회전하세요!',
      elbow: '임팩트에서 두 팔을 자연스럽게 펴면서 손이 공보다 약간 앞에 오게 하세요!',
      hip: '어드레스의 척추 각도를 스윙 내내 유지하고, 엉덩이가 공에서 멀어지지 않게 하세요!',
      knee: '무릎 높이를 유지해 몸이 위아래로 흔들리지 않게 하세요!',
      head: '임팩트까지 머리 높이를 유지하세요. 머리가 들리면 토핑, 내려가면 뒤땅이 나기 쉽습니다!',
    },
  },

  // 구버전 기준 JSON(자세 특징 없음)일 때만 쓰는 보조 규칙
  detectKeyFrames: makeRuleBasedDetector(), // TODO: 아이언 영상으로 확인 후 조정
};
