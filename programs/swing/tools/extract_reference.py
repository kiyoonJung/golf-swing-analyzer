#!/usr/bin/env python3
"""
프로 스윙 영상 1개를 분석해서, 스윙 7단계(어드레스/테이크어웨이/백스윙 탑/다운스윙/임팩트/팔로우 스루/피니시)의
기준 관절 각도를 JSON 으로 저장한다. 웹페이지(src/js/analyzer.js)는 이 JSON 과 비교한다.

사용법:
    pip install -r tools/requirements.txt
    python tools/extract_reference.py assets/driver_pro_front.mp4 --club driver --view front
    python tools/extract_reference.py assets/driver_pro_side.mp4  --club driver --view side
    python tools/extract_reference.py assets/iron_pro_front.mp4   --club iron   --view front

자동 포착이 안 맞을 때 (영상에 스윙 외 장면이 있거나 여러 번 휘두르는 경우):
    1) 영상 시각표 만들기:  python tools/extract_reference.py 영상 --club driver --view side --sheet
       → assets/contact_sheet_driver_side.jpg 에서 7단계에 해당하는 시각(초)을 읽는다
    2) 시각 직접 지정:      python tools/extract_reference.py 영상 --club driver --view side --times 0.0,1.3,2.47,3.03,3.2,3.4,4.6
       (어드레스, 테이크어웨이, 백스윙 탑, 다운스윙, 임팩트, 팔로우 스루, 피니시 순서.
        테이크어웨이·다운스윙·팔로우 스루 = 샤프트가 지면과 평행한 순간)
    2-1) 더 촘촘히 보기:    ... --sheet --start 1.5 --end 2.5 --interval 0.033   (구간을 확대, 0.033초≈1프레임)
    3) 또는 스윙 구간만 분석: --start 1.0 --end 4.5  (이 구간 안에서 자동 포착)

결과:
    assets/reference_driver_front.json   (기준 각도: reference_{클럽}_{시점}.json)
    assets/reference_driver_front_stage*.jpg (단계별 프레임 + 스켈레톤: 키 프레임이 맞는지 눈으로 확인용)

주의: 각도 계산 방식과 키 프레임 검출 로직은 JS(analyzer.js)와 동일해야 한다.
      로직을 바꾸면 양쪽을 같이 수정할 것.
"""
import argparse
import json
import math
from pathlib import Path
from types import SimpleNamespace

import cv2
import mediapipe as mp
import numpy as np

from clubs import CLUBS  # 클럽별 단계 이름 / 자동 포착 규칙 (tools/clubs.py)

# 관절별 [점A, 꼭짓점B, 점C] 랜드마크 인덱스 (analyzer.js 의 JOINTS 와 동일)
JOINTS = {
    "shoulder": {"L": (23, 11, 13), "R": (24, 12, 14)},
    "elbow":    {"L": (11, 13, 15), "R": (12, 14, 16)},
    "hip":      {"L": (11, 23, 25), "R": (12, 24, 26)},
    "knee":     {"L": (23, 25, 27), "R": (24, 26, 28)},
}


def angle(a, b, c):
    """세 점 a-b-c 에서 꼭짓점 b 의 2D 각도(0~180도)"""
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    dot = v1[0] * v2[0] + v1[1] * v2[1]
    cross = v1[0] * v2[1] - v1[1] * v2[0]
    return math.degrees(math.atan2(abs(cross), dot))


def frame_angles(lm, aspect):
    """한 프레임의 모든 관절 각도. x 에 aspect(가로/세로)를 곱해 비율 왜곡을 보정한다."""
    pt = lambda i: (lm[i].x * aspect, lm[i].y)
    out = {}
    for name, sides in JOINTS.items():
        for side, (a, b, c) in sides.items():
            if all(lm[i].visibility > 0.4 for i in (a, b, c)):
                out[f"{name}_{side}"] = angle(pt(a), pt(b), pt(c))
    return out


def pose_feature(lm, aspect):
    """
    장면 매칭용 자세 특징: 양 손목 위치를 엉덩이 중심 기준, 몸통 길이로 정규화한 4개 숫자.
    (analyzer.js 의 poseFeature 와 동일해야 함)
    측면 영상은 반대쪽 몸이 가려져 visibility 가 낮아도, MediaPipe 가 주는 추정 좌표로 충분히
    매칭할 수 있으므로 visibility 로 걸러내지 않는다.
    """
    pt = lambda i: (lm[i].x * aspect, lm[i].y)
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    hip, sh = mid(pt(23), pt(24)), mid(pt(11), pt(12))
    torso = math.hypot(sh[0] - hip[0], sh[1] - hip[1]) or 1e-6
    return [v for i in (15, 16) for v in ((pt(i)[0] - hip[0]) / torso, (pt(i)[1] - hip[1]) / torso)]


# ------------------------------------------------------------------
# MediaPipe 오인식 보정 (analyzer.js 의 fixLeftRightFlips / fixLegSpikes / cleanupPose 와 같은 규칙)
# ------------------------------------------------------------------
LR_PAIRS = [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16), (17, 18),
            (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]
LEG_POINTS = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
SPIKE_HALF, SPIKE_LIMIT = 3, 0.15


def _median(v):
    s = sorted(v)
    return s[len(s) // 2]  # JS 쪽과 같은 방식(짝수 개면 위쪽 중앙값)


def _torso_len(frames, aspect):
    def one(lm):
        sx = (lm[11].x + lm[12].x - lm[23].x - lm[24].x) / 2 * aspect
        sy = (lm[11].y + lm[12].y - lm[23].y - lm[24].y) / 2
        return math.hypot(sx, sy)
    return _median([one(f["lm"]) for f in frames])


def fix_left_right_flips(frames, aspect):
    """두 발은 제자리 → 발목이 평소와 반대로 붙은 프레임은 몸 전체 좌/우 랜드마크를 맞바꿈"""
    if len(frames) < 6:
        return frames, []
    P = lambda lm, i: (lm[i].x * aspect, lm[i].y)
    torso = _torso_len(frames, aspect)
    lms, flipped = [f["lm"] for f in frames], []
    for _ in range(2):
        L = (_median([P(lm, 27)[0] for lm in lms]), _median([P(lm, 27)[1] for lm in lms]))
        R = (_median([P(lm, 28)[0] for lm in lms]), _median([P(lm, 28)[1] for lm in lms]))
        if math.dist(L, R) < 0.3 * torso:
            return frames, []
        flipped, new = [], []
        for k, f in enumerate(frames):
            lm = f["lm"]
            keep = math.dist(P(lm, 27), L) + math.dist(P(lm, 28), R)
            swap = math.dist(P(lm, 27), R) + math.dist(P(lm, 28), L)
            if swap >= 0.5 * keep:
                new.append(lm)
                continue
            flipped.append(k)
            out = list(lm)
            for a, b in LR_PAIRS:
                out[a], out[b] = lm[b], lm[a]
            new.append(out)
        lms = new
    return [{**f, "lm": lms[k]} for k, f in enumerate(frames)], flipped


def fix_leg_spikes(frames, aspect):
    """1~2프레임만 튀는 하체 관절을 앞뒤 프레임 중앙값으로 교체하고 visibility 0 (각도 비교에서 제외)"""
    n = len(frames)
    if n < 2 * SPIKE_HALF + 1:
        return frames, 0
    torso = _torso_len(frames, aspect)
    out, fixed = [], 0
    for k, f in enumerate(frames):
        win = frames[max(0, k - SPIKE_HALF): k + SPIKE_HALF + 1]
        lm = f["lm"]
        new = None
        for i in LEG_POINTS:
            mx, my = _median([g["lm"][i].x for g in win]), _median([g["lm"][i].y for g in win])
            if math.hypot((lm[i].x - mx) * aspect, lm[i].y - my) > SPIKE_LIMIT * torso:
                new = new or list(lm)
                new[i] = SimpleNamespace(x=mx, y=my, visibility=0.0)
                fixed += 1
        out.append({**f, "lm": new} if new else f)
    return out, fixed


def cleanup_pose(frames, aspect):
    frames, flipped = fix_left_right_flips(frames, aspect)
    frames, spikes = fix_leg_spikes(frames, aspect)
    if flipped or spikes:
        print(f"  (인식 보정: 좌우 뒤집힘 {len(flipped)}프레임, 하체 튐 {spikes}곳)")
    return frames


def extract_frames(video_path, start=0.0, end=None):
    """영상의 모든 프레임에서 랜드마크를 추출한다 (가장 정확한 모델 complexity=2)."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise SystemExit(f"영상을 열 수 없습니다: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames, idx = [], 0

    with mp.solutions.pose.Pose(
        static_image_mode=False, model_complexity=2, smooth_landmarks=False,  # 웹(mediapipe.js)과 같은 조건
       
        min_detection_confidence=0.5, min_tracking_confidence=0.5,
    ) as pose:
        while True:
            ok, img = cap.read()
            if not ok:
                break
            t = idx / fps
            if end is not None and t > end:
                break
            if t < start:  # 지정 구간 앞부분은 건너뜀
                idx += 1
                continue
            res = pose.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            if res.pose_landmarks:  # 보정할 수 있게 단순 객체(x, y, visibility)로 복사
                lm = [SimpleNamespace(x=p.x, y=p.y, visibility=p.visibility) for p in res.pose_landmarks.landmark]
                frames.append({"idx": idx, "t": idx / fps, "lm": lm})
            idx += 1
    cap.release()
    return frames, fps, w / h, idx / fps


def save_previews(video_path, frames, keys, stage_names, club_id, view, out_dir):
    """키 프레임에 스켈레톤을 그려 jpg 로 저장 (단계가 제대로 잡혔는지 확인용)"""
    cap = cv2.VideoCapture(str(video_path))
    drawer, style = mp.solutions.drawing_utils, mp.solutions.pose
    for s, k in enumerate(keys):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frames[k]["idx"])
        ok, img = cap.read()
        if not ok:
            continue
        # 저장된 landmark 객체를 다시 그리기 위해 해당 프레임을 재검출
        with style.Pose(static_image_mode=True, model_complexity=2) as pose:
            res = pose.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            if res.pose_landmarks:
                drawer.draw_landmarks(img, res.pose_landmarks, style.POSE_CONNECTIONS)
        cv2.putText(img, f"{s}: {stage_names[s]}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
        cv2.imwrite(str(out_dir / f"reference_{club_id}_{view}_stage{s}.jpg"), img)
    cap.release()


def make_contact_sheet(video_path, club_id, view, out_dir, start=0.0, end=None,
                       interval=None, cols=6, thumb_w=280, max_thumbs=96):
    """
    영상을 일정 간격으로 캡처해 시각(초)이 적힌 한 장짜리 시각표 이미지를 만든다.
    - start/end : 보고 싶은 구간(초). 생략하면 영상 전체
    - interval  : 캡처 간격(초). 생략하면 구간을 약 48장으로 나눔 (최소 간격 = 1프레임)
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise SystemExit(f"영상을 열 수 없습니다: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total / fps

    start_f = max(0, int(round(start * fps)))
    end_f = min(total - 1, int(round((end if end is not None else duration) * fps)))
    if end_f <= start_f:
        raise SystemExit("구간이 올바르지 않습니다. --start 가 --end 보다 작아야 합니다.")

    span = end_f - start_f
    step = max(1, int(round(interval * fps))) if interval else max(1, round(span / 48))
    if span / step + 1 > max_thumbs:  # 너무 많으면 이미지가 커지므로 간격을 넓힘
        step = math.ceil(span / (max_thumbs - 1))
        print(f"※ 이미지가 너무 커져서 간격을 {step / fps:.2f}초로 넓혔습니다. 구간을 더 좁히세요.")

    thumbs = []
    for f in range(start_f, end_f + 1, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)  # 프레임 번호로 이동 (시간으로 이동하는 것보다 정확)
        ok, img = cap.read()
        if not ok:
            break
        h, w = img.shape[:2]
        small = cv2.resize(img, (thumb_w, int(thumb_w * h / w)))
        label = f"{f / fps:.2f}s"
        cv2.putText(small, label, (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)   # 글자 테두리
        cv2.putText(small, label, (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        thumbs.append(small)
    cap.release()
    if not thumbs:
        raise SystemExit("영상에서 프레임을 읽지 못했습니다.")

    th = thumbs[0].shape[0]
    while len(thumbs) % cols:
        thumbs.append(np.zeros((th, thumb_w, 3), dtype=np.uint8))
    rows = [np.hstack(thumbs[i:i + cols]) for i in range(0, len(thumbs), cols)]

    zoomed = start > 0 or end is not None
    suffix = f"_{start_f / fps:.1f}-{end_f / fps:.1f}s" if zoomed else ""
    out = out_dir / f"contact_sheet_{club_id}_{view}{suffix}.jpg"
    cv2.imwrite(str(out), np.vstack(rows))
    print(f"시각표 저장: {out}  (영상 {duration:.2f}초, 간격 {step / fps:.3f}초, {fps:.0f}fps)")
    print("→ 이미지를 보고 각 단계의 시각(초)을 읽은 뒤 --times 로 지정하세요.")
    print("  더 촘촘히 보려면: --sheet --start 1.5 --end 2.5 --interval 0.033  (0.033초 = 1프레임)")


def main():
    ap = argparse.ArgumentParser(description="프로 스윙 영상에서 단계별 기준 각도 JSON 추출")
    ap.add_argument("video", help="프로 스윙 영상 경로 (예: assets/driver_pro_front.mp4)")
    ap.add_argument("--club", choices=list(CLUBS), default="driver", help="클럽 종류 (기본: driver)")
    ap.add_argument("--view", choices=["front", "side"], required=True, help="촬영 시점")
    ap.add_argument("--out-dir", default="assets", help="결과 저장 폴더 (기본: assets)")
    ap.add_argument("--sheet", action="store_true", help="시각표 이미지만 만들고 종료")
    ap.add_argument("--times", help="7단계 시각(초)을 직접 지정. 예: 0.0,1.3,2.47,3.03,3.2,3.4,5.6")
    ap.add_argument("--start", type=float, default=0.0, help="분석 시작 시각(초)")
    ap.add_argument("--end", type=float, default=None, help="분석 종료 시각(초)")
    ap.add_argument("--interval", type=float, default=None, help="--sheet 일 때 캡처 간격(초). 예: 0.05")
    ap.add_argument("--no-preview", action="store_true", help="단계별 확인 이미지 저장 생략")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.sheet:
        make_contact_sheet(args.video, args.club, args.view, out_dir, args.start, args.end, args.interval)
        return

    club = CLUBS[args.club]
    stage_names = club["stages"]
    print(f"[{club['label']} / {args.view}] 프레임 분석 중… (영상 길이에 따라 수십 초 걸릴 수 있습니다)")
    frames, fps, aspect, duration = extract_frames(args.video, args.start, args.end)
    frames = cleanup_pose(frames, aspect)  # 웹(analyzer.js cleanupPose)과 같은 오인식 보정
    if args.times:  # 수동 지정: 입력한 시각에 가장 가까운 프레임 사용
        try:
            times = [float(x) for x in args.times.split(",")]
        except ValueError:
            raise SystemExit(f"--times 는 숫자 {len(stage_names)}개를 쉼표로 구분해서 입력하세요. 예: 0.0,1.3,2.47,3.03,3.2,3.4,5.6")
        if len(times) != len(stage_names) or times != sorted(times):
            raise SystemExit(f"--times 는 오름차순 숫자 {len(stage_names)}개여야 합니다. ({', '.join(stage_names)})")
        keys = [min(range(len(frames)), key=lambda i: abs(frames[i]["t"] - tt)) for tt in times]
    else:
        keys = club["detect_key_frames"](frames, aspect)
    # 규칙(움직임 기반)이 이 영상에서 찾는 사건 시각. 웹은 사용자 영상에서 같은 규칙으로 사건을 찾고,
    # (사람이 고른 시각 - 규칙 시각) 만큼 보정해서 같은 장면을 잡는다. (--times 를 안 쓰면 보정값 0)
    rule_keys = club["detect_key_frames"](frames, aspect)

    stages = []
    for s, k in enumerate(keys):
        angles = {n: round(v, 1) for n, v in frame_angles(frames[k]["lm"], aspect).items()}
        feat = pose_feature(frames[k]["lm"], aspect)  # 항상 4개 숫자를 돌려줌 (가려진 손목도 추정 좌표 사용)
        if len(angles) < 4:
            print(f"  ※ [{stage_names[s]}] 가려진 관절이 많아 비교 가능한 각도가 {len(angles)}개뿐입니다. (측면 영상은 흔한 현상)")
        stages.append({"name": stage_names[s], "time": round(frames[k]["t"], 3),
                       "ruleTime": round(frames[rule_keys[s]]["t"], 3), "angles": angles,
                       "feature": [round(v, 4) for v in feat],
                       # 프로 스켈레톤 표시용 33개 관절 [x, y, visibility] (영상 없이도 자세를 그릴 수 있음)
                       "landmarks": [[round(p.x, 4), round(p.y, 4), round(p.visibility, 3)]
                                     for p in frames[k]["lm"]]})
        print(f"  (움직임 규칙이 찾은 시각 {frames[rule_keys[s]]['t']:.2f}s → 보정값 {frames[k]['t'] - frames[rule_keys[s]]['t']:+.2f}s)")
        print(f"[{stage_names[s]}] {frames[k]['t']:.2f}s  {angles}")

    data = {"club": args.club, "view": args.view, "source": Path(args.video).name, "fps": round(fps, 2),
            "aspect": round(aspect, 4), "duration": round(duration, 2), "stages": stages}
    out_json = out_dir / f"reference_{args.club}_{args.view}.json"
    out_json.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장 완료: {out_json}")

    if not args.no_preview:
        save_previews(args.video, frames, keys, stage_names, args.club, args.view, out_dir)
        print(f"확인용 이미지 저장: {out_dir}/reference_{args.club}_{args.view}_stage0~{len(keys) - 1}.jpg")
        print(f"→ 이미지를 열어 {len(keys)}단계가 실제 스윙 동작과 맞는지 꼭 확인하세요.")


if __name__ == "__main__":
    main()
