# ============================================================
#  config.py  —  Global constants & tuneable parameters
# ============================================================
import os

APP_NAME    = "Banglalink EMS"
APP_VERSION = "1.0.1"
COMPANY     = "ROBOWAY TECHNOLOGIES"

# ── Paths ────────────────────────────────────────────────────
BASE_DIR          = os.path.dirname(os.path.abspath(__file__))
DB_PATH           = os.path.join(BASE_DIR, "assets", "sentinel.db")
CALIB_DIR         = os.path.join(BASE_DIR, "assets", "calibrations")
REPORT_DIR        = os.path.join(BASE_DIR, "reports", "output")
DETECTION_MODEL   = os.path.join(BASE_DIR, "assets", "yolov8n.pt")
ALARM_PATH        = os.path.join(BASE_DIR, "assets", "alarm.wav")
BEEP_PATH         = os.path.join(BASE_DIR, "assets", "beep.wav")
EVIDENCE_DIR      = os.path.join(BASE_DIR, "assets", "evidence")
FACE_PHOTOS_DIR    = os.path.join(BASE_DIR, "assets", "face_photos")
FACE_INDEX_DIR    = os.path.join(BASE_DIR, "assets", "face_index")
ICONS_DIR         = os.path.join(BASE_DIR, "assets", "icons")
LOGO_PATH         = os.path.join(ICONS_DIR, "logo.png")   # splash & login
APP_ICON_PATH     = os.path.join(ICONS_DIR, "app.ico")    # window icon (.ico or .png)

# Face recognition
FACE_RECOGNITION_THRESHOLD = 0.6   # max L2 distance for match (lower = stricter)
ATTENDANCE_COOLDOWN_SEC    = 30   # don't log same employee again within this many seconds
ATTENDANCE_ABSENCE_MINUTES = 5    # consider "left" after face not seen for this many minutes (for time-present summary)

# Save evidence image when each event type is triggered (per camera)
SAVE_IMAGE_ON_PHONE   = True
SAVE_IMAGE_ON_SLEEP   = True
SAVE_IMAGE_ON_DROWSY  = True
SAVE_IMAGE_ON_ABSENCE = True

os.makedirs(CALIB_DIR,   exist_ok=True)
os.makedirs(REPORT_DIR,  exist_ok=True)
os.makedirs(EVIDENCE_DIR, exist_ok=True)
os.makedirs(FACE_PHOTOS_DIR, exist_ok=True)
os.makedirs(FACE_INDEX_DIR, exist_ok=True)
os.makedirs(ICONS_DIR, exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# ── Camera ───────────────────────────────────────────────────
CAM_INDEX    = 1
CAM_WIDTH    = 1280
CAM_HEIGHT   = 720
CAM_FPS      = 30

# ── Detection thresholds ─────────────────────────────────────
# Eye Aspect Ratio  — below threshold = eye closed
DEFAULT_EAR_THRESHOLD    = 0.20   # overridden by calibration
DROWSY_SECONDS           = 3      # eyes closed → DROWSY warning
SLEEP_SECONDS            = 10     # eyes closed → SLEEP alert

# Mouth Aspect Ratio — above threshold = yawn
DEFAULT_MAR_THRESHOLD    = 0.55
YAWN_SECONDS             = 2

# Phone detection
PHONE_CONF_THRESHOLD     = 0.45   # Confidence for cell phone detection
PHONE_TRIGGER_SECONDS    = 3
HAND_PHONE_OVERLAP_IOU   = 0.10   # hand bbox ∩ phone bbox for "holding"
FACE_PHONE_EXPAND_RATIO  = 1.6    # expand face bbox to catch ear/cheek use

# Absence
ABSENCE_TRIGGER_SECONDS  = 30

# Hand-to-ear proximity gesture detection (phone call posture)
# Normalised-coordinate distance (0–1 scale, 0.15 ≈ 15% of frame width).
# Tune lower (0.10) to reduce false positives in noisy environments,
# or higher (0.20) if legitimate phone calls are being missed.
HAND_EAR_DIST_THRESHOLD  = 0.15   # wrist/fingertip → ear distance trigger

# ── Calibration ───────────────────────────────────────────────
CALIB_SAMPLES            = 90
CALIB_DISCARD_FIRST      = 15
EAR_MARGIN               = 0.45   # threshold interpolation bias
MAR_MARGIN               = 0.45

# ── Productivity scoring weights ─────────────────────────────
W_SLEEP    = 0.40
W_PHONE    = 0.35
W_ABSENCE  = 0.25

# ── Inference device for object detection ─
INFERENCE_DEVICE         = "auto"  # "cpu", "cuda", "auto" (auto = CUDA if available)

# ── UI ───────────────────────────────────────────────────────
OVERLAY_FPS_SMOOTH       = 0.1    # EMA factor for FPS smoothing
MAX_LOG_ENTRIES          = 500
SHOW_CAMERA_OVERLAY      = True  # True = HUD/boxes/lines on feed; False = clear feed

# ── COCO class IDs for object detection ───────────────────────
COCO_PHONE = 67
