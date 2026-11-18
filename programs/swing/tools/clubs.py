"""
clubs.py
클럽 종류별 설정과 "자동 단계 포착" 규칙을 모아둔 파일.

- 새 클럽(퍼팅 등)을 추가하려면 CLUBS 에 항목을 하나 더 만들고,
  그 클럽 전용 detect_key_frames 함수를 따로 구현하면 된다.
- 웹 쪽 짝꿍: src/js/clubs/*.js  (단계 이름, 자동 포착 규칙은 양쪽을 같이 맞출 것)
- 자동 포착은 "--times 를 안 줬을 때"의 보조 수단이다. 정확도가 중요하면 --times 로 직접 지정한다.
"""
import math

L_WRIST, R_WRIST = 15, 16


def _wrist_y_smoothed(frames):
    """두 손목 평균 Y 를 3점 이동평균으로 부드럽게 만든 리스트 (값이 작을수록 높은 위치)"""
    raw = [(f["lm"][L_WRIST].y + f["lm"][R_WRIST].y) / 2 for f in frames]
    out = []
    for i in range(len(raw)):
        seg = raw[max(0, i - 1): i + 2]
        out.append(sum(seg) / len(seg))
    return out


def _wrist_speed(frames, i, aspect):
    """i-1 → i 프레임 사이 두 손목 평균 이동 속도 (영상 비율 보정 포함)"""
    a, b = frames[i - 1]["lm"], frames[i]["lm"]
    dx = ((b[L_WRIST].x + b[R_WRIST].x - a[L_WRIST].x - a[R_WRIST].x) / 2) * aspect
    dy = (b[L_WRIST].y + b[R_WRIST].y - a[L_WRIST].y - a[R_WRIST].y) / 2
    return math.hypot(dx, dy) / (frames[i]["t"] - frames[i - 1]["t"])


def _require_enough_frames(frames):
    if len(frames) < 6:
        raise SystemExit("포즈가 검출된 프레임이 부족합니다. 전신이 나온 영상을 사용하세요.")


def _smooth(values):
    """3점 이동평균 (포즈 인식이 한 프레임 튀는 것을 완화)"""
    return [sum(values[max(0, i - 1): i + 2]) / len(values[max(0, i - 1): i + 2]) for i in range(len(values))]


# 중간 단계(샤프트가 지면과 평행한 순간)를 손목 높이의 "진행 비율"로 찾는 기준 (common.js 와 같은 값)
TAKEAWAY_RISE = 0.25      # 테이크어웨이: 어드레스→탑 손목 상승량의 25% 를 처음 넘는 프레임
DOWNSWING_DROP = 0.70     # 다운스윙: 탑→임팩트 손목 하강량의 70% 를 처음 넘는 프레임
FOLLOW_RISE = 0.30        # 팔로우 스루: 임팩트→피니시 손목 상승량의 30% 를 처음 넘는 프레임


def _first_reaching(values, lo, hi, target, rising):
    """lo < i < hi 범위에서 values[i] 가 target 에 처음 도달하는 i. 없으면 가운데. (rising: 값이 커지는 방향)"""
    for i in range(lo + 1, hi):
        if (values[i] >= target) if rising else (values[i] <= target):
            return i
    return (lo + hi) // 2


def _detect_swing_phases(frames, aspect):
    """
    손목 움직임으로 7개의 "사건"을 찾는 공통 규칙. (src/js/clubs/common.js 와 같은 규칙)
    움직임으로 정의되는 사건이라 위치만 비교하는 방식보다 올라가는 중/내려오는 중을 정확히 구분한다.
      - 임팩트 : 손목 이동 속도가 가장 빠른 프레임 (다운스윙의 끝 = 공을 맞히는 순간 부근)
      - 백스윙 탑 : 시작부터 임팩트 직전까지 중 손목이 가장 높은 프레임
      - 어드레스(테이크어웨이 직전) : 백스윙에서 가장 빠른 지점부터 거꾸로 가서 손이 멈춰 있던 마지막 프레임
      - 피니시 : 임팩트 이후 손이 거의 멈추는 첫 프레임 (없으면 마지막 프레임)
      - 테이크어웨이 / 다운스윙 / 팔로우 스루 : 샤프트가 지면과 평행한 순간 근처.
        손목 높이가 앞뒤 단계 사이에서 일정 비율(위 상수)만큼 진행한 첫 프레임
    반환: [어드레스, 테이크어웨이, 탑, 다운스윙, 임팩트, 팔로우 스루, 피니시] 프레임 인덱스
    """
    _require_enough_frames(frames)
    n = len(frames)
    y = _wrist_y_smoothed(frames)
    speed = _smooth([0.0] + [_wrist_speed(frames, i, aspect) for i in range(1, n)])

    impact = max(range(2, n), key=lambda i: speed[i])
    top = min(range(1, impact), key=lambda i: y[i])
    still = 0.08 * speed[impact]          # "거의 멈춤" 기준: 최대 속도의 8%

    address = 0
    if top > 1:
        backswing_peak = max(range(1, top + 1), key=lambda i: speed[i])
        for i in range(backswing_peak, 0, -1):
            if speed[i] < still:
                address = i
                break

    finish = n - 1
    for i in range(min(impact + 3, n - 1), n):
        if speed[i] < still:
            finish = i
            break

    # 중간 단계: y 는 작을수록 높음 → "올라감"은 값이 작아지는 방향
    takeaway = _first_reaching(y, address, top, y[address] - TAKEAWAY_RISE * (y[address] - y[top]), rising=False)
    downswing = _first_reaching(y, top, impact, y[top] + DOWNSWING_DROP * (y[impact] - y[top]), rising=True)
    follow = _first_reaching(y, impact, finish, y[impact] - FOLLOW_RISE * (y[impact] - y[finish]), rising=False)
    return [address, takeaway, top, downswing, impact, follow, finish]


# ------------------------------------------------------------------
# 드라이버: 어드레스 / 백스윙 탑 / 임팩트 / 피니시
# ------------------------------------------------------------------
def detect_key_frames_driver(frames, aspect):
    return _detect_swing_phases(frames, aspect)


# ------------------------------------------------------------------
# 아이언: 단계 이름은 같지만 규칙은 드라이버와 별도로 관리한다.
# 지금은 시작값이 드라이버와 같다. 실제 아이언 영상으로 확인하며 이 함수만 따로 고치면 된다.
# ------------------------------------------------------------------
def detect_key_frames_iron(frames, aspect):
    return _detect_swing_phases(frames, aspect)   # TODO: 아이언 영상으로 확인 후 아이언 전용 규칙으로 교체


# 7단계: 중간 3단계(테이크어웨이·다운스윙·팔로우 스루)는 샤프트가 지면과 평행한 순간 기준
STAGES_7 = ["어드레스", "테이크어웨이", "백스윙 탑", "다운스윙", "임팩트", "팔로우 스루", "피니시"]

CLUBS = {
    "driver": {
        "label": "드라이버",
        "stages": STAGES_7,
        "detect_key_frames": detect_key_frames_driver,
    },
    "iron": {
        "label": "아이언",
        "stages": STAGES_7,
        "detect_key_frames": detect_key_frames_iron,
    },
}
