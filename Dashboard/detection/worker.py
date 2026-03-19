# ============================================================
#  detection/worker.py  —  Per-camera detection QThread
#  Features: EAR tiredness/sleep, pose sleep, phone (YOLO),
#  hand-near-ear gesture (phone call posture, FR-3),
#  absence, crowding (FR-5), auto-reconnect (FR-7),
#  shift-aware suppression (FR-6), MQTT/Redis publish (FR-9),
#  shift-aware attendance status (FR-1)
# ============================================================
import cv2
import time
import sys
import os
import logging
import numpy as np
from datetime import datetime, date
from PyQt5.QtCore import QThread, pyqtSignal, QMutex, QMutexLocker

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import (
    CAM_WIDTH, CAM_HEIGHT, CAM_FPS, EVIDENCE_DIR, FACE_INDEX_DIR,
    DEFAULT_EAR_THRESHOLD, DEFAULT_MAR_THRESHOLD, DROWSY_SECONDS, SLEEP_SECONDS,
    YAWN_SECONDS, PHONE_CONF_THRESHOLD, PHONE_TRIGGER_SECONDS,
    HAND_PHONE_OVERLAP_IOU, FACE_PHONE_EXPAND_RATIO, HAND_EAR_DIST_THRESHOLD,
    ABSENCE_TRIGGER_SECONDS,
    W_SLEEP, W_PHONE, W_ABSENCE, COCO_PHONE, SHOW_CAMERA_OVERLAY,
    SAVE_IMAGE_ON_PHONE, SAVE_IMAGE_ON_SLEEP, SAVE_IMAGE_ON_DROWSY,
    SAVE_IMAGE_ON_ABSENCE, ATTENDANCE_COOLDOWN_SEC, INFERENCE_DEVICE,
)
from database import get_db
from detection.calibration import load_calibration

logger = logging.getLogger(__name__)

# MediaPipe landmark indices
L_EYE    = [159, 145,  33, 133]
R_EYE    = [386, 374, 362, 263]
MOUTH    = [ 13,  14,  78, 308]
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
             397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
             172,  58, 132,  93, 234, 127, 162,  21,  54, 103,  67, 109]

# HUD colours (BGR)
CYAN   = (255, 220,   0)
GREEN  = (128, 255,   0)
RED    = ( 50,  50, 230)
YELLOW = (  0, 200, 255)
PURPLE = (255,  50, 200)
ORANGE = (  0, 140, 255)


# ── State machine ─────────────────────────────────────────────
class EventState:
    """Rising-edge detector: emits START when condition holds ≥ trigger_secs."""

    def __init__(self, trigger_secs: float):
        self.trigger_secs = trigger_secs
        self.start_time   = None
        self.active       = False
        self.db_event_id  = None
        self._elapsed     = 0.0

    def update(self, condition: bool, now: float) -> "str | None":
        """Update state. Returns 'START', 'END', or None."""
        if condition:
            if self.start_time is None:
                self.start_time = now
            self._elapsed = now - self.start_time
            if self._elapsed >= self.trigger_secs and not self.active:
                self.active = True
                return "START"
        else:
            if self.active:
                self._reset()
                return "END"
            self._reset()
        return None

    def _reset(self):
        self.start_time  = None
        self.active      = False
        self.db_event_id = None
        self._elapsed    = 0.0

    @property
    def elapsed(self) -> float:
        return self._elapsed


# ── Geometry helpers ──────────────────────────────────────────
def _ear(lm, eye):
    v = np.linalg.norm([lm[eye[0]].x - lm[eye[1]].x, lm[eye[0]].y - lm[eye[1]].y])
    h = np.linalg.norm([lm[eye[2]].x - lm[eye[3]].x, lm[eye[2]].y - lm[eye[3]].y])
    return v / h if h > 1e-6 else 0.0


def _mar(lm):
    v = np.linalg.norm([lm[MOUTH[0]].x - lm[MOUTH[1]].x, lm[MOUTH[0]].y - lm[MOUTH[1]].y])
    h = np.linalg.norm([lm[MOUTH[2]].x - lm[MOUTH[3]].x, lm[MOUTH[2]].y - lm[MOUTH[3]].y])
    return v / h if h > 1e-6 else 0.0


def _bbox_iou(b1, b2):
    x1 = max(b1[0], b2[0]); y1 = max(b1[1], b2[1])
    x2 = min(b1[2], b2[2]); y2 = min(b1[3], b2[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    a1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
    a2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
    return inter / (a1 + a2 - inter + 1e-6)


def _expand_bbox(bbox, ratio, w, h):
    cx = (bbox[0] + bbox[2]) / 2; cy = (bbox[1] + bbox[3]) / 2
    hw = (bbox[2] - bbox[0]) * ratio / 2; hh = (bbox[3] - bbox[1]) * ratio / 2
    return (max(0, int(cx - hw)), max(0, int(cy - hh)),
            min(w, int(cx + hw)), min(h, int(cy + hh)))


def _hand_near_ear(hand_landmarks_list, ear_pts_norm: list,
                   threshold: float = HAND_EAR_DIST_THRESHOLD) -> tuple[bool, str]:
    """Detect phone-call posture: hand raised to ear level.

    Checks whether any key hand landmark (wrist + all 5 fingertips) is within
    *threshold* normalised distance of either ear landmark.  Returns
    ``(detected: bool, side: str)`` where *side* is ``"left"``, ``"right"``,
    or ``""`` when not detected.

    Parameters
    ----------
    hand_landmarks_list : list of MediaPipe NormalizedLandmarkList
        All detected hands from mp.solutions.hands.Hands.process().
    ear_pts_norm : list of (x, y) tuples in normalised [0, 1] space
        Ear reference points (left ear, right ear) from Pose or FaceMesh.
    threshold : float
        Euclidean distance in normalised coordinates below which we consider
        the hand to be at the ear.
    """
    if not hand_landmarks_list or not ear_pts_norm:
        return False, ""

    # Wrist (0) + all five fingertips (4, 8, 12, 16, 20)
    KEY_INDICES = (0, 4, 8, 12, 16, 20)
    # Ear side labels paired with ear_pts_norm order
    SIDES = ("left", "right")

    for hl in hand_landmarks_list:
        lm = hl.landmark
        for ki in KEY_INDICES:
            hx, hy = lm[ki].x, lm[ki].y
            for side_idx, (ex, ey) in enumerate(ear_pts_norm):
                dist = ((hx - ex) ** 2 + (hy - ey) ** 2) ** 0.5
                if dist < threshold:
                    return True, SIDES[side_idx] if side_idx < len(SIDES) else ""
    return False, ""


def _save_evidence(frame: np.ndarray, tag: str, emp_id: int, cam_id: int) -> str:
    """Save an evidence frame to disk; return the path."""
    ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(EVIDENCE_DIR, f"evidence_emp{emp_id}_cam{cam_id}_{tag}_{ts}.jpg")
    try:
        cv2.imwrite(path, frame)
    except Exception as exc:
        logger.warning("[Worker] Evidence save failed: %s", exc)
        path = ""
    return path


# ── HUD overlay ───────────────────────────────────────────────
def _hud_box(img, x1, y1, x2, y2, color=CYAN, label="", thickness=1):
    L = 16
    for px, py, dx, dy in [(x1, y1, 1, 1), (x2, y1, -1, 1),
                            (x1, y2, 1, -1), (x2, y2, -1, -1)]:
        cv2.line(img, (px, py), (px + dx * L, py), color, 2)
        cv2.line(img, (px, py), (px, py + dy * L), color, 2)
    cv2.rectangle(img, (x1, y1), (x2, y2), (*color[:2], int(color[2] * 0.3)), 1)
    if label:
        cv2.putText(img, label, (x1 + 5, y1 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)


def _draw_hud_overlay(img: np.ndarray, metrics: dict) -> np.ndarray:
    """Render monitoring HUD onto frame copy."""
    h, w = img.shape[:2]
    f    = cv2.FONT_HERSHEY_SIMPLEX
    sf   = min(1.8, max(0.9, min(h, w) / 720.0))
    thick = max(1, int(round(sf)))

    # Top-left panel
    pw, ph = int(200 * sf), int(36 * sf)
    cv2.rectangle(img, (8, 8), (8 + pw, 8 + ph), (5, 12, 25), -1)
    cv2.rectangle(img, (8, 8), (8 + pw, 8 + ph), CYAN, thick)
    cv2.putText(img, f"Rate {metrics.get('fps', 0):.1f}",
                (14, 8 + int(24 * sf)), f, 0.45 * sf, GREEN, thick)

    states = []
    if metrics.get("sleep"):       states.append(("SLEEP",   RED))
    elif metrics.get("drowsy"):    states.append(("DROWSY",  ORANGE))
    if metrics.get("yawn"):        states.append(("YAWN",    YELLOW))
    if metrics.get("phone"):       states.append(("PHONE",   PURPLE))
    if metrics.get("absent"):      states.append(("ABSENT",  (0, 120, 255)))
    if metrics.get("crowding"):    states.append(("CROWD",   (0, 200, 255)))
    if not states:                 states = [("ACTIVE", GREEN)]
    sx = int(100 * sf)
    for label, color in states:
        tw = int((len(label) * 8 + 12) * sf)
        cv2.rectangle(img, (sx, 8 + 6), (sx + tw, 8 + ph - 6), color, -1)
        cv2.putText(img, label, (sx + int(4 * sf), 8 + int(22 * sf)),
                    f, 0.45 * sf, (0, 0, 0), thick)
        sx += tw + int(4 * sf)

    # Bottom-right timer panel
    tw_p, th_p = int(220 * sf), int(160 * sf)
    bx, by = w - tw_p - 12, h - th_p - 12
    cv2.rectangle(img, (bx, by), (w - 8, h - 8), (5, 12, 25), -1)
    cv2.rectangle(img, (bx, by), (w - 8, h - 8), CYAN, thick)
    cv2.putText(img, "SESSION TIMERS",
                (bx + int(12 * sf), by + int(22 * sf)), f, 0.55 * sf, CYAN, thick)
    ty = by + int(42 * sf)
    for lbl, secs, col in [
        ("WORK",   metrics.get("session_work", 0),    GREEN),
        ("SLEEP",  metrics.get("session_sleep", 0),   RED),
        ("PHONE",  metrics.get("session_phone", 0),   PURPLE),
        ("ABSENT", metrics.get("session_absence", 0), (0, 120, 255)),
    ]:
        m, s = divmod(int(secs), 60)
        cv2.putText(img, f"{lbl:<7} {m:02d}:{s:02d}",
                    (bx + int(12 * sf), ty), f, 0.55 * sf, col, thick)
        ty += int(26 * sf)
    prod = metrics.get("productivity", 100.0)
    pcol = GREEN if prod >= 80 else (ORANGE if prod >= 60 else RED)
    cv2.putText(img, f"PROD: {prod:.0f}%",
                (bx + int(12 * sf), ty + int(6 * sf)), f, 0.62 * sf, pcol, thick)

    # Shift label
    shift_lbl = metrics.get("shift_label", "")
    if shift_lbl:
        cv2.putText(img, f"SHIFT: {shift_lbl}",
                    (bx + int(12 * sf), by - int(8 * sf)), f, 0.48 * sf, CYAN, thick)

    # Suppress banner
    if metrics.get("suppressed"):
        reason = metrics.get("suppress_reason", "break")
        banner = f"SUPPRESSED [{reason.upper()}]"
        (tw2, th2), _ = cv2.getTextSize(banner, f, 0.8 * sf, thick)
        cx = (w - tw2) // 2
        cv2.rectangle(img, (cx - 8, h // 2 - th2 - 14),
                      (cx + tw2 + 8, h // 2 + 14), (0, 60, 120), -1)
        cv2.putText(img, banner, (cx, h // 2 + th2 // 2),
                    f, 0.8 * sf, CYAN, thick)

    # Top-right timestamp
    ts = datetime.now().strftime("%Y-%m-%d  %H:%M:%S")
    cv2.putText(img, ts, (w - int(260 * sf), int(30 * sf)), f, 0.52 * sf, CYAN, thick)

    # Center caption
    if metrics.get("suppressed"):
        caption, cap_col = metrics.get("suppress_reason", "break").upper(), CYAN
    elif metrics.get("sleep"):
        caption, cap_col = "Sleeping",   RED
    elif metrics.get("drowsy"):
        caption, cap_col = "Drowsiness", ORANGE
    elif metrics.get("crowding"):
        caption, cap_col = "Crowding",   (0, 200, 255)
    elif metrics.get("phone"):
        caption, cap_col = "Phone use",  PURPLE
    elif metrics.get("absent"):
        caption, cap_col = "Absent",     (0, 120, 255)
    else:
        caption, cap_col = "Working",    GREEN
    cap_fs = 1.0 * sf
    (cw, ct), _ = cv2.getTextSize(caption, f, cap_fs, thick)
    cx2 = (w - cw) // 2
    pad = int(14 * sf)
    cv2.rectangle(img, (cx2 - pad, 4), (cx2 + cw + pad, 4 + ct + int(18 * sf)),
                  (5, 12, 25), -1)
    cv2.rectangle(img, (cx2 - pad, 4), (cx2 + cw + pad, 4 + ct + int(18 * sf)),
                  cap_col, thick)
    cv2.putText(img, caption, (cx2, 4 + ct + int(12 * sf)), f, cap_fs, cap_col, thick)
    return img


# ── Detection Worker ──────────────────────────────────────────
class DetectionWorker(QThread):
    """Per-camera background detection thread.

    Signals
    -------
    frame_ready(camera_id, frame)
        New BGR frame ready for display.
    metrics_updated(camera_id, metrics_dict)
        Live per-frame metrics.
    alert_triggered(camera_id, alert_type, message, severity)
        A new alert condition has fired.
    status_changed(camera_id, message)
        Informational status update.
    attendance_logged(employee_id, camera_id)
        Face recognition attendance event.
    camera_disconnected(camera_id)
        Camera stream lost.
    camera_reconnected(camera_id)
        Camera stream restored.
    """

    frame_ready        = pyqtSignal(int, np.ndarray)
    metrics_updated    = pyqtSignal(int, dict)
    alert_triggered    = pyqtSignal(int, str, str, str)   # cam_id, type, msg, severity
    status_changed     = pyqtSignal(int, str)
    attendance_logged  = pyqtSignal(int, int)              # emp_id, cam_id
    camera_disconnected = pyqtSignal(int)
    camera_reconnected  = pyqtSignal(int)

    # Reconnect interval (seconds) — configurable via system_config
    _RECONNECT_INTERVAL = 15

    def __init__(self, employee_id: int, cam_index=0, camera_id: int = 0):
        super().__init__()
        self.employee_id = employee_id
        self.cam_index   = cam_index
        self.camera_id   = camera_id
        self._running    = False
        self._mutex      = QMutex()
        self.session_id  = None

        # Per-employee calibration
        calib = load_calibration(employee_id, self.camera_id)
        self.ear_thr = calib["ear_threshold"] if calib else DEFAULT_EAR_THRESHOLD
        self.mar_thr = calib["mar_threshold"] if calib else DEFAULT_MAR_THRESHOLD

        # Load DB config thresholds
        db = get_db()
        self._fr_interval      = db.get_config_int("face_recognition_interval", 30)
        self._tiredness_secs   = db.get_config_int("tiredness_alert_minutes", 5) * 60
        self._sleep_secs       = db.get_config_int("sleep_alert_seconds", 60)
        self._phone_secs       = db.get_config_int("phone_alert_seconds", 30)
        self._absence_secs     = db.get_config_int("absence_alert_minutes", 5) * 60
        self._crowd_persons    = db.get_config_int("crowding_threshold_persons", 2)
        self._crowd_secs       = db.get_config_int("crowding_alert_minutes", 2) * 60
        self._site_id          = db.get_config("site_id", "banglalink")
        self._reconnect_secs   = 15

        # State machines (use DB-backed thresholds)
        self.sm_drowsy  = EventState(DROWSY_SECONDS)
        self.sm_sleep   = EventState(max(self._sleep_secs, SLEEP_SECONDS))
        self.sm_yawn    = EventState(YAWN_SECONDS)
        self.sm_phone   = EventState(self._phone_secs)
        self.sm_absent  = EventState(self._absence_secs)
        self.sm_crowd   = EventState(self._crowd_secs)   # FR-5

        # Session accumulators
        self.acc_sleep   = 0.0
        self.acc_drowsy  = 0.0
        self.acc_phone   = 0.0
        self.acc_absent  = 0.0
        self.acc_work    = 0.0
        self.yawn_count  = 0
        self.phone_count = 0

        self._last_tick            = None
        self._fps                  = 0.0
        self._fps_t                = time.time()
        self._fps_cnt              = 0
        self._last_face_recognition = 0.0
        self._last_recognized_name  = None
        self._last_recognized_name_ts = 0.0
        self._is_disconnected       = False
        self._last_summary_ts       = 0.0

    def reload_calibration(self):
        """Reload EAR/MAR thresholds from calibration file."""
        calib = load_calibration(self.employee_id, self.camera_id)
        if calib:
            self.ear_thr = calib["ear_threshold"]
            self.mar_thr = calib["mar_threshold"]

    def stop(self):
        with QMutexLocker(self._mutex):
            self._running = False

    # ── Main thread entry ─────────────────────────────────────
    def run(self):
        self._running = True
        db = get_db()
        self.session_id = db.start_session(self.employee_id, self.cam_index)
        self.status_changed.emit(self.camera_id, "Loading models…")

        # ── MediaPipe ────────────────────────────────────────
        import mediapipe as mp
        face_mesh   = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1, refine_landmarks=True,
            min_detection_confidence=0.55, min_tracking_confidence=0.55)
        hands_det   = mp.solutions.hands.Hands(
            max_num_hands=2, model_complexity=0,
            min_detection_confidence=0.50, min_tracking_confidence=0.50)
        pose_det    = mp.solutions.pose.Pose(
            min_detection_confidence=0.50, min_tracking_confidence=0.50)

        # ── Inference device ─────────────────────────────────
        device = INFERENCE_DEVICE.strip().lower()
        if device == "auto":
            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                device = "cpu"
        if device not in ("cpu", "cuda", "cuda:0", "0"):
            device = "cpu"

        # ── YOLO (phone + person) ────────────────────────────
        phone_detector = None
        try:
            from ultralytics import YOLO
            phone_detector = YOLO(
                os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "yolov8n.pt")
            )
            self.status_changed.emit(self.camera_id, "Ready")
        except Exception:
            logger.warning("[Worker cam%d] YOLO unavailable", self.camera_id)
            self.status_changed.emit(self.camera_id, "Phone/crowd detection unavailable")

        # ── Camera ───────────────────────────────────────────
        cap = self._open_camera()
        self.status_changed.emit(self.camera_id, "Monitoring")
        self._last_tick = time.time()
        today_str = date.today().isoformat()

        score = 100.0   # ensure defined for cleanup even if no frames

        # ── Main loop ─────────────────────────────────────────
        while True:
            with QMutexLocker(self._mutex):
                if not self._running:
                    break

            # ── Frame acquisition with auto-reconnect ─────────
            ok, frame = cap.read()
            if not ok or frame is None:
                if not self._is_disconnected:
                    self._is_disconnected = True
                    self.camera_disconnected.emit(self.camera_id)
                    self.status_changed.emit(self.camera_id, "⚠ Disconnected — reconnecting…")
                    self.alert_triggered.emit(
                        self.camera_id, "DISCONNECT",
                        f"Cam {self.camera_id + 1} disconnected", "critical"
                    )
                    logger.warning("[Worker cam%d] Stream lost", self.camera_id)
                time.sleep(self._reconnect_secs)
                cap.release()
                cap = self._open_camera()
                continue

            if self._is_disconnected:
                self._is_disconnected = False
                self.camera_reconnected.emit(self.camera_id)
                self.status_changed.emit(self.camera_id, "Monitoring")
                self.alert_triggered.emit(
                    self.camera_id, "RECONNECT",
                    f"Cam {self.camera_id + 1} reconnected", "info"
                )
                logger.info("[Worker cam%d] Stream restored", self.camera_id)

            frame = cv2.flip(frame, 1)
            h, w  = frame.shape[:2]
            now   = time.time()
            dt    = now - self._last_tick
            self._last_tick = now
            self.acc_work  += dt

            # FPS
            self._fps_cnt += 1
            if now - self._fps_t >= 1.0:
                self._fps = self._fps_cnt / (now - self._fps_t)
                self._fps_cnt = 0
                self._fps_t   = now

            # Day rollover
            new_day = date.today().isoformat()
            if new_day != today_str:
                today_str = new_day

            # ── Shift / break suppression (FR-6) ──────────────
            from shifts import should_suppress_alert, get_shift_for_employee
            suppressed, suppress_reason = should_suppress_alert(self.employee_id)
            shift_info = get_shift_for_employee(self.employee_id)
            shift_label = shift_info["label"] if shift_info else ""

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # ── FaceMesh ──────────────────────────────────────
            fm_res      = face_mesh.process(rgb)
            face_present = bool(fm_res.multi_face_landmarks)
            ear_val, mar_val = 0.0, 0.0
            face_bbox_px = None

            if face_present:
                lm = fm_res.multi_face_landmarks[0].landmark
                ear_val = (_ear(lm, L_EYE) + _ear(lm, R_EYE)) / 2
                mar_val = _mar(lm)
                xs = [int(l.x * w) for l in lm]
                ys = [int(l.y * h) for l in lm]
                face_bbox_px = (min(xs), min(ys), max(xs), max(ys))
                if SHOW_CAMERA_OVERLAY:
                    for i in range(len(FACE_OVAL) - 1):
                        p1 = (int(lm[FACE_OVAL[i]].x * w), int(lm[FACE_OVAL[i]].y * h))
                        p2 = (int(lm[FACE_OVAL[i+1]].x * w), int(lm[FACE_OVAL[i+1]].y * h))
                        cv2.line(frame, p1, p2, (0, 80, 120), 1)

            # ── Pose (head drop → sleep posture, FR-2) ────────
            head_dropped  = False
            ear_pts_norm  = []   # [(x,y), ...] normalised; used by hand-near-ear
            pose_res = pose_det.process(rgb)
            if pose_res.pose_landmarks:
                lm_p = pose_res.pose_landmarks.landmark
                # Nose (0) vs. left/right shoulder (11,12) — head drop when
                # nose y > (shoulder_y − 0.05) meaning head falls toward chest
                nose_y   = lm_p[0].y
                lshld_y  = lm_p[11].y
                rshld_y  = lm_p[12].y
                shld_y   = (lshld_y + rshld_y) / 2
                if nose_y > (shld_y - 0.05):
                    head_dropped = True

                # MP Pose: landmark 7 = left ear, 8 = right ear
                # Only use when visibility is acceptable (≥ 0.5)
                for idx in (7, 8):
                    lmk = lm_p[idx]
                    if lmk.visibility >= 0.5:
                        ear_pts_norm.append((lmk.x, lmk.y))

            # Fallback: derive ear region from FaceMesh when Pose ears are
            # occluded — FaceMesh landmark 234 ≈ right ear, 454 ≈ left ear
            if not ear_pts_norm and face_present:
                lm_f = fm_res.multi_face_landmarks[0].landmark
                ear_pts_norm = [(lm_f[454].x, lm_f[454].y),
                                (lm_f[234].x, lm_f[234].y)]

            # ── Hands ─────────────────────────────────────────
            hd_res      = hands_det.process(rgb)
            hand_bboxes = []
            if hd_res.multi_hand_landmarks:
                for hl in hd_res.multi_hand_landmarks:
                    xs2 = [int(l.x * w) for l in hl.landmark]
                    ys2 = [int(l.y * h) for l in hl.landmark]
                    hb  = (min(xs2), min(ys2), max(xs2), max(ys2))
                    hand_bboxes.append(hb)
                    if SHOW_CAMERA_OVERLAY:
                        _hud_box(frame, *hb, color=(150, 80, 255), label="HAND")

            # ── Hand-near-ear gesture (phone call posture, FR-3) ──
            # Triggered when a hand is raised to ear level even without an
            # object being detected — covers hidden/small phones, earpiece
            # use, and cases where YOLO confidence is below threshold.
            hand_near_ear, ear_side = _hand_near_ear(
                hd_res.multi_hand_landmarks if hd_res.multi_hand_landmarks else [],
                ear_pts_norm,
                HAND_EAR_DIST_THRESHOLD,
            )
            if SHOW_CAMERA_OVERLAY and hand_near_ear and ear_pts_norm:
                # Draw an alert circle at the closest ear position
                for ex, ey in ear_pts_norm:
                    ep = (int(ex * w), int(ey * h))
                    cv2.circle(frame, ep, int(0.04 * min(h, w)), PURPLE, 2)
                    cv2.putText(frame, f"HAND@EAR({ear_side[0].upper()})",
                                (ep[0] + 6, ep[1] - 6),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.42, PURPLE, 1)

            # ── YOLO: phone + person detection ────────────────
            phone_detected   = False
            phone_in_hand    = False
            phone_near_face  = False
            phone_bboxes     = []
            person_count     = 0

            if phone_detector is not None:
                try:
                    results = phone_detector(
                        frame, conf=PHONE_CONF_THRESHOLD,
                        classes=[COCO_PHONE, 0],     # 0 = person
                        verbose=False, device=device
                    )
                    for r in results:
                        for box in r.boxes:
                            cls  = int(box.cls[0])
                            conf = float(box.conf[0])
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            if cls == 0:   # person
                                person_count += 1
                                if SHOW_CAMERA_OVERLAY:
                                    _hud_box(frame, x1, y1, x2, y2,
                                             color=(0, 200, 255), label=f"P{person_count}")
                            elif cls == COCO_PHONE:
                                phone_bboxes.append((x1, y1, x2, y2, conf))
                                for hb in hand_bboxes:
                                    if _bbox_iou((x1, y1, x2, y2), hb) > HAND_PHONE_OVERLAP_IOU:
                                        phone_in_hand = True
                                if face_bbox_px:
                                    exp = _expand_bbox(face_bbox_px, FACE_PHONE_EXPAND_RATIO, w, h)
                                    if _bbox_iou((x1, y1, x2, y2), exp) > 0.05:
                                        phone_near_face = True
                                if SHOW_CAMERA_OVERLAY:
                                    _hud_box(frame, x1, y1, x2, y2,
                                             color=PURPLE, label=f"PHONE {conf:.2f}")
                    phone_detected = (len(phone_bboxes) > 0 and
                                      (phone_in_hand or phone_near_face or not hand_bboxes))
                except Exception as exc:
                    logger.debug("[Worker cam%d] YOLO error: %s", self.camera_id, exc)

            # ── Detection conditions ──────────────────────────
            # Drowsy: EAR low for short duration (not yet sleep threshold)
            # Sleep: EAR low > sleep_secs OR head_dropped > sleep_secs (FR-2)
            is_drowsy = face_present and ear_val < self.ear_thr
            is_sleep  = face_present and ear_val < self.ear_thr and self.sm_drowsy.elapsed >= DROWSY_SECONDS
            is_sleep  = is_sleep or (face_present and head_dropped)
            is_yawn   = face_present and mar_val > self.mar_thr
            # Phone (FR-3): YOLO object detection OR hand raised to ear
            # (hand_near_ear catches calls where the phone/earpiece is not
            # visible but the distinctive wrist-to-ear posture is clear)
            is_phone  = phone_detected or hand_near_ear
            is_absent = not face_present
            is_crowd  = person_count >= self._crowd_persons   # FR-5

            # ── Apply suppression ─────────────────────────────
            if suppressed:
                # During break/off-day still collect frames but emit no alerts
                is_drowsy = is_sleep = is_yawn = is_phone = is_absent = is_crowd = False

            # ── Drowsy ───────────────────────────────────────
            ev = self.sm_drowsy.update(is_drowsy and not is_sleep, now)
            if ev == "START":
                eid = db.log_instant_event(self.session_id, self.employee_id,
                                           "drowsy", "warning")
                if SAVE_IMAGE_ON_DROWSY:
                    path = _save_evidence(frame, "drowsy", self.employee_id, self.camera_id)
                    if path:
                        db.update_event_image(eid, path)
                self._publish_and_alert("drowsy", "Drowsiness detected!", "medium",
                                        shift_label, frame)

            # ── Sleep ─────────────────────────────────────────
            ev = self.sm_sleep.update(is_sleep, now)
            if ev == "START":
                eid = db.log_event_start(self.session_id, self.employee_id, "sleep", "critical")
                self.sm_sleep.db_event_id = eid
                if SAVE_IMAGE_ON_SLEEP:
                    path = _save_evidence(frame, "sleep", self.employee_id, self.camera_id)
                    if path:
                        db.update_event_image(eid, path)
                self._publish_and_alert("sleep", "Employee asleep!", "high", shift_label, frame)
            elif ev == "END" and self.sm_sleep.db_event_id:
                dur = db.log_event_end(self.sm_sleep.db_event_id)
                if dur:
                    self.acc_sleep += dur
            if self.sm_sleep.active:
                self.acc_sleep += dt

            # ── Yawn ──────────────────────────────────────────
            ev = self.sm_yawn.update(is_yawn, now)
            if ev == "START":
                self.yawn_count += 1
                db.log_instant_event(self.session_id, self.employee_id,
                                     "yawn", "info", f"Yawn #{self.yawn_count}")
                self.alert_triggered.emit(
                    self.camera_id, "YAWN", f"Yawn #{self.yawn_count}", "info"
                )

            # ── Phone ─────────────────────────────────────────
            ev = self.sm_phone.update(is_phone, now)
            if ev == "START":
                self.phone_count += 1
                # Describe what triggered the alert for audit purposes
                if hand_near_ear and not phone_detected:
                    trigger_note = f"gesture: hand near {ear_side} ear"
                    alert_msg    = f"Phone call posture detected ({ear_side} ear)!"
                elif hand_near_ear and phone_detected:
                    trigger_note = (f"yolo+gesture: in_hand={phone_in_hand} "
                                    f"near_face={phone_near_face} "
                                    f"hand_near_{ear_side}_ear=True")
                    alert_msg    = "Phone usage detected (object + posture)!"
                else:
                    trigger_note = f"yolo: in_hand={phone_in_hand} near_face={phone_near_face}"
                    alert_msg    = "Phone usage detected!"

                eid = db.log_event_start(self.session_id, self.employee_id,
                                         "phone", "warning", trigger_note)
                self.sm_phone.db_event_id = eid
                if SAVE_IMAGE_ON_PHONE:
                    path = _save_evidence(frame, "phone", self.employee_id, self.camera_id)
                    if path:
                        db.update_event_image(eid, path)
                self._publish_and_alert("phone", alert_msg, "medium",
                                        shift_label, frame)
            elif ev == "END" and self.sm_phone.db_event_id:
                dur = db.log_event_end(self.sm_phone.db_event_id)
                if dur:
                    self.acc_phone += dur
            if self.sm_phone.active:
                self.acc_phone += dt

            # ── Absence ───────────────────────────────────────
            ev = self.sm_absent.update(is_absent, now)
            if ev == "START":
                eid = db.log_event_start(self.session_id, self.employee_id,
                                         "absence", "warning")
                self.sm_absent.db_event_id = eid
                if SAVE_IMAGE_ON_ABSENCE:
                    path = _save_evidence(frame, "absence", self.employee_id, self.camera_id)
                    if path:
                        db.update_event_image(eid, path)
                self._publish_and_alert("absence", "Employee absent from workstation!",
                                        "medium", shift_label, frame)
            elif ev == "END" and self.sm_absent.db_event_id:
                dur = db.log_event_end(self.sm_absent.db_event_id)
                if dur:
                    self.acc_absent += dur
            if self.sm_absent.active:
                self.acc_absent += dt

            # ── Crowding (FR-5) ───────────────────────────────
            ev = self.sm_crowd.update(is_crowd, now)
            if ev == "START":
                eid = db.log_event_start(self.session_id, self.employee_id,
                                         "crowding", "warning",
                                         f"persons={person_count}")
                self.sm_crowd.db_event_id = eid
                path = _save_evidence(frame, "crowd", self.employee_id, self.camera_id)
                if path:
                    db.update_event_image(eid, path)
                self._publish_and_alert(
                    "crowding",
                    f"Crowding detected: {person_count} persons in ROI!",
                    "medium", shift_label, frame
                )
            elif ev == "END" and self.sm_crowd.db_event_id:
                db.log_event_end(self.sm_crowd.db_event_id)

            # ── Productivity score ────────────────────────────
            total = max(self.acc_work, 1.0)
            score = max(0.0, 100.0 - (
                (self.acc_sleep  / total) * 100 * W_SLEEP  +
                (self.acc_phone  / total) * 100 * W_PHONE  +
                (self.acc_absent / total) * 100 * W_ABSENCE
            ))

            # ── Periodic DB summary flush (every 30 s) ────────
            if now - self._last_summary_ts >= 30.0:
                self._last_summary_ts = now
                try:
                    db.upsert_summary(
                        self.employee_id, today_str,
                        total_work_sec=self.acc_work,
                        sleep_sec=self.acc_sleep,
                        phone_sec=self.acc_phone,
                        absence_sec=self.acc_absent,
                        yawn_count=self.yawn_count,
                        phone_count=self.phone_count,
                    )
                    db.set_productivity(self.employee_id, today_str, score)
                except Exception as exc:
                    logger.warning("[Worker cam%d] DB flush error: %s", self.camera_id, exc)

            # ── Face recognition (throttled, FR-1) ────────────
            if face_bbox_px and (now - self._last_face_recognition) >= self._fr_interval:
                self._last_face_recognition = now
                self._do_face_recognition(frame, face_bbox_px, w, h, db, today_str, shift_label)
            elif not face_bbox_px:
                self._last_recognized_name = None

            # ── Build metrics dict ────────────────────────────
            metrics = {
                "ear": ear_val, "mar": mar_val,
                "ear_thr": self.ear_thr, "mar_thr": self.mar_thr,
                "fps": self._fps,
                "drowsy":    self.sm_drowsy.active,
                "sleep":     self.sm_sleep.active,
                "yawn":      self.sm_yawn.active,
                "phone":     self.sm_phone.active,
                "absent":    self.sm_absent.active,
                "crowding":  self.sm_crowd.active,
                "person_count": person_count,
                "phone_in_hand":   phone_in_hand,
                "phone_near_face": phone_near_face,
                "hand_near_ear":   hand_near_ear,   # gesture-based trigger
                "ear_side":        ear_side,         # "left" / "right" / ""
                "head_dropped": head_dropped,
                "session_work":    self.acc_work,
                "session_sleep":   self.acc_sleep,
                "session_phone":   self.acc_phone,
                "session_absence": self.acc_absent,
                "yawn_count":      self.yawn_count,
                "phone_count":     self.phone_count,
                "productivity":    score,
                "drowsy_elapsed":  self.sm_drowsy.elapsed,
                "sleep_elapsed":   self.sm_sleep.elapsed,
                "phone_elapsed":   self.sm_phone.elapsed,
                "suppressed":      suppressed,
                "suppress_reason": suppress_reason,
                "shift_label":     shift_label,
            }

            # ── HUD ───────────────────────────────────────────
            if SHOW_CAMERA_OVERLAY:
                if face_bbox_px:
                    fc = RED if self.sm_sleep.active else (ORANGE if self.sm_drowsy.active else GREEN)
                    show_name = (self._last_recognized_name and
                                 (now - self._last_recognized_name_ts) < 5.0)
                    _hud_box(frame, *face_bbox_px, color=fc,
                             label=self._last_recognized_name if show_name else "Face")
                display_frame = _draw_hud_overlay(frame.copy(), metrics)
            else:
                display_frame = frame.copy()

            self.frame_ready.emit(self.camera_id, display_frame)
            self.metrics_updated.emit(self.camera_id, metrics)

        # ── Cleanup ───────────────────────────────────────────
        cap.release()
        try:
            face_mesh.close()
            hands_det.close()
            pose_det.close()
        except Exception:
            pass
        try:
            db.end_session(self.session_id)
            db.upsert_summary(
                self.employee_id, today_str,
                total_work_sec=self.acc_work,
                sleep_sec=self.acc_sleep,
                phone_sec=self.acc_phone,
                absence_sec=self.acc_absent,
                yawn_count=self.yawn_count,
                phone_count=self.phone_count,
            )
            db.set_productivity(self.employee_id, today_str, score)
        except Exception as exc:
            logger.warning("[Worker cam%d] Cleanup DB error: %s", self.camera_id, exc)
        self.status_changed.emit(self.camera_id, "Session ended")

    # ── Helpers ───────────────────────────────────────────────
    def _open_camera(self) -> cv2.VideoCapture:
        """Open camera with configured parameters. Retries indefinitely."""
        while True:
            cap = cv2.VideoCapture(self.cam_index)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH,  CAM_WIDTH)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT)
                cap.set(cv2.CAP_PROP_FPS,          CAM_FPS)
                cap.set(cv2.CAP_PROP_BUFFERSIZE,   2)
                return cap
            cap.release()
            with QMutexLocker(self._mutex):
                if not self._running:
                    # Return an empty cap so the main loop exits cleanly
                    return cv2.VideoCapture()
            time.sleep(self._reconnect_secs)

    def _publish_and_alert(self, alert_type: str, message: str, severity: str,
                           shift_label: str, frame: np.ndarray):
        """Emit Qt alert signal and publish to MQTT/Redis."""
        self.alert_triggered.emit(self.camera_id, alert_type.upper(), message, severity)
        try:
            emp = get_db().get_employee(self.employee_id)
            emp_id_str   = emp["employee_id"] if emp else str(self.employee_id)
            emp_name_str = emp["name"]         if emp else ""
            thumb_path   = _save_evidence(frame, f"{alert_type}_mqtt",
                                          self.employee_id, self.camera_id)
            from mqtt_service import publish_alert
            publish_alert(
                site_id=self._site_id,
                camera_id=f"cam_{self.camera_id:02d}",
                employee_id=emp_id_str,
                employee_name=emp_name_str,
                alert_type=alert_type,
                severity=severity,
                shift_label=shift_label,
                thumbnail_path=thumb_path,
            )
        except Exception as exc:
            logger.debug("[Worker cam%d] MQTT publish error: %s", self.camera_id, exc)

    def _do_face_recognition(self, frame: np.ndarray, face_bbox_px: tuple,
                              w: int, h: int, db, today_str: str, shift_label: str):
        """Run face recognition and log attendance with shift-aware status."""
        try:
            from face_service import get_embedding_from_image, recognize_face, is_available
            if not is_available():
                return
            x1, y1, x2, y2 = face_bbox_px
            pad = int(0.15 * max(x2 - x1, y2 - y1))
            crop = frame[max(0, y1 - pad):min(h, y2 + pad),
                         max(0, x1 - pad):min(w, x2 + pad)]
            if crop.size == 0:
                return
            emb = get_embedding_from_image(crop)
            if emb is None:
                return
            rid, dist = recognize_face(emb)
            now = time.time()

            if rid is not None:
                emp = db.get_employee(rid)
                self._last_recognized_name    = emp["name"] if emp else "?"
                self._last_recognized_name_ts = now

                # Cooldown guard
                last_at = db.get_last_attendance_time(rid)
                if last_at:
                    elapsed = now - datetime.fromisoformat(last_at).timestamp()
                    if elapsed < ATTENDANCE_COOLDOWN_SEC:
                        return

                # Classify attendance status (FR-1)
                from shifts import classify_attendance_status
                status, shift_id = classify_attendance_status(rid, datetime.now())
                thumb_path = _save_evidence(frame, "attendance", rid, self.camera_id)
                db.log_attendance(rid, "in", self.camera_id,
                                  image_path=thumb_path,
                                  status=status,
                                  shift_id=shift_id)
                self.attendance_logged.emit(rid, self.camera_id)
            else:
                # Unknown face — log with screenshot
                thumb_path = _save_evidence(frame, "unknown", 0, self.camera_id)
                logger.debug("[Worker cam%d] Unknown face (dist=%.3f)", self.camera_id, dist or -1)
        except Exception as exc:
            logger.debug("[Worker cam%d] Face recognition error: %s", self.camera_id, exc)