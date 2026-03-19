# ============================================================
#  cameras.py  —  Multi-camera setup (1–10 cameras, persist to JSON)
# ============================================================
import os
import json

from config import BASE_DIR

CAMERAS_JSON = os.path.join(BASE_DIR, "assets", "cameras.json")
MAX_CAMERAS = 10


def _default_cameras():
    return [
        {"index": 0, "label": "Camera 1", "enabled": True},
    ]


def load_cameras():
    """Load camera list from JSON. Returns list of {index, label, enabled}."""
    if not os.path.isfile(CAMERAS_JSON):
        return _default_cameras()
    try:
        with open(CAMERAS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        out = []
        for c in data.get("cameras", [])[:MAX_CAMERAS]:
            out.append({
                "index": int(c.get("index", 0)),
                "label": str(c.get("label", f"Camera {len(out)+1}")),
                "enabled": bool(c.get("enabled", True)),
            })
        if not out:
            return _default_cameras()
        return out
    except Exception:
        return _default_cameras()


def save_cameras(cameras):
    """Save camera list to JSON. cameras = list of {index, label, enabled}."""
    os.makedirs(os.path.dirname(CAMERAS_JSON), exist_ok=True)
    with open(CAMERAS_JSON, "w", encoding="utf-8") as f:
        json.dump({"cameras": cameras[:MAX_CAMERAS]}, f, indent=2)


def get_enabled_cameras():
    """Return list of (camera_id, config) for enabled cameras only."""
    all_cams = load_cameras()
    return [(i, c) for i, c in enumerate(all_cams) if c.get("enabled", True)]


def add_camera(cameras, index=0, label=None, enabled=True):
    """Append a new camera if under MAX_CAMERAS. Returns updated list."""
    if len(cameras) >= MAX_CAMERAS:
        return cameras
    label = label or f"Camera {len(cameras) + 1}"
    return cameras + [{"index": index, "label": label, "enabled": enabled}]


def remove_camera(cameras, camera_id):
    """Remove camera at index. Returns updated list."""
    if camera_id < 0 or camera_id >= len(cameras):
        return cameras
    return [c for i, c in enumerate(cameras) if i != camera_id]


def update_camera(cameras, camera_id, index=None, label=None, enabled=None):
    """Update one camera. Returns updated list (new list)."""
    out = list(cameras)
    if camera_id < 0 or camera_id >= len(out):
        return out
    c = dict(out[camera_id])
    if index is not None:
        c["index"] = int(index)
    if label is not None:
        c["label"] = str(label)
    if enabled is not None:
        c["enabled"] = bool(enabled)
    out[camera_id] = c
    return out
