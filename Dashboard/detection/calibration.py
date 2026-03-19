# ============================================================
#  detection/calibration.py  —  Auto-calibration system
# ============================================================
import cv2
import json
import os
import sys
import numpy as np
import mediapipe as mp
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import CALIB_DIR, CALIB_SAMPLES, CALIB_DISCARD_FIRST, EAR_MARGIN, MAR_MARGIN, BEEP_PATH


def _play_step_beep():
    """Play beep.wav when a calibration step completes (if file exists)."""
    if not os.path.isfile(BEEP_PATH):
        return
    try:
        if sys.platform == "win32":
            import winsound
            winsound.PlaySound(BEEP_PATH, winsound.SND_FILENAME | winsound.SND_NODEFAULT)
        else:
            import pyglet
            sound = pyglet.media.load(BEEP_PATH, streaming=False)
            sound.play()
            for _ in range(5):
                pyglet.clock.tick()
    except Exception:
        pass

L_EYE = [159, 145, 33, 133]
R_EYE = [386, 374, 362, 263]
MOUTH = [13, 14, 78, 308]


def _ear(lm, eye):
    v = np.linalg.norm([lm[eye[0]].x - lm[eye[1]].x, lm[eye[0]].y - lm[eye[1]].y])
    h = np.linalg.norm([lm[eye[2]].x - lm[eye[3]].x, lm[eye[2]].y - lm[eye[3]].y])
    return v / h if h > 1e-6 else 0.0


def _mar(lm):
    v = np.linalg.norm([lm[MOUTH[0]].x - lm[MOUTH[1]].x, lm[MOUTH[0]].y - lm[MOUTH[1]].y])
    h = np.linalg.norm([lm[MOUTH[2]].x - lm[MOUTH[3]].x, lm[MOUTH[2]].y - lm[MOUTH[3]].y])
    return v / h if h > 1e-6 else 0.0


def _draw_ui(img, title, instr, hint, progress, color):
    h, w = img.shape[:2]
    ov = img.copy()
    cv2.rectangle(ov, (0, 0), (w, h), (5, 8, 20), -1)
    cv2.addWeighted(ov, 0.65, img, 0.35, 0, img)
    cv2.rectangle(img, (20, 20), (w-20, h-20), color, 1)
    L = 30
    for cx, cy, dx, dy in [(20,20,1,1),(w-20,20,-1,1),(20,h-20,1,-1),(w-20,h-20,-1,-1)]:
        cv2.line(img, (cx,cy), (cx+dx*L, cy), color, 2)
        cv2.line(img, (cx,cy), (cx, cy+dy*L), color, 2)
    f1, f2 = cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(img, "EMS CALIBRATION", (w//2-190, 60), f1, 0.9, color, 1)
    cv2.putText(img, title,  (w//2-200, 140), f1,  1.0, (255,255,255), 2)
    cv2.putText(img, instr,  (w//2-180, 200), f2, 0.75, (180,220,255), 1)
    cv2.putText(img, hint,   (w//2-150, 235), f2, 0.60, (120,150,180), 1)
    bx, by, bw, bh = 100, 290, w-200, 18
    cv2.rectangle(img, (bx, by), (bx+bw, by+bh), (30,40,60), -1)
    cv2.rectangle(img, (bx, by), (bx+int(bw*min(progress,1.0)), by+bh), color, -1)
    cv2.putText(img, f"{int(progress*100)}%", (bx+bw//2-18, by+14), f2, 0.55, (255,255,255), 1)
    cv2.putText(img, "Press SPACE to start  |  ESC to cancel",
                (w//2-185, h-40), f2, 0.6, (90,120,150), 1)


def _collect(cap, face_mesh, title, instr, hint, color):
    ear_s, mar_s, idx = [], [], 0
    while True:
        ok, frame = cap.read()
        if not ok: continue
        frame = cv2.flip(frame, 1)
        res   = face_mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        coll  = max(0, idx - CALIB_DISCARD_FIRST)
        _draw_ui(frame, title, instr, hint, coll / CALIB_SAMPLES, color)
        if res.multi_face_landmarks:
            lm  = res.multi_face_landmarks[0].landmark
            ear = (_ear(lm, L_EYE) + _ear(lm, R_EYE)) / 2
            mar = _mar(lm)
            if idx >= CALIB_DISCARD_FIRST:
                ear_s.append(ear); mar_s.append(mar)
            cv2.putText(frame, "Measuring...",
                        (40, frame.shape[0]-25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,120), 1)
        else:
            cv2.putText(frame, "NO FACE DETECTED", (80, frame.shape[0]-25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,60,200), 1)
        idx += 1
        cv2.imshow("EMS Calibration", frame)
        cv2.waitKey(1)
        if len(ear_s) >= CALIB_SAMPLES:
            break
    return (float(np.mean(ear_s)), float(np.mean(mar_s))) if len(ear_s) >= CALIB_SAMPLES * 0.6 else (None, None)


def run_calibration(cap, employee_id, employee_name, camera_id=0):
    mp_fm     = mp.solutions.face_mesh
    face_mesh = mp_fm.FaceMesh(max_num_faces=1, refine_landmarks=True,
                                min_detection_confidence=0.6, min_tracking_confidence=0.6)
    phases = [
        ("PHASE 1 / 3", "EYES OPEN — MOUTH CLOSED",  "Look naturally at camera",  (0,220,255)),
        ("PHASE 2 / 3", "CLOSE EYES GENTLY",         "Simulate drowsy/sleep",     (0,100,255)),
        ("PHASE 3 / 3", "OPEN MOUTH WIDE",            "Simulate full yawn",        (0,255,150)),
    ]
    results = []
    for title, instr, hint, color in phases:
        while True:
            ok, frame = cap.read()
            if not ok: continue
            frame = cv2.flip(frame, 1)
            _draw_ui(frame, title, instr, hint, 0.0, color)
            cv2.imshow("EMS Calibration", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord(' '), 13): break
            if key == 27: face_mesh.close(); return None
        ear_m, mar_m = _collect(cap, face_mesh, title, instr, hint, color)
        if ear_m is None: face_mesh.close(); return None
        results.append((ear_m, mar_m))
        _play_step_beep()

    face_mesh.close()
    cv2.destroyWindow("EMS Calibration")

    open_ear, open_mar  = results[0]
    closed_ear, _        = results[1]
    _, yawn_mar          = results[2]
    ear_thr = open_ear  - (open_ear - closed_ear) * EAR_MARGIN
    mar_thr = open_mar  + (yawn_mar - open_mar)   * MAR_MARGIN

    profile = {
        "employee_id": employee_id, "employee_name": employee_name,
        "camera_id": camera_id,
        "timestamp": datetime.now().isoformat(),
        "open_ear": round(open_ear, 4), "closed_ear": round(closed_ear, 4),
        "open_mar": round(open_mar, 4), "yawn_mar": round(yawn_mar, 4),
        "ear_threshold": round(ear_thr, 4), "mar_threshold": round(mar_thr, 4),
    }
    path = _calib_path(employee_id, camera_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(profile, f, indent=2)
    return profile


def _calib_path(employee_id, camera_id):
    return os.path.join(CALIB_DIR, f"emp_{employee_id}_cam_{camera_id}.json")


def load_calibration(employee_id, camera_id=0):
    """Load calibration for this employee + camera. Falls back to legacy emp_{id}.json if present."""
    path = _calib_path(employee_id, camera_id)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    legacy = os.path.join(CALIB_DIR, f"emp_{employee_id}.json")
    if os.path.exists(legacy):
        with open(legacy) as f:
            return json.load(f)
    return None
