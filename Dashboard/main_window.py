# ============================================================
#  main_window.py  —  PyQt5 Main Application Window
# ============================================================
import sys
import os
import time
import numpy as np
from datetime import date, datetime

from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QTabWidget, QGroupBox, QTableWidget,
    QTableWidgetItem, QTextEdit, QSplitter, QComboBox, QLineEdit,
    QProgressBar, QDialog, QFormLayout, QMessageBox, QFileDialog,
    QScrollArea, QFrame, QSizePolicy, QHeaderView, QStatusBar,
    QCheckBox, QMenuBar, QMenu, QAction, QApplication, QStackedWidget,
    QStyle, QToolBar, QListWidget, QListWidgetItem, QProgressDialog,
    QSlider, QShortcut,
)
from PyQt5.QtCore import (Qt, QTimer, pyqtSlot, QSize, pyqtSignal, QEvent,
                          QThread, QPropertyAnimation, QParallelAnimationGroup,
                          QEasingCurve)
from PyQt5.QtGui import QImage, QPixmap, QFont, QColor, QPalette, QIcon, QPainter, QKeySequence
from PyQt5.QtWidgets import QToolButton

# On Windows use winsound for alarm to avoid pyglet XAudio2 teardown errors on exit
_use_winsound_alarm = sys.platform == "win32"
try:
    import pyglet
    _pyglet_available = True
except ImportError:
    _pyglet_available = False

import config
import shutil
import cv2
import tempfile
from config import *
from database import get_db
from detection.worker import DetectionWorker
from cameras import load_cameras, save_cameras, add_camera, remove_camera, update_camera, MAX_CAMERAS
from ui.styles import QSS, ALERT_COLORS, EVENT_ICONS
from auth import auth as _auth_manager


def _cv_to_qpixmap(frame):
    h, w, ch = frame.shape
    img = QImage(frame.data, w, h, ch * w, QImage.Format_BGR888)
    return QPixmap.fromImage(img)


def _sec_to_hms(s):
    m, sec = divmod(int(s), 60)
    h, m   = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}"


def _thumbnail_for_path(path, size=80):
    """Load image from path and return QPixmap scaled to size x size (square thumbnail)."""
    if not path or not os.path.isfile(path):
        return QPixmap()
    pm = QPixmap(path)
    if pm.isNull():
        return QPixmap()
    return pm.scaled(size, size, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)


def crop_face_from_image(image_input):
    """
    Detect and extract the face from an image; return a BGR crop (face only) or None.
    image_input: file path (str) or BGR numpy array (e.g. from camera).
    Set FACE_CROP_DEBUG=1 to print why detection failed.
    """
    _debug = os.environ.get("FACE_CROP_DEBUG", "").strip().lower() in ("1", "true", "yes")
    try:
        from deepface import DeepFace
    except Exception as e:
        if _debug:
            print(f"[crop_face] DeepFace import failed: {e}")
        return None
    img_path = None
    if isinstance(image_input, str):
        if not os.path.isfile(image_input):
            return None
        img_path = image_input
    else:
        if image_input is None or getattr(image_input, "size", 0) == 0:
            return None
        # Ensure writable BGR uint8 array (e.g. from camera); contiguous for reliable write
        arr = np.ascontiguousarray(np.asarray(image_input, dtype=np.uint8))
        if arr.ndim != 3 or arr.shape[2] != 3:
            return None
        # Write under app assets so path is reliable (system temp can break detection on some setups)
        temp_dir = os.path.join(config.BASE_DIR, "assets")
        try:
            os.makedirs(temp_dir, exist_ok=True)
        except Exception:
            temp_dir = None
        fd, img_path = tempfile.mkstemp(suffix=".jpg", prefix="face_crop_", dir=temp_dir)
        os.close(fd)
        try:
            if not cv2.imwrite(img_path, arr):
                if os.path.isfile(img_path):
                    try:
                        os.remove(img_path)
                    except Exception:
                        pass
                return None
        except Exception:
            try:
                os.remove(img_path)
            except Exception:
                pass
            return None
    created_temp = not isinstance(image_input, str)
    try:
        # Try detectors in order; use enforce_detection=False to get any face found
        for detector in ("ssd", "opencv"):
            try:
                faces = DeepFace.extract_faces(
                    img_path=img_path,
                    enforce_detection=False,
                    align=True,
                    expand_percentage=10,
                    detector_backend=detector,
                )
                if not faces or len(faces) == 0:
                    if _debug:
                        print(f"[crop_face] {detector}: no faces")
                    continue
                # Ignore low-confidence detections (e.g. opencv returning full frame as "face")
                valid = [f for f in faces if f.get("confidence", 0) > 0.5]
                if not valid:
                    if _debug:
                        confs = [f.get("confidence") for f in faces]
                        print(f"[crop_face] {detector}: all low confidence {confs}")
                    continue
                faces = valid
                # Take largest valid face by area
                best = max(faces, key=lambda f: f["facial_area"]["w"] * f["facial_area"]["h"])
                area = best["facial_area"]
                x, y, w, h = int(area["x"]), int(area["y"]), int(area["w"]), int(area["h"])
                if w <= 0 or h <= 0:
                    if _debug:
                        print(f"[crop_face] {detector}: invalid facial_area")
                    continue
                # Crop from original image so we never get any bbox/overlay DeepFace may draw on "face"
                src = cv2.imread(img_path)
                if src is None:
                    if _debug:
                        print(f"[crop_face] {detector}: could not read image")
                    continue
                H, W = src.shape[:2]
                expand = 0.10  # same as expand_percentage=10
                cx, cy = x + w / 2, y + h / 2
                nw, nh = w * (1 + expand), h * (1 + expand)
                x1 = max(0, int(cx - nw / 2))
                y1 = max(0, int(cy - nh / 2))
                x2 = min(W, int(cx + nw / 2))
                y2 = min(H, int(cy + nh / 2))
                if x2 <= x1 or y2 <= y1:
                    continue
                face_bgr = np.ascontiguousarray(src[y1:y2, x1:x2])
                if face_bgr.size == 0:
                    continue
                return face_bgr
            except Exception as e:
                if _debug:
                    print(f"[crop_face] {detector}: {e}")
                continue
        if _debug:
            print("[crop_face] all detectors failed or no valid face")
        return None
    finally:
        if created_temp and img_path and os.path.isfile(img_path):
            try:
                os.remove(img_path)
            except Exception:
                pass


# ── Embedding worker (runs add_faces in background, emits progress) ─
class EmbeddingWorker(QThread):
    progress = pyqtSignal(int, int)  # current, total

    def __init__(self, employee_id, paths, parent=None):
        super().__init__(parent)
        self.employee_id = employee_id
        self.paths = list(paths) if paths else []
        self._result = 0

    def run(self):
        if not self.paths:
            self.progress.emit(0, 0)
            return
        try:
            from face_service import add_faces, is_available
            if is_available():
                def cb(c, t):
                    self.progress.emit(c, t)
                self._result = add_faces(self.employee_id, self.paths, progress_callback=cb)
            self.progress.emit(len(self.paths), len(self.paths))
        except Exception:
            self.progress.emit(0, len(self.paths))


# ── Employee Dialog (Sci‑Fi style + photo thumbnails) ─────────
_EMPLOYEE_DIALOG_STYLE = """
    QDialog {
        background-color: #0a0e14;
    }
    QGroupBox {
        font-size: 11px;
        font-weight: 600;
        color: #00d4ff;
        border: 1px solid #0e3d5a;
        border-radius: 6px;
        margin-top: 10px;
        padding: 12px 10px 10px 14px;
    }
    QGroupBox::title {
        subcontrol-origin: margin;
        left: 10px;
        padding: 0 6px;
        color: #00d4ff;
    }
    QLabel { color: #8b949e; font-size: 11px; }
    QLineEdit {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 4px;
        color: #c9d1d9;
        padding: 6px 8px;
        font-size: 12px;
        selection-background-color: #0e3d5a;
    }
    QLineEdit:focus { border-color: #00d4ff; }
    QPushButton {
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 4px;
        color: #00d4ff;
        padding: 6px 12px;
        font-size: 11px;
    }
    QPushButton:hover { background: #30363d; border-color: #00d4ff; }
    QPushButton:pressed { background: #0e3d5a; }
    QListWidget {
        background: #0d1117;
        border: 1px solid #21262d;
        border-radius: 4px;
        color: #8b949e;
        padding: 6px;
    }
    QListWidget::item { padding: 4px; }
    QListWidget::item:selected { background: #0e3d5a; color: #00d4ff; }
"""

class EmployeeDialog(QDialog):
    def __init__(self, parent=None, employee=None, db=None):
        super().__init__(parent)
        self.setWindowTitle("Employee Profile")
        self.setMinimumSize(480, 520)
        self.setStyleSheet(_EMPLOYEE_DIALOG_STYLE)
        self.result_data = None
        self._db = db or get_db()
        self._employee = employee
        self._photo_paths = []

        layout = QVBoxLayout(self)
        layout.setSpacing(10)
        layout.setContentsMargins(16, 16, 16, 16)
        form = QFormLayout()
        self.name_edit = QLineEdit(employee["name"] if employee else "")
        self.id_edit   = QLineEdit(employee["employee_id"] if employee else "")
        self.dept_edit = QLineEdit(employee["department"] if employee else "")
        form.addRow("Full Name:",    self.name_edit)
        form.addRow("Employee ID:",  self.id_edit)
        form.addRow("Department:",   self.dept_edit)
        layout.addLayout(form)

        photo_group = QGroupBox("Face photos (for recognition)")
        pl = QVBoxLayout(photo_group)
        self.photo_list = QListWidget()
        self.photo_list.setViewMode(QListWidget.IconMode)
        self.photo_list.setIconSize(QSize(80, 80))
        self.photo_list.setSpacing(8)
        self.photo_list.setMovement(QListWidget.Static)
        self.photo_list.setMinimumHeight(140)
        self.photo_list.setMaximumHeight(200)
        pl.addWidget(self.photo_list)
        pb = QHBoxLayout()
        from_pc_btn = QPushButton("From computer")
        from_pc_btn.clicked.connect(self._add_photo_from_computer)
        live_cap_btn = QPushButton("Live capture")
        live_cap_btn.clicked.connect(self._live_capture)
        rm_photo_btn = QPushButton("Remove selected")
        rm_photo_btn.clicked.connect(self._remove_photo)
        pb.addWidget(from_pc_btn)
        pb.addWidget(live_cap_btn)
        pb.addWidget(rm_photo_btn)
        pl.addLayout(pb)
        layout.addWidget(photo_group)

        if employee and self._db:
            for row in self._db.get_employee_photos(employee["id"]):
                self._photo_paths.append(row["path"])
                self._add_photo_item(row["path"])

        btns = QHBoxLayout()
        ok_btn  = QPushButton("Save")
        cxl_btn = QPushButton("Cancel")
        ok_btn.clicked.connect(self._accept)
        cxl_btn.clicked.connect(self.reject)
        btns.addWidget(ok_btn)
        btns.addWidget(cxl_btn)
        layout.addLayout(btns)

    def _add_photo_item(self, path):
        """Append one photo to the list with thumbnail icon."""
        thumb = _thumbnail_for_path(path, 80)
        icon = QIcon(thumb)
        short = os.path.basename(path)
        if len(short) > 12:
            short = short[:10] + "…"
        item = QListWidgetItem(icon, short)
        item.setData(Qt.UserRole, path)
        self.photo_list.addItem(item)

    def _add_photo_from_computer(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Select photo(s)", "", "Images (*.png *.jpg *.jpeg *.bmp)"
        )
        for path in paths:
            if path and path not in self._photo_paths:
                self._photo_paths.append(path)
                self._add_photo_item(path)

    def _live_capture(self):
        dlg = LiveCaptureDialog(self)
        if dlg.exec_() == QDialog.Accepted and dlg.captured_path:
            if dlg.captured_path not in self._photo_paths:
                self._photo_paths.append(dlg.captured_path)
                self._add_photo_item(dlg.captured_path)

    def _remove_photo(self):
        row = self.photo_list.currentRow()
        if row >= 0 and row < len(self._photo_paths):
            self._photo_paths.pop(row)
            self.photo_list.takeItem(row)

    def _accept(self):
        self.result_data = {
            "name":        self.name_edit.text().strip(),
            "employee_id": self.id_edit.text().strip(),
            "department":  self.dept_edit.text().strip(),
            "photo_paths": list(self._photo_paths),
        }
        if not self.result_data["name"] or not self.result_data["employee_id"]:
            QMessageBox.warning(self, "Error", "Name and Employee ID required.")
            return
        self.accept()


# ── Live Capture Dialog (camera select + face area guide + face detection) ─
class LiveCaptureDialog(QDialog):
    """Capture a face photo from the selected camera with an on-screen face guide."""
    def __init__(self, parent=None, **kwargs):
        super().__init__(parent, **kwargs)
        self.setWindowTitle("Live capture — Position face in the oval")
        self.setMinimumSize(560, 420)
        self.captured_path = None
        self._cap = None
        self._cam_index = 0
        layout = QVBoxLayout(self)
        # Camera selection
        cam_row = QHBoxLayout()
        cam_row.addWidget(QLabel("Camera:"))
        self.cam_combo = QComboBox()
        cameras = load_cameras()
        for i, c in enumerate(cameras):
            self.cam_combo.addItem(f"{c.get('label', f'Camera {i+1}')} (index {c.get('index', i)})", c.get("index", i))
        if self.cam_combo.count() == 0:
            self.cam_combo.addItem("Camera 0", 0)
        self.cam_combo.currentIndexChanged.connect(self._on_camera_changed)
        cam_row.addWidget(self.cam_combo, 1)
        layout.addLayout(cam_row)
        # Video feed with face guide (drawn on frame)
        self.video_lbl = QLabel("Starting camera…")
        self.video_lbl.setAlignment(Qt.AlignCenter)
        self.video_lbl.setMinimumSize(480, 320)
        self.video_lbl.setStyleSheet("background: #0d1117; color: #8b949e; font-size: 12px;")
        self.video_lbl.setScaledContents(False)
        layout.addWidget(self.video_lbl, 1)
        self.hint_lbl = QLabel("Position your face inside the oval, then click Capture.")
        self.hint_lbl.setStyleSheet("color: #8b949e; font-size: 11px;")
        layout.addWidget(self.hint_lbl)
        btn_row = QHBoxLayout()
        self.capture_btn = QPushButton("Capture")
        self.capture_btn.clicked.connect(self._capture)
        self.capture_btn.setEnabled(False)
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.reject)
        btn_row.addWidget(self.capture_btn)
        btn_row.addStretch()
        btn_row.addWidget(close_btn)
        layout.addLayout(btn_row)
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._update_frame)
        self._on_camera_changed()

    def _on_camera_changed(self):
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._timer.stop()
        idx = self.cam_combo.currentData()
        if idx is None:
            idx = 0
        self._cam_index = int(idx)
        self._cap = cv2.VideoCapture(self._cam_index)
        if self._cap.isOpened():
            self._timer.start(30)
            self.capture_btn.setEnabled(True)
        else:
            self.video_lbl.setText(f"Cannot open camera {self._cam_index}")
            self.capture_btn.setEnabled(False)

    def _draw_face_guide(self, frame):
        """Draw an oval face guide in the center of the frame."""
        h, w = frame.shape[:2]
        cx, cy = w // 2, h // 2
        rx = int(min(w, h) * 0.35)
        ry = int(rx * 1.2)
        cv2.ellipse(frame, (cx, cy), (rx, ry), 0, 0, 360, (0, 200, 255), 2)
        cv2.putText(frame, "Place face here", (cx - 70, cy - ry - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 1)

    def _update_frame(self):
        if self._cap is None or not self._cap.isOpened():
            return
        ret, frame = self._cap.read()
        if not ret or frame is None:
            return
        # Draw guide on a copy so we never pass an annotated frame to face detection
        display = frame.copy()
        self._draw_face_guide(display)
        pixmap = _cv_to_qpixmap(display)
        scaled = pixmap.scaled(self.video_lbl.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        self.video_lbl.setPixmap(scaled)

    def _capture(self):
        if self._cap is None or not self._cap.isOpened():
            return
        ret, frame = self._cap.read()
        if not ret or frame is None:
            return
        # Use a clean copy: no annotations, so face detection sees raw camera image
        frame_clean = np.asarray(frame, dtype=np.uint8).copy()
        self.hint_lbl.setText("Detecting face…")
        self.hint_lbl.repaint()
        QApplication.processEvents()
        face_crop = crop_face_from_image(frame_clean)
        self.hint_lbl.setText("Position your face inside the oval, then click Capture.")
        if face_crop is None:
            QMessageBox.warning(self, "No face", "No face detected. Please ensure your face is clearly visible in the oval and try again.")
            return
        fd, path = tempfile.mkstemp(suffix=".jpg", prefix="face_capture_")
        os.close(fd)
        try:
            cv2.imwrite(path, face_crop)
            self.captured_path = path
            self.accept()
        except Exception:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass
            QMessageBox.warning(self, "Error", "Could not save captured image.")

    def reject(self):
        self._timer.stop()
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        super().reject()


# ── Camera Setup Dialog ───────────────────────────────────────
class CameraSetupDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Camera Setup (1–10 cameras)")
        self.setMinimumSize(500, 380)
        layout = QVBoxLayout(self)
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["Index/URL", "Label", "Enabled", ""])
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        layout.addWidget(self.table)
        btn_row = QHBoxLayout()
        add_btn = QPushButton("➕ Add camera")
        add_btn.clicked.connect(self._add_row)
        btn_row.addWidget(add_btn)
        btn_row.addStretch()
        ok_btn = QPushButton("SAVE")
        ok_btn.clicked.connect(self._save)
        cxl_btn = QPushButton("CANCEL")
        cxl_btn.clicked.connect(self.reject)
        btn_row.addWidget(ok_btn)
        btn_row.addWidget(cxl_btn)
        layout.addLayout(btn_row)
        self._load()

    def _load(self):
        cameras = load_cameras()
        self.table.setRowCount(len(cameras))
        for r, c in enumerate(cameras):
            idx_edit = QLineEdit(str(c["index"]))
            idx_edit.setPlaceholderText("0 or stream URL")
            self.table.setCellWidget(r, 0, idx_edit)
            lbl_edit = QLineEdit(c["label"])
            self.table.setCellWidget(r, 1, lbl_edit)
            chk = QCheckBox()
            chk.setChecked(c["enabled"])
            self.table.setCellWidget(r, 2, chk)
            rm_btn = QPushButton("Remove")
            rm_btn.clicked.connect(self._on_remove_clicked)
            self.table.setCellWidget(r, 3, rm_btn)
        self._update_remove_buttons()

    def _update_remove_buttons(self):
        for r in range(self.table.rowCount()):
            btn = self.table.cellWidget(r, 3)
            if btn:
                btn.setEnabled(self.table.rowCount() > 1)

    def _on_remove_clicked(self):
        btn = self.sender()
        for r in range(self.table.rowCount()):
            if self.table.cellWidget(r, 3) == btn:
                self._remove_row(r)
                break

    def _add_row(self):
        if self.table.rowCount() >= MAX_CAMERAS:
            QMessageBox.information(self, "Limit", f"Maximum {MAX_CAMERAS} cameras.")
            return
        r = self.table.rowCount()
        self.table.insertRow(r)
        idx_edit = QLineEdit(str(r))
        idx_edit.setPlaceholderText("0 or stream URL")
        self.table.setCellWidget(r, 0, idx_edit)
        self.table.setCellWidget(r, 1, QLineEdit(f"Camera {r+1}"))
        chk = QCheckBox()
        chk.setChecked(True)
        self.table.setCellWidget(r, 2, chk)
        rm_btn = QPushButton("Remove")
        rm_btn.clicked.connect(self._on_remove_clicked)
        self.table.setCellWidget(r, 3, rm_btn)
        self._update_remove_buttons()

    def _remove_row(self, row):
        self.table.removeRow(row)
        self._update_remove_buttons()

    def _save(self):
        cameras = []
        for r in range(self.table.rowCount()):
            idx_w = self.table.cellWidget(r, 0)
            lbl_w = self.table.cellWidget(r, 1)
            chk_w = self.table.cellWidget(r, 2)
            idx = idx_w.text().strip() if idx_w else "0"
            try:
                index = int(idx)
            except ValueError:
                index = idx  # RTSP URL string
            cameras.append({
                "index": index,
                "label": lbl_w.text().strip() or f"Camera {r+1}" if lbl_w else f"Camera {r+1}",
                "enabled": chk_w.isChecked() if chk_w else True,
            })
        save_cameras(cameras)
        self.accept()


# ── Feed panel (one per camera; double-click → fullscreen) ─────
class FeedPanel(QFrame):
    """Single camera tile with right-click context menu.

    Signals
    -------
    double_clicked(camera_id)   double-click → fullscreen
    pause_clicked(camera_id)    pause / resume toggle
    capture_clicked(camera_id)  save screenshot of current frame
    reconnect_clicked(camera_id) force stream reconnect
    """

    double_clicked   = pyqtSignal(int)
    pause_clicked    = pyqtSignal(int)
    capture_clicked  = pyqtSignal(int)
    reconnect_clicked = pyqtSignal(int)

    # Context-menu icon SVG paths (tiny 24×24 subset)
    _CM_ICONS = {
        "capture":    "M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5M20 4h-3.17L15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z",
        "pause":      "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
        "resume":     "M8 5v14l11-7z",
        "fullscreen": "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
        "reconnect":  "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
    }

    def __init__(self, camera_id, label, parent=None):
        super().__init__(parent)
        self.camera_id = camera_id
        self._paused   = False
        self._last_frame = None  # type: Optional[np.ndarray]

        self.setFrameStyle(QFrame.StyledPanel)
        self.setStyleSheet(
            "FeedPanel { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; }"
            "FeedPanel:hover { border-color: #2a4060; }"
        )
        self.setMinimumSize(280, 200)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_context_menu)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(0)

        # ── Title bar ────────────────────────────────────────
        title_bar = QWidget()
        title_bar.setFixedHeight(22)
        title_bar.setStyleSheet("background: #161b22; border-radius: 4px 4px 0 0;")
        tbl = QHBoxLayout(title_bar)
        tbl.setContentsMargins(6, 0, 4, 0)
        tbl.setSpacing(4)

        self.title_lbl = QLabel(label)
        self.title_lbl.setStyleSheet(
            "color: #8b949e; font-weight: 600; font-size: 10px; background: transparent;"
        )
        tbl.addWidget(self.title_lbl, 1)

        # Small status dot
        self._status_dot = QLabel("●")
        self._status_dot.setStyleSheet("color: #3fb950; font-size: 8px; background: transparent;")
        tbl.addWidget(self._status_dot)
        layout.addWidget(title_bar)

        # ── Video area ───────────────────────────────────────
        self.video_lbl = QLabel("No video signal")
        self.video_lbl.setAlignment(Qt.AlignCenter)
        self.video_lbl.setMinimumSize(240, 160)
        self.video_lbl.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.video_lbl.setStyleSheet(
            "background: #080c12; color: #2a3a4a; font-size: 11px; border-radius: 0 0 4px 4px;"
        )
        self.video_lbl.setScaledContents(False)
        self.video_lbl.installEventFilter(self)
        layout.addWidget(self.video_lbl, 1)

        # PAUSED overlay (semi-transparent banner)
        self._paused_lbl = QLabel("⏸  PAUSED")
        self._paused_lbl.setAlignment(Qt.AlignCenter)
        self._paused_lbl.setStyleSheet(
            "color: #f85149; font-weight: 700; font-size: 13px; "
            "background: #0d111780; border-radius: 4px; padding: 4px 12px;"
        )
        self._paused_lbl.hide()
        self._paused_lbl.setParent(self)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        # Keep paused banner centred
        if self._paused_lbl:
            self._paused_lbl.adjustSize()
            x = (self.width()  - self._paused_lbl.width())  // 2
            y = (self.height() - self._paused_lbl.height()) // 2
            self._paused_lbl.move(x, y)

    def eventFilter(self, obj, event):
        if obj is self.video_lbl and event.type() == QEvent.MouseButtonDblClick:
            self.double_clicked.emit(self.camera_id)
            return True
        return super().eventFilter(obj, event)

    # ── Context menu ─────────────────────────────────────────
    def _show_context_menu(self, pos):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background: #161b22;
                border: 1px solid #2a3a4a;
                border-radius: 6px;
                padding: 4px;
            }
            QMenu::item {
                color: #c9d1d9;
                font-size: 12px;
                padding: 6px 16px 6px 10px;
                border-radius: 4px;
            }
            QMenu::item:selected { background: #0d2137; color: #00d4ff; }
            QMenu::separator { background: #2a3a4a; height: 1px; margin: 3px 6px; }
            QMenu::item:disabled { color: #3a4a5a; }
        """)

        act_cap   = menu.addAction(self._cm_icon("capture"),    "  Capture Screenshot")
        menu.addSeparator()
        if self._paused:
            act_pause = menu.addAction(self._cm_icon("resume"),  "  Resume Feed")
        else:
            act_pause = menu.addAction(self._cm_icon("pause"),   "  Pause Feed")
        act_fs    = menu.addAction(self._cm_icon("fullscreen"), "  Full Screen")
        menu.addSeparator()
        act_recon = menu.addAction(self._cm_icon("reconnect"),  "  Reconnect Stream")

        chosen = menu.exec_(self.mapToGlobal(pos))
        if chosen == act_cap:
            self.capture_clicked.emit(self.camera_id)
        elif chosen == act_pause:
            self.pause_clicked.emit(self.camera_id)
        elif chosen == act_fs:
            self.double_clicked.emit(self.camera_id)
        elif chosen == act_recon:
            self.reconnect_clicked.emit(self.camera_id)

    @staticmethod
    def _cm_icon(key: str) -> QIcon:
        path_data = FeedPanel._CM_ICONS.get(key, "")
        if not path_data:
            return QIcon()
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
            f'<path d="{path_data}" fill="#8b949e"/></svg>'
        ).encode()
        pm = QPixmap(16, 16)
        pm.fill(Qt.transparent)
        try:
            from PyQt5.QtSvg import QSvgRenderer
            from PyQt5.QtCore import QByteArray, QRectF
            renderer = QSvgRenderer(QByteArray(svg))
            painter  = QPainter(pm)
            painter.setRenderHint(QPainter.Antialiasing)
            renderer.render(painter, QRectF(0, 0, 16, 16))
            painter.end()
        except Exception:
            pass
        return QIcon(pm)

    # ── Public API ────────────────────────────────────────────
    def set_frame(self, frame: np.ndarray):
        if self._paused:
            return
        self._last_frame = frame
        pixmap = _cv_to_qpixmap(frame)
        scaled = pixmap.scaled(
            self.video_lbl.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation
        )
        self.video_lbl.setPixmap(scaled)

    def get_last_frame(self):
        """Return the most recently displayed frame (for capture)."""
        return self._last_frame

    def set_paused(self, paused: bool):
        self._paused = paused
        self._paused_lbl.setVisible(paused)
        self._status_dot.setStyleSheet(
            "color: #d29922; font-size: 8px; background: transparent;"
            if paused else "color: #3fb950; font-size: 8px; background: transparent;"
        )
        if paused:
            self._paused_lbl.adjustSize()
            x = (self.width()  - self._paused_lbl.width())  // 2
            y = (self.height() - self._paused_lbl.height()) // 2
            self._paused_lbl.move(x, y)
            self._paused_lbl.raise_()

    def set_placeholder(self, text="No video signal"):
        self.video_lbl.setPixmap(QPixmap())
        self.video_lbl.setText(text)

    def set_disconnected(self, disconnected: bool):
        self._status_dot.setStyleSheet(
            "color: #f85149; font-size: 8px; background: transparent;"
            if disconnected else "color: #3fb950; font-size: 8px; background: transparent;"
        )


# ── Camera feed popout dialog (separate window, not fullscreen) ─
class CameraFeedDialog(QDialog):
    def __init__(self, camera_id, label, parent=None):
        super().__init__(parent)
        self.camera_id = camera_id
        self.setWindowTitle(f"{label} — Esc or Close to exit")
        self.setMinimumSize(640, 400)
        self.resize(840, 520)
        self.setWindowFlags(self.windowFlags() | Qt.WindowMinMaxButtonsHint)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        self.video_lbl = QLabel("No video signal")
        self.video_lbl.setAlignment(Qt.AlignCenter)
        self.video_lbl.setMinimumSize(320, 240)
        self.video_lbl.setStyleSheet("background: #0d1117; color: #484f58; font-size: 13px;")
        layout.addWidget(self.video_lbl)
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.reject)
        layout.addWidget(close_btn)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.reject()
            return
        super().keyPressEvent(event)

    def set_frame(self, frame):
        pixmap = _cv_to_qpixmap(frame)
        scaled = pixmap.scaled(self.video_lbl.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        self.video_lbl.setPixmap(scaled)


# ── Live Metric Gauge ─────────────────────────────────────────
class RatioBar(QWidget):
    def __init__(self, label, color="#00d4ff", threshold=None):
        super().__init__()
        self._color     = color
        self._threshold = threshold
        self.setMinimumHeight(44)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(2)

        hl = QHBoxLayout()
        self.lbl  = QLabel(label)
        self.lbl.setStyleSheet("color: #5a8a9a; font-size: 12px; font-weight: bold;")
        self.lbl.setWordWrap(True)
        self.val  = QLabel("0.000")
        self.val.setStyleSheet(f"color: {color}; font-size: 13px; font-weight: bold;")
        hl.addWidget(self.lbl)
        hl.addStretch()
        hl.addWidget(self.val)
        layout.addLayout(hl)

        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setValue(0)
        self.bar.setTextVisible(False)
        self.bar.setFixedHeight(8)
        self.bar.setStyleSheet(f"""
            QProgressBar {{ background: #040810; border: 1px solid #0a2040; }}
            QProgressBar::chunk {{ background: {color}; }}
        """)
        layout.addWidget(self.bar)

    def update(self, value, max_val=1.0):
        self.val.setText(f"{value:.3f}")
        self.bar.setValue(int((value / max_val) * 100))


# ── Multi-camera alert panel (shows multiple notifications) ─────
class AlertPanel(QFrame):
    """Shows a list of alerts from multiple cameras; each auto-removes after 5s."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet("""
            AlertPanel {
                background: #161b22;
                border: none;
                border-bottom: 1px solid #21262d;
            }
        """)
        self.setMaximumHeight(140)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 2, 4, 2)
        layout.setSpacing(2)
        self._idle_lbl = QLabel("System ready")
        self._idle_lbl.setStyleSheet("color: #6e7681; font-size: 11px; padding: 1px 0;")
        layout.addWidget(self._idle_lbl)
        self._alert_widget = QWidget()
        self._alert_layout = QVBoxLayout(self._alert_widget)
        self._alert_layout.setContentsMargins(0, 0, 0, 0)
        self._alert_layout.setSpacing(2)
        self._alert_widget.hide()
        layout.addWidget(self._alert_widget)
        self._items = []  # list of (widget, timer)

    def show_alert(self, camera_id, message, severity="warning"):
        color = ALERT_COLORS.get(severity, "#d29922")
        text = f"Cam {camera_id + 1}: {message}"
        row = QLabel(text)
        row.setStyleSheet(f"""
            background: {color}18;
            border-left: 3px solid {color};
            color: {color};
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 2px;
        """)
        row.setWordWrap(True)
        self._alert_layout.insertWidget(0, row)
        timer = QTimer(self)
        timer.setSingleShot(True)

        def remove():
            timer.stop()
            self._alert_layout.removeWidget(row)
            row.deleteLater()
            self._items[:] = [(w, t) for w, t in self._items if w != row]
            if not self._items:
                self._alert_widget.hide()
                self._idle_lbl.show()

        timer.timeout.connect(remove)
        self._items.append((row, timer))
        timer.start(5000)
        self._idle_lbl.hide()
        self._alert_widget.show()


# ── Sidebar constants ─────────────────────────────────────────
_SB_W_OPEN  = 230
_SB_W_CLOSE = 80
_SB_ANIM_MS = 260

_SIDEBAR_QSS = """
/* ── Sidebar container ───────────────────────────────── */
SideBar {
    background: #080c12;
    border-right: 1px solid #1a2332;
}

/* ── Section dividers ────────────────────────────────── */
QLabel#section_label {
    color: #2a3a4a;
    font-size: 9px;
    letter-spacing: 2px;
    padding: 14px 14px 2px 14px;
    text-transform: uppercase;
    background: transparent;
}

/* ── Navigation buttons ──────────────────────────────── */
QToolButton {
    background: transparent;
    border: none;
    border-radius: 6px;
    color: #6e7681;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    padding: 0px 10px;
}
QToolButton:hover {
    background: #161b22;
    color: #c9d1d9;
}
QToolButton:checked {
    background: #0d2137;
    color: #00d4ff;
    border-left: 3px solid #00d4ff;
}
QToolButton:disabled {
    color: #3a4248;
}

/* ── Session action buttons (Start/Stop) ─────────────── */
QToolButton#btn_start {
    background: #0e3d1a;
    border: 1px solid #1a5c28;
    color: #3fb950;
    border-radius: 6px;
    font-weight: 600;
}
QToolButton#btn_start:hover   { background: #165c26; border-color: #3fb950; }
QToolButton#btn_start:disabled { background: #101a12; color: #2a4430; border-color: #1a2a1a; }

QToolButton#btn_stop {
    background: #3d0e0e;
    border: 1px solid #5c1a1a;
    color: #f85149;
    border-radius: 6px;
    font-weight: 600;
}
QToolButton#btn_stop:hover    { background: #5c1515; border-color: #f85149; }
QToolButton#btn_stop:disabled { background: #1a1010; color: #3a2020; border-color: #2a1a1a; }

/* ── Divider line ─────────────────────────────────────── */
QFrame#sb_divider {
    background: #1a2332;
    max-height: 1px;
    border: none;
}

/* ── Toggle button ───────────────────────────────────── */
QToolButton#toggle_btn {
    background: transparent;
    border: 1px solid #1a2332;
    border-radius: 4px;
    color: #4a5568;
    font-size: 14px;
    padding: 2px;
}
QToolButton#toggle_btn:hover {
    background: #161b22;
    color: #00d4ff;
    border-color: #00d4ff;
}

/* ── Combo boxes inside sidebar ──────────────────────── */
QComboBox {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 4px;
    color: #c9d1d9;
    padding: 3px 6px;
    font-size: 11px;
    selection-background-color: #0e3d5a;
}
QComboBox:focus { border-color: #00d4ff; }
QComboBox::drop-down { border: none; width: 18px; }
QComboBox QAbstractItemView {
    background: #161b22;
    border: 1px solid #30363d;
    color: #c9d1d9;
    selection-background-color: #0e3d5a;
}
"""


def _make_icon_from_sp(sp_icon_id):
    """Return a QIcon from Qt standard icons."""
    return QApplication.style().standardIcon(sp_icon_id)


def _make_svg_icon(path_data: str, color: str = "#6e7681", size: int = 18) -> QIcon:
    """Build a tiny monochrome QIcon from an SVG path string."""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
        f'width="{size}" height="{size}">'
        f'<path d="{path_data}" fill="{color}"/></svg>'
    )
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    painter = QPainter(pm)
    from PyQt5.QtSvg import QSvgRenderer
    from PyQt5.QtCore import QByteArray
    renderer = QSvgRenderer(QByteArray(svg.encode()))
    from PyQt5.QtCore import QRectF
    renderer.render(painter, QRectF(0, 0, size, size))
    painter.end()
    return QIcon(pm)


# ── Pre-built icon set (SVG paths) ───────────────────────────
# These are Material Design path data at 24×24 viewBox

_ICONS = {
    # Navigation
    "monitor":    "M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v1h12v-1l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z",
    "analytics":  "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z",
    "events":     "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
    "employees":  "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
    "reports":    "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z",
    "attendance": "M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z",
    # Actions
    "play":       "M8 5v14l11-7z",
    "stop":       "M6 6h12v12H6z",
    "camera":     "M9.4 10.5l4.77-8.26C13.47 2.09 12.75 2 12 2c-2.4 0-4.6.85-6.32 2.25L9.4 10.5zm12.08 2l-.01-.5-.3-2.47H17.5l-.68-1.17L12.1 17.4c2.03-.82 3.61-2.47 4.33-4.56l1.53-1.25-1.7-1.77 5.22 1.68zm-9.73 5.47L7.48 10 6.7 8.68 4.9 10.38 2.34 17.2C3.64 19.42 5.65 21.17 8 21.8l4.74-3.12-1-0.71zM21 14.24l-1.08-.89.08.65C19.82 17.28 17.55 19.59 14.63 20.29l1.37-1.56-.52-.32L12 22c.54 0 1.07-.05 1.58-.14C17.1 21.22 19.97 18.08 21 14.24z",
    "cameras":    "M12 15.5c-1.93 0-3.5-1.57-3.5-3.5S10.07 8.5 12 8.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5zM20 4h-3.17L15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z",
    "calibrate":  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z",
    "shifts":     "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z",
    "users":      "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
    "reset":      "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
    "device":     "M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z",
    "logout":     "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
    "info":       "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
}


def _icon(key: str, color: str = "#6e7681") -> QIcon:
    """Return a monochrome SVG QIcon for the given key."""
    path_data = _ICONS.get(key, "")
    if not path_data:
        return QIcon()
    # Build SVG bytes
    svg_bytes = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        f'<path d="{path_data}" fill="{color}"/></svg>'
    ).encode()
    pm = QPixmap(20, 20)
    pm.fill(Qt.transparent)
    try:
        from PyQt5.QtSvg import QSvgRenderer
        from PyQt5.QtCore import QByteArray, QRectF
        renderer = QSvgRenderer(QByteArray(svg_bytes))
        painter = QPainter(pm)
        painter.setRenderHint(QPainter.Antialiasing)
        renderer.render(painter, QRectF(0, 0, 20, 20))
        painter.end()
    except Exception:
        # QtSvg not available — fall back to a blank icon
        pass
    return QIcon(pm)


def _nav_icon(key: str) -> QIcon:
    return _icon(key, "#6e7681")


def _active_icon(key: str) -> QIcon:
    return _icon(key, "#00d4ff")


# ── Sidebar widget ────────────────────────────────────────────
class SideBar(QWidget):
    """Animated collapsible left navigation panel."""

    navigate      = pyqtSignal(int)   # page index
    about_clicked = pyqtSignal()      # about button

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("sidebar")
        self.setStyleSheet(_SIDEBAR_QSS)
        self.setMinimumWidth(_SB_W_OPEN)
        self.setMaximumWidth(_SB_W_OPEN)
        self._expanded = True

        # Animation ── both min and max width animated in parallel so the
        # widget neither clips nor pushes siblings during transition
        self._anim_min = QPropertyAnimation(self, b"minimumWidth")
        self._anim_max = QPropertyAnimation(self, b"maximumWidth")
        for a in (self._anim_min, self._anim_max):
            a.setDuration(_SB_ANIM_MS)
            a.setEasingCurve(QEasingCurve.InOutCubic)
        self._anim_grp = QParallelAnimationGroup(self)
        self._anim_grp.addAnimation(self._anim_min)
        self._anim_grp.addAnimation(self._anim_max)
        self._anim_grp.finished.connect(self._on_anim_done)

        # Collections for appearance toggling
        self._all_btns: list        = []  # every QToolButton in sidebar
        self._nav_btns: list        = []  # navigation buttons (checkable)
        self._admin_widgets: list   = []  # admin-only widgets
        self._section_lbls: list    = []  # section header labels
        self._combo_rows: list      = []  # QWidget rows containing combos
        self._expandable_lbls: list = []  # labels hidden when collapsed

        self._build_ui()

    # ── Build ─────────────────────────────────────────────────
    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── Header ────────────────────────────────────────────
        header = QWidget()
        header.setFixedHeight(64)
        header.setStyleSheet("background: #060a10; border-bottom: 1px solid #1a2332;")
        hl = QHBoxLayout(header)
        hl.setContentsMargins(10, 0, 8, 0)
        hl.setSpacing(8)

        # Logo — from assets/icons/logo.png if present, else styled "RS" badge
        logo_lbl = QLabel()
        logo_lbl.setFixedSize(34, 34)
        logo_lbl.setAlignment(Qt.AlignCenter)
        logo_lbl.setStyleSheet("background: transparent; border: none;")
        if os.path.isfile(LOGO_PATH):
            pm = QPixmap(LOGO_PATH)
            if not pm.isNull():
                logo_lbl.setPixmap(pm.scaled(34, 34, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        if logo_lbl.pixmap() is None or logo_lbl.pixmap().isNull():
            logo_lbl.setStyleSheet("""
                background: qlineargradient(x1:0,y1:0,x2:1,y2:1,
                    stop:0 #003d5c, stop:1 #006a8e);
                border-radius: 8px;
                color: #00d4ff;
                font-size: 16px;
                font-weight: 900;
                letter-spacing: -1px;
            """)
            logo_lbl.setText("RS")

        # App name from config
        name_lbl = QLabel(APP_NAME.replace(" ", "\n"))
        name_lbl.setStyleSheet("""
            color: #e6edf3;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.5px;
            line-height: 1.4;
            background: transparent;
        """)
        self._expandable_lbls.append(name_lbl)

        self._toggle_btn = QToolButton()
        self._toggle_btn.setObjectName("toggle_btn")
        self._toggle_btn.setText("◀")
        self._toggle_btn.setFixedSize(26, 26)
        self._toggle_btn.setToolTip("Collapse sidebar")
        self._toggle_btn.clicked.connect(self.toggle)

        hl.addWidget(logo_lbl)
        hl.addWidget(name_lbl, 1)
        hl.addWidget(self._toggle_btn)
        root.addWidget(header)

        # ── Scrollable body ───────────────────────────────────
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")

        body = QWidget()
        body.setStyleSheet("background: transparent;")
        bl = QVBoxLayout(body)
        bl.setContentsMargins(6, 4, 6, 4)
        bl.setSpacing(2)

        # ── Navigation section ────────────────────────────────
        nav_lbl = self._make_section_label("NAVIGATION")
        bl.addWidget(nav_lbl)
        self._section_lbls.append(nav_lbl)

        _nav_items = [
            ("monitor",    "Monitor",    0),
            ("analytics",  "Analytics",  1),
            ("events",     "Events",     2),
            ("employees",  "Employees",  3),
            ("reports",    "Reports",    4),
            ("attendance", "Attendance", 5),
        ]
        for key, text, idx in _nav_items:
            btn = self._make_nav_btn(key, text, idx)
            bl.addWidget(btn)

        # Mark Monitor as default active
        if self._nav_btns:
            self._nav_btns[0].setChecked(True)

        bl.addWidget(self._make_divider())

        # ── Session section ───────────────────────────────────
        sess_lbl = self._make_section_label("SESSION")
        bl.addWidget(sess_lbl)
        self._section_lbls.append(sess_lbl)

        # Device selector row
        dev_row = self._make_label_row("Device")
        self.device_combo = QComboBox()
        self.device_combo.setToolTip("Processing device for inference")
        for label, value in [("Auto", "auto"), ("CPU", "cpu"), ("GPU", "cuda")]:
            self.device_combo.addItem(label, value)
        dev_row.layout().addWidget(self.device_combo, 1)
        bl.addWidget(dev_row)
        self._combo_rows.append(dev_row)

        # Employee selector row
        emp_row = self._make_label_row("Operator")
        self.emp_combo = QComboBox()
        self.emp_combo.setToolTip("Select employee to monitor")
        self.emp_combo.setMinimumWidth(0)
        emp_row.layout().addWidget(self.emp_combo, 1)
        bl.addWidget(emp_row)
        self._combo_rows.append(emp_row)

        # Start / Stop
        self.btn_start = self._make_action_btn("play", "Start Session",
                                               obj_name="btn_start")
        self.btn_stop  = self._make_action_btn("stop", "Stop Session",
                                               obj_name="btn_stop")
        self.btn_stop.setEnabled(False)
        bl.addWidget(self.btn_start)
        bl.addWidget(self.btn_stop)

        bl.addWidget(self._make_divider())

        # ── Setup section ─────────────────────────────────────
        setup_lbl = self._make_section_label("SETUP")
        bl.addWidget(setup_lbl)
        self._section_lbls.append(setup_lbl)

        self.btn_cameras  = self._make_action_btn("cameras",   "Camera Setup")
        self.btn_calibrate = self._make_action_btn("calibrate", "Calibrate")
        bl.addWidget(self.btn_cameras)
        bl.addWidget(self.btn_calibrate)

        bl.addWidget(self._make_divider())

        # ── Admin section (RBAC-gated) ────────────────────────
        admin_lbl = self._make_section_label("ADMIN")
        bl.addWidget(admin_lbl)
        self._section_lbls.append(admin_lbl)
        self._admin_widgets.append(admin_lbl)

        self.btn_shifts = self._make_action_btn("shifts", "Shift Management")
        self.btn_users  = self._make_action_btn("users",  "User Management")
        self.btn_reset  = self._make_action_btn("reset",  "Reset All Data")
        self.btn_reset.setStyleSheet("""
            QToolButton { color: #f85149; }
            QToolButton:hover { background: #2a1010; color: #ff6b6b; }
        """)
        for btn in (self.btn_shifts, self.btn_users, self.btn_reset):
            bl.addWidget(btn)
            self._admin_widgets.append(btn)

        bl.addStretch(1)

        # ── About ─────────────────────────────────────────────
        bl.addWidget(self._make_divider())
        self.btn_about = self._make_action_btn("info", "About EMS")
        self.btn_about.clicked.connect(self.about_clicked.emit)
        bl.addWidget(self.btn_about)

        scroll.setWidget(body)
        root.addWidget(scroll, 1)

        # ── Footer ────────────────────────────────────────────
        footer = QWidget()
        footer.setFixedHeight(52)
        footer.setStyleSheet("background: #060a10; border-top: 1px solid #1a2332;")
        fl = QHBoxLayout(footer)
        fl.setContentsMargins(10, 4, 10, 4)

        user_icon = QLabel()
        user_icon.setFixedSize(28, 28)
        user_icon.setAlignment(Qt.AlignCenter)
        user_icon.setStyleSheet("""
            background: #1a2332; border-radius: 14px;
            color: #00d4ff; font-size: 13px; font-weight: bold;
        """)
        user_icon.setText("A")
        self._user_icon_lbl = user_icon

        self._user_info_lbl = QLabel("admin\n[ADMIN]")
        self._user_info_lbl.setStyleSheet(
            "color: #4a6070; font-size: 9px; line-height: 1.4; background: transparent;"
        )
        self._expandable_lbls.append(self._user_info_lbl)

        fl.addWidget(user_icon)
        fl.addWidget(self._user_info_lbl, 1)
        root.addWidget(footer)

    # ── Factory helpers ───────────────────────────────────────
    def _make_section_label(self, text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setObjectName("section_label")
        return lbl

    def _make_divider(self) -> QFrame:
        f = QFrame()
        f.setObjectName("sb_divider")
        f.setFrameShape(QFrame.HLine)
        f.setFixedHeight(1)
        f.setStyleSheet("background: #1a2332; border: none; margin: 4px 0;")
        return f

    def _make_label_row(self, text: str) -> QWidget:
        """Return a row widget: icon-sized left pad + label + stretch for combo."""
        row = QWidget()
        row.setStyleSheet("background: transparent;")
        rl = QHBoxLayout(row)
        rl.setContentsMargins(10, 2, 10, 2)
        rl.setSpacing(6)
        lbl = QLabel(text)
        lbl.setStyleSheet("color: #3a5060; font-size: 10px; background: transparent;")
        lbl.setFixedWidth(52)
        rl.addWidget(lbl)
        self._expandable_lbls.append(lbl)
        return row

    def _make_nav_btn(self, icon_key: str, text: str, page_idx: int) -> QToolButton:
        btn = QToolButton()
        btn.setIcon(_nav_icon(icon_key))
        btn.setText(f"  {text}")
        btn.setIconSize(QSize(18, 18))
        btn.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        btn.setCheckable(True)
        btn.setMinimumHeight(40)
        btn.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        btn.setToolTip(text)
        btn.clicked.connect(lambda _, idx=page_idx: self._on_nav(idx))
        self._nav_btns.append(btn)
        self._all_btns.append(btn)
        return btn

    def _make_action_btn(self, icon_key: str, text: str,
                         obj_name: str = "") -> QToolButton:
        btn = QToolButton()
        btn.setIcon(_nav_icon(icon_key))
        btn.setText(f"  {text}")
        btn.setIconSize(QSize(18, 18))
        btn.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        btn.setMinimumHeight(38)
        btn.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        btn.setToolTip(text)
        if obj_name:
            btn.setObjectName(obj_name)
        self._all_btns.append(btn)
        return btn

    # ── Navigation ────────────────────────────────────────────
    def _on_nav(self, idx: int):
        for i, btn in enumerate(self._nav_btns):
            btn.setChecked(i == idx)
        self.navigate.emit(idx)

    def set_page(self, idx: int):
        """Highlight the nav button without emitting navigate."""
        for i, btn in enumerate(self._nav_btns):
            btn.setChecked(i == idx)

    # ── User info ─────────────────────────────────────────────
    def set_user_info(self, username: str, role: str):
        initial = username[0].upper() if username else "?"
        self._user_icon_lbl.setText(initial)
        self._user_info_lbl.setText(f"{username}\n[{role.upper()}]")

    # ── Admin visibility ──────────────────────────────────────
    def set_admin_visible(self, visible: bool):
        for w in self._admin_widgets:
            w.setVisible(visible)

    # ── Expand / Collapse ─────────────────────────────────────
    def toggle(self):
        if self._anim_grp.state() == QPropertyAnimation.Running:
            return  # ignore clicks while animating
        if self._expanded:
            self._do_collapse()
        else:
            self._do_expand()

    def _do_collapse(self):
        self._expanded = False
        # Hide text immediately (before width shrinks)
        self._set_text_visible(False)
        self._toggle_btn.setText("≡")
        self._toggle_btn.setToolTip("Expand sidebar")
        self._anim_min.setStartValue(self.minimumWidth())
        self._anim_min.setEndValue(_SB_W_CLOSE)
        self._anim_max.setStartValue(self.maximumWidth())
        self._anim_max.setEndValue(_SB_W_CLOSE)
        self._anim_grp.start()

    def _do_expand(self):
        self._expanded = True
        self._toggle_btn.setText("◀")
        self._toggle_btn.setToolTip("Collapse sidebar")
        self._anim_min.setStartValue(self.minimumWidth())
        self._anim_min.setEndValue(_SB_W_OPEN)
        self._anim_max.setStartValue(self.maximumWidth())
        self._anim_max.setEndValue(_SB_W_OPEN)
        self._anim_grp.start()
        # Text revealed once width reaches a comfortable point
        QTimer.singleShot(int(_SB_ANIM_MS * 0.6),
                          lambda: self._set_text_visible(True))

    def _on_anim_done(self):
        """Snap exact widths after animation to avoid sub-pixel drift."""
        target = _SB_W_OPEN if self._expanded else _SB_W_CLOSE
        self.setMinimumWidth(target)
        self.setMaximumWidth(target)

    def _set_text_visible(self, visible: bool):
        style = Qt.ToolButtonTextBesideIcon if visible else Qt.ToolButtonIconOnly
        for btn in self._all_btns:
            btn.setToolButtonStyle(style)
        for lbl in self._section_lbls:
            lbl.setVisible(visible)
        for row in self._combo_rows:
            row.setVisible(visible)
        for lbl in self._expandable_lbls:
            lbl.setVisible(visible)


# ── Exit confirmation (admin + password) ──────────────────────
class ExitConfirmDialog(QDialog):
    """Ask admin password to confirm application exit."""

    def __init__(self, username: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Exit Application")
        self.setFixedSize(360, 200)
        self.setWindowFlags(Qt.Dialog | Qt.WindowCloseButtonHint)
        self.setStyleSheet("""
            QDialog { background: #080c12; }
            QLabel { color: #8ab8d0; font-size: 12px; background: transparent; }
            QLineEdit {
                background: #0a1528; border: 1px solid #0e3d5a;
                border-radius: 4px; color: #c9d1d9; padding: 8px;
            }
            QLineEdit:focus { border-color: #00d4ff; }
            QPushButton {
                background: #0e3d5a; border: 1px solid #00d4ff;
                border-radius: 4px; color: #00d4ff; padding: 8px 16px;
            }
            QPushButton:hover { background: #1a5a7a; }
        """)
        layout = QVBoxLayout(self)
        # layout.setSpacing(12)
        layout.setContentsMargins(5,5,5,5)
        layout.addWidget(QLabel("Only administrators can exit the application."))
        layout.addWidget(QLabel(f"Enter password for <b>{username}</b> to exit:"))
        self.password_edit = QLineEdit()
        self.password_edit.setEchoMode(QLineEdit.Password)
        self.password_edit.setPlaceholderText("Password")
        self.password_edit.returnPressed.connect(self._verify)
        layout.addWidget(self.password_edit)
        self.err_lbl = QLabel("")
        self.err_lbl.setStyleSheet("color: #f85149; font-size: 11px;")
        layout.addWidget(self.err_lbl)
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        ok_btn = QPushButton("Exit")
        ok_btn.clicked.connect(self._verify)
        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(ok_btn)
        btn_layout.addWidget(cancel_btn)
        layout.addLayout(btn_layout)
        self._username = username

    def _verify(self):
        from auth import auth
        pwd = self.password_edit.text()
        if not pwd:
            self.err_lbl.setText("Enter your password.")
            return
        session = auth.login(self._username, pwd)
        if session and session.is_admin:
            self.accept()
        else:
            self.err_lbl.setText("Invalid password or not an administrator.")
            self.password_edit.clear()
            self.password_edit.setFocus()


# ── About Dialog ──────────────────────────────────────────────
class AboutDialog(QDialog):
    """About / version information dialog."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("About EMS System")
        self.setFixedSize(420, 480)
        self.setWindowFlags(Qt.Dialog | Qt.WindowCloseButtonHint)
        self.setStyleSheet("""
            QDialog { background: #080c12; }
            QLabel  { background: transparent; }
        """)

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── Header gradient banner ────────────────────────────
        banner = QWidget()
        banner.setFixedHeight(110)
        banner.setStyleSheet(
            "background: qlineargradient(x1:0,y1:0,x2:1,y2:1,"
            "stop:0 #030810, stop:0.5 #001830, stop:1 #003050);"
        )
        bl = QVBoxLayout(banner)
        bl.setAlignment(Qt.AlignCenter)
        logo = QLabel()
        logo.setFixedSize(52, 52)
        logo.setAlignment(Qt.AlignCenter)
        if os.path.isfile(LOGO_PATH):
            pm = QPixmap(LOGO_PATH)
            if not pm.isNull():
                logo.setPixmap(pm.scaled(52, 52, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        if logo.pixmap() is None or logo.pixmap().isNull():
            logo.setStyleSheet("""
                background: qlineargradient(x1:0,y1:0,x2:1,y2:1,
                    stop:0 #003d5c, stop:1 #006a8e);
                border-radius: 12px; color: #00d4ff;
                font-size: 20px; font-weight: 900;
            """)
            logo.setText("RS")
        bl.addWidget(logo, 0, Qt.AlignCenter)
        app_lbl = QLabel(APP_NAME)
        app_lbl.setStyleSheet(
            "color: #e6edf3; font-size: 15px; font-weight: 700; letter-spacing: 1px;"
        )
        app_lbl.setAlignment(Qt.AlignCenter)
        bl.addWidget(app_lbl)
        root.addWidget(banner)

        # ── Body ─────────────────────────────────────────────
        body = QWidget()
        body.setStyleSheet("background: #0d1117;")
        vl = QVBoxLayout(body)
        vl.setContentsMargins(28, 18, 28, 18)
        vl.setSpacing(10)

        def _row(label, value, val_color="#8ab8d0"):
            hl = QHBoxLayout()
            lbl = QLabel(label)
            lbl.setStyleSheet("color: #4a6070; font-size: 11px;")
            lbl.setFixedWidth(110)
            val = QLabel(value)
            val.setStyleSheet(f"color: {val_color}; font-size: 11px; font-weight: 600;")
            hl.addWidget(lbl)
            hl.addWidget(val, 1)
            return hl

        vl.addLayout(_row("Version",    f"v{APP_VERSION}",       "#00d4ff"))
        vl.addLayout(_row("Developer",  "Roboway Technologies",   "#8ab8d0"))
        vl.addLayout(_row("Client",     "Banglalink Digital Communications Ltd."))
        vl.addLayout(_row("Platform",   "Windows"))
        # Website row: clickable link
        _url = "https://www.roboway.tech"
        _web_lbl = QLabel("Website")
        _web_lbl.setStyleSheet("color: #4a6070; font-size: 11px;")
        _web_lbl.setFixedWidth(110)
        _link_lbl = QLabel(f'<a href="{_url}" style="color: #00d4ff; text-decoration: none;">{_url}</a>')
        _link_lbl.setStyleSheet("font-size: 11px; font-weight: 600;")
        _link_lbl.setOpenExternalLinks(True)
        _link_lbl.setCursor(Qt.PointingHandCursor)
        _hl_web = QHBoxLayout()
        _hl_web.addWidget(_web_lbl)
        _hl_web.addWidget(_link_lbl, 1)
        vl.addLayout(_hl_web)
        # vl.addStretch()

        sep = QFrame()
        sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet("background: #1a2332; border: none; max-height: 1px;")
        vl.addWidget(sep)

        copy_lbl = QLabel(f"© 2026 Roboway Technologies. All rights reserved.")
        copy_lbl.setStyleSheet("color: #2a3a4a; font-size: 9px;")
        copy_lbl.setAlignment(Qt.AlignCenter)
        vl.addWidget(copy_lbl)

        root.addWidget(body, 1)

        # ── Close button ──────────────────────────────────────
        btn_close = QPushButton("Close")
        btn_close.setStyleSheet("""
            QPushButton {
                background: #161b22; border: 1px solid #2a3a4a;
                border-radius: 4px; color: #8ab8d0; font-size: 11px; margin: 8px 28px;
            }
            QPushButton:hover { border-color: #00d4ff; color: #00d4ff; }
        """)
        btn_close.clicked.connect(self.accept)
        root.addWidget(btn_close)


# ── Main Window ───────────────────────────────────────────────
class MainWindow(QMainWindow):
    def __init__(self, auth_session=None):
        super().__init__()
        self.setWindowTitle(f"{APP_NAME}  v{APP_VERSION}")
        self.resize(1440, 900)
        self.setMinimumSize(1100, 700)
        for name in ("app.ico", "app.png"):
            icon_path = os.path.join(ICONS_DIR, name)
            if os.path.isfile(icon_path):
                self.setWindowIcon(QIcon(icon_path))
                break

        self.db             = get_db()
        self._session       = auth_session
        self._admin_actions = []    # populated in _build_ui for RBAC
        self.worker         = None
        self.workers        = {}    # camera_id -> DetectionWorker
        self.active_emp_id  = None
        self._last_metrics  = {}
        self._fullscreen_dialogs = {}
        self._alarm_sound   = None
        if not _use_winsound_alarm and _pyglet_available and os.path.isfile(ALARM_PATH):
            try:
                self._alarm_sound = pyglet.media.load(ALARM_PATH, streaming=False)
            except Exception:
                pass

        self._build_ui()
        self._refresh_employee_list()
        self._start_clock()
        self._apply_rbac()

        # F11: toggle full screen / maximized
        f11 = QShortcut(QKeySequence(Qt.Key_F11), self)
        f11.setContext(Qt.WindowShortcut)
        f11.activated.connect(self._toggle_fullscreen)

    def _toggle_fullscreen(self):
        if self.isFullScreen():
            self.showMaximized()
        else:
            self.showFullScreen()

    def set_session(self, session):
        """Update active auth session (called after re-login)."""
        self._session = session
        self._apply_rbac()

    def _apply_rbac(self):
        """Show/hide admin-only controls based on session role."""
        is_admin = bool(self._session and self._session.is_admin)
        # Sidebar admin section
        if hasattr(self, "_sidebar"):
            self._sidebar.set_admin_visible(is_admin)
        # Legacy _admin_actions list (kept for compatibility)
        for action in self._admin_actions:
            if hasattr(action, "setVisible"):
                action.setVisible(is_admin)
        if getattr(self, "_btn_add_employee", None) is not None:
            self._btn_add_employee.setVisible(is_admin)
        if getattr(self, "emp_table", None) is not None:
            self._refresh_employee_list()
        if self._session:
            role  = self._session.role.upper()
            uname = self._session.username
            self.setWindowTitle(f"{APP_NAME}  v{APP_VERSION}  ·  {uname} [{role}]")
            if hasattr(self, "_sidebar"):
                self._sidebar.set_user_info(uname, role)

    def eventFilter(self, obj, event):
        """Touch auth session on any user interaction to prevent timeout."""
        _auth_manager.touch()
        return super().eventFilter(obj, event)

    # ── UI Construction ───────────────────────────────────────
    def _build_ui(self):
        self.setStyleSheet(QSS)

        # ── Sidebar ───────────────────────────────────────────
        self._sidebar = SideBar()

        # Wire navigation
        self._sidebar.navigate.connect(self._on_navigate)
        self._sidebar.about_clicked.connect(self._open_about)

        # Wire session buttons
        self._sidebar.btn_start.clicked.connect(self._start_session)
        self._sidebar.btn_stop.clicked.connect(self._stop_session)

        # Wire setup buttons
        self._sidebar.btn_cameras.clicked.connect(self._open_camera_setup)
        self._sidebar.btn_calibrate.clicked.connect(self._run_calibration)

        # Wire admin buttons (keep _admin_actions for _apply_rbac compat)
        self._sidebar.btn_shifts.clicked.connect(self._open_shift_management)
        self._sidebar.btn_users.clicked.connect(self._open_user_management)
        self._sidebar.btn_reset.clicked.connect(self._reset_all_data)
        self._admin_actions.extend([
            self._sidebar.btn_shifts,
            self._sidebar.btn_users,
            self._sidebar.btn_reset,
        ])

        # Expose combo/button references expected by existing methods
        self.btn_start    = self._sidebar.btn_start
        self.btn_stop     = self._sidebar.btn_stop
        self.emp_combo    = self._sidebar.emp_combo
        self.device_combo = self._sidebar.device_combo

        # Legacy menu-action stubs (referenced in _start/_stop_session)
        # Point them at the same buttons so enable/disable calls work
        self._act_start = self._sidebar.btn_start
        self._act_stop  = self._sidebar.btn_stop

        # ── Central area ──────────────────────────────────────
        central = QWidget()
        self.setCentralWidget(central)
        outer = QHBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        outer.addWidget(self._sidebar)

        content_w = QWidget()
        content_layout = QVBoxLayout(content_w)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        self.alert_panel = AlertPanel()
        content_layout.addWidget(self.alert_panel)

        self._stack = QStackedWidget()
        self._stack.addWidget(self._build_monitor_tab())    # 0
        self._stack.addWidget(self._build_analytics_tab())  # 1
        self._stack.addWidget(self._build_events_tab())     # 2
        self._stack.addWidget(self._build_employees_tab())  # 3
        self._stack.addWidget(self._build_reports_tab())    # 4
        self._stack.addWidget(self._build_attendance_tab()) # 5
        content_layout.addWidget(self._stack, 1)

        outer.addWidget(content_w, 1)

        # ── Status bar ────────────────────────────────────────
        self.status_bar = QStatusBar()
        self.status_bar.setStyleSheet(
            "QStatusBar { font-size: 11px; padding: 2px 6px; }"
        )
        self.setStatusBar(self.status_bar)
        self._status_main    = QLabel("Ready")
        self._status_main.setStyleSheet("font-size: 11px;")
        self._status_session = QLabel("No session")
        self._status_session.setStyleSheet("font-size: 11px; color: #8b949e;")
        self._status_fps     = QLabel("Rate: --")
        self._status_fps.setStyleSheet("font-size: 11px; color: #8b949e;")
        self._status_clock   = QLabel("")
        self._status_clock.setStyleSheet("font-size: 11px; color: #6e7681;")
        self.status_bar.addWidget(self._status_main, 1)
        self.status_bar.addWidget(self._status_session)
        self.status_bar.addPermanentWidget(self._status_fps)
        self.status_bar.addPermanentWidget(self._status_clock)

        # Finish device combo setup (needs device_combo defined)
        self._set_device_combo_from_config()
        self.device_combo.currentIndexChanged.connect(self._on_device_changed)

    def _on_navigate(self, idx: int):
        """Switch visible page and highlight the correct nav button."""
        self._stack.setCurrentIndex(idx)
        self._sidebar.set_page(idx)

    def _build_header(self):
        """Top bar: title, subtitle, and operator selector."""
        w = QWidget()
        w.setStyleSheet("background: #161b22; border-bottom: 1px solid #21262d;")
        w.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Minimum)
        layout = QHBoxLayout(w)
        layout.setContentsMargins(8, 4, 8, 4)
        title = QLabel(APP_NAME)
        title.setObjectName("title")
        sub = QLabel(f"  ·  {COMPANY}")
        sub.setObjectName("subtitle")
        layout.addWidget(title)
        layout.addWidget(sub)
        layout.addStretch()
        layout.addWidget(QLabel("Operator:"))
        layout.addWidget(self.emp_combo)
        return w

    def _build_monitor_tab(self):
        w = QWidget()
        main = QVBoxLayout(w)
        main.setContentsMargins(4, 4, 4, 4)
        main.setSpacing(4)

        # KPI dashboard (FR-10)
        from ui.kpi_widget import KPIWidget
        self.kpi_widget = KPIWidget()
        main.addWidget(self.kpi_widget)

        center = QWidget()
        self.monitor_grid = QGridLayout(center)
        self.monitor_grid.setSpacing(4)
        self.feed_panels = {}
        main.addWidget(center, 1)

        # ── Bottom: Notifications (left) + Detection state (right) ─
        bottom = QFrame()
        bottom.setFrameStyle(QFrame.StyledPanel)
        bottom.setStyleSheet("QFrame { background: #161b22; border: 1px solid #21262d; border-radius: 4px; }")
        bottom.setMaximumHeight(100)
        bot_layout = QHBoxLayout(bottom)
        bot_layout.setContentsMargins(8, 6, 8, 6)
        bot_layout.setSpacing(12)

        self.alert_panel.setMaximumHeight(88)
        bot_layout.addWidget(self.alert_panel, 1)

        det_box = QGroupBox("Detection state")
        det_box.setStyleSheet("QGroupBox { font-size: 10px; margin-top: 6px; padding: 6px 8px 8px 8px; }")
        det_box.setFixedWidth(320)
        dl = QGridLayout(det_box)
        dl.setContentsMargins(8, 10, 8, 6)
        dl.setSpacing(8)
        self._state_labels = {}
        for i, (name, color) in enumerate([("ACTIVE","#3fb950"), ("DROWSY","#d29922"),
                                            ("SLEEP","#f85149"), ("PHONE","#a371f7"),
                                            ("ABSENT","#d29922"), ("YAWN","#db6d28")]):
            lbl = QLabel(name)
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setMinimumSize(80, 26)
            lbl.setStyleSheet("""
                QLabel {
                    background: #21262d;
                    border: 1px solid #30363d;
                    color: #6e7681;
                    font-size: 10px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    border-radius: 4px;
                }
            """)
            self._state_labels[name] = (lbl, color)
            dl.addWidget(lbl, i // 3, i % 3)
        bot_layout.addWidget(det_box)
        main.addWidget(bottom)

        self._refresh_monitor_grid()
        if not hasattr(self, "_fullscreen_dialogs"):
            self._fullscreen_dialogs = {}
        return w

    def _grid_dims(self, n):
        """Return (rows, cols) for n feeds (1–10)."""
        if n <= 0:
            return 1, 1
        if n <= 2:
            return 1, n
        if n <= 4:
            return 2, 2
        if n <= 6:
            return 2, 3
        if n <= 9:
            return 3, 3
        return 2, 5

    def _refresh_monitor_grid(self):
        """Rebuild grid of feed panels from saved camera list."""
        while self.monitor_grid.count():
            item = self.monitor_grid.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self.feed_panels.clear()
        cameras = load_cameras()
        if not cameras:
            hint = QLabel("No cameras configured.\nClick [ CAMERAS ] to add 1–10 cameras.")
            hint.setAlignment(Qt.AlignCenter)
            hint.setStyleSheet("color: #6e7681; font-size: 13px;")
            self.monitor_grid.addWidget(hint, 0, 0)
            return
        rows, cols = self._grid_dims(len(cameras))
        for i, cam in enumerate(cameras):
            panel = FeedPanel(i, cam["label"])
            panel.double_clicked.connect(self._on_feed_fullscreen)
            panel.pause_clicked.connect(self._on_feed_pause)
            panel.capture_clicked.connect(self._on_feed_capture)
            panel.reconnect_clicked.connect(self._on_feed_reconnect)
            self.feed_panels[i] = panel
            r, c = i // cols, i % cols
            self.monitor_grid.addWidget(panel, r, c)
        for r in range(rows):
            self.monitor_grid.setRowStretch(r, 1)
        for c in range(cols):
            self.monitor_grid.setColumnStretch(c, 1)
        self._fullscreen_dialogs = getattr(self, "_fullscreen_dialogs", {})

    def _open_camera_setup(self):
        if getattr(self, "workers", None) and len(self.workers) > 0:
            QMessageBox.information(self, "Stop First", "Stop the session before changing camera setup.")
            return
        dlg = CameraSetupDialog(self)
        if dlg.exec_() == QDialog.Accepted:
            self._refresh_monitor_grid()

    def _reset_all_data(self):
        reply = QMessageBox.question(
            self, "Reset all data",
            "This will permanently delete all employees, attendance, events, sessions, and face data.\nContinue?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        if reply != QMessageBox.Yes:
            return
        if getattr(self, "workers", None) and len(self.workers) > 0:
            self._stop_session()
        try:
            self.db.reset_all_data()
            try:
                from face_service import clear_face_index
                clear_face_index()
            except Exception:
                pass
            self._refresh_employee_list()
            if getattr(self, "attendance_table", None):
                self._load_attendance()
            QMessageBox.information(self, "Reset", "All data has been removed.")
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))

    def _on_feed_fullscreen(self, camera_id):
        if camera_id not in self.feed_panels:
            return
        if camera_id in getattr(self, "_fullscreen_dialogs", {}):
            d = self._fullscreen_dialogs[camera_id]
            if d.isVisible():
                d.raise_()
                d.activateWindow()
                return
        cameras = load_cameras()
        label = cameras[camera_id]["label"] if camera_id < len(cameras) else f"Camera {camera_id+1}"
        d = CameraFeedDialog(camera_id, label, self)
        self._fullscreen_dialogs[camera_id] = d
        d.finished.connect(lambda: self._fullscreen_dialogs.pop(camera_id, None))
        d.show()

    def _on_feed_pause(self, camera_id):
        if not getattr(self, "workers", None):
            return
        if camera_id in self.workers:
            self._stop_camera(camera_id)
            self.feed_panels[camera_id].set_paused(True)
        else:
            self._start_camera(camera_id)
            self.feed_panels[camera_id].set_paused(False)

    def _on_feed_capture(self, camera_id):
        """Save a screenshot of the current frame to the evidence directory."""
        panel = self.feed_panels.get(camera_id)
        if panel is None:
            return
        frame = panel.get_last_frame()
        if frame is None:
            QMessageBox.information(self, "Capture", "No live frame available to capture.")
            return
        from datetime import datetime
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.join(EVIDENCE_DIR, f"capture_cam{camera_id + 1}_{ts}.jpg")
        try:
            import cv2 as _cv2
            _cv2.imwrite(path, frame)
            self._status_main.setText(f"📷 Captured → {os.path.basename(path)}")
        except Exception as e:
            QMessageBox.warning(self, "Capture", f"Failed to save frame:\n{e}")

    def _on_feed_reconnect(self, camera_id):
        """Force-restart the worker for a specific camera."""
        if not getattr(self, "workers", None):
            QMessageBox.information(self, "Reconnect", "No active session — start a session first.")
            return
        # Stop existing worker for this camera, then restart it
        if camera_id in self.workers:
            self._stop_camera(camera_id)
        self._start_camera(camera_id)
        if camera_id in self.feed_panels:
            self.feed_panels[camera_id].set_paused(False)
            self.feed_panels[camera_id].set_placeholder("Reconnecting…")
        self._status_main.setText(f"↺ Reconnecting camera {camera_id + 1}…")

    def _build_analytics_tab(self):
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 8)
        layout.setSpacing(8)

        ctrl = QHBoxLayout()
        ctrl.setSpacing(8)

        lbl_e = QLabel("Employee")
        lbl_e.setStyleSheet("color: #4a6070; font-size: 11px;")
        self.analytics_emp_combo = QComboBox()
        self.analytics_emp_combo.setMinimumWidth(200)
        self.analytics_emp_combo.setFixedHeight(28)

        lbl_p = QLabel("Period")
        lbl_p.setStyleSheet("color: #4a6070; font-size: 11px;")
        self.analytics_days_combo = QComboBox()
        self.analytics_days_combo.setFixedHeight(28)
        for d in ["7 days", "14 days", "30 days", "60 days"]:
            self.analytics_days_combo.addItem(d, int(d.split()[0]))

        btn_load = QPushButton()
        btn_load.setIcon(_nav_icon("analytics"))
        btn_load.setText(" Load Chart")
        btn_load.setIconSize(QSize(14, 14))
        btn_load.setFixedHeight(28)
        btn_load.setStyleSheet("""
            QPushButton {
                background: #0e3d1a; border: 1px solid #1a5c28;
                border-radius: 4px; color: #3fb950; font-size: 11px; padding: 0 12px;
            }
            QPushButton:hover { background: #165c26; border-color: #3fb950; }
        """)
        btn_load.clicked.connect(self._load_analytics)

        lbl_z = QLabel("Zoom")
        lbl_z.setStyleSheet("color: #4a6070; font-size: 11px;")
        self.chart_zoom_slider = QSlider(Qt.Horizontal)
        self.chart_zoom_slider.setMinimum(50)
        self.chart_zoom_slider.setMaximum(200)
        self.chart_zoom_slider.setValue(100)
        self.chart_zoom_slider.setFixedWidth(90)
        self.chart_zoom_slider.setFixedHeight(20)
        self.chart_zoom_slider.valueChanged.connect(self._scale_chart_image)

        btn_chart_export = QPushButton()
        btn_chart_export.setIcon(_nav_icon("reports"))
        btn_chart_export.setText(" Export PNG")
        btn_chart_export.setIconSize(QSize(14, 14))
        btn_chart_export.setFixedHeight(28)
        btn_chart_export.setStyleSheet("""
            QPushButton {
                background: #161b22; border: 1px solid #2a3a4a;
                border-radius: 4px; color: #8ab8d0; font-size: 11px; padding: 0 10px;
            }
            QPushButton:hover { border-color: #00d4ff; color: #00d4ff; }
        """)
        btn_chart_export.clicked.connect(self._export_chart_png)

        ctrl.addWidget(lbl_e)
        ctrl.addWidget(self.analytics_emp_combo)
        ctrl.addSpacing(8)
        ctrl.addWidget(lbl_p)
        ctrl.addWidget(self.analytics_days_combo)
        ctrl.addWidget(btn_load)
        ctrl.addSpacing(12)
        ctrl.addWidget(lbl_z)
        ctrl.addWidget(self.chart_zoom_slider)
        ctrl.addWidget(btn_chart_export)
        ctrl.addStretch()
        layout.addLayout(ctrl)

        # ── Chart area ────────────────────────────────────────
        self.chart_scroll = QScrollArea()
        self.chart_scroll.setWidgetResizable(True)
        self.chart_scroll.setStyleSheet(
            "QScrollArea { background: #080c12; border: 1px solid #1a2332; border-radius: 4px; }"
        )

        # Placeholder + chart share the same label
        self.chart_label = QLabel()
        self.chart_label.setAlignment(Qt.AlignCenter)
        self.chart_label.setStyleSheet("background: transparent;")
        self.chart_label.setMinimumHeight(300)
        self._set_chart_placeholder()

        self.chart_scroll.setWidget(self.chart_label)
        layout.addWidget(self.chart_scroll, 1)

        self._chart_pixmap_full = None
        self._chart_path = None
        return w

    def _set_chart_placeholder(self):
        self.chart_label.setPixmap(QPixmap())
        self.chart_label.setText(
            "<div style='color:#2a4060;font-size:14px;line-height:2'>"
            "📈<br>"
            "<span style='color:#3a6080;font-size:13px;font-weight:600'>"
            "No chart loaded</span><br>"
            "<span style='color:#1e3040;font-size:11px'>"
            "Select an employee and period, then click Load Chart."
            "</span></div>"
        )
        self.chart_label.setTextFormat(Qt.RichText)

    def _build_events_tab(self):
        w = QWidget()
        layout = QVBoxLayout(w)

        ctrl = QHBoxLayout()
        self.events_emp_combo  = QComboBox()
        self.events_emp_combo.setMinimumWidth(200)
        self.events_date_combo = QComboBox()
        today = date.today()
        for i in range(14):
            d = (today - __import__('datetime').timedelta(days=i)).isoformat()
            self.events_date_combo.addItem(d, d)
        btn_load = QPushButton("LOAD EVENTS")
        btn_load.clicked.connect(self._load_events)
        ctrl.addWidget(QLabel("EMPLOYEE:")); ctrl.addWidget(self.events_emp_combo)
        ctrl.addWidget(QLabel("DATE:"));     ctrl.addWidget(self.events_date_combo)
        ctrl.addWidget(btn_load); ctrl.addStretch()
        layout.addLayout(ctrl)

        self.events_table = QTableWidget(0, 6)
        self.events_table.setHorizontalHeaderLabels(
            ["TIME", "TYPE", "STARTED", "ENDED", "DURATION", "SEVERITY"])
        self.events_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.events_table.setAlternatingRowColors(True)
        self.events_table.setEditTriggers(QTableWidget.NoEditTriggers)
        layout.addWidget(self.events_table)

        # Live event log
        log_box = QGroupBox("LIVE EVENT LOG")
        ll = QVBoxLayout(log_box)
        self.event_log = QTextEdit()
        self.event_log.setReadOnly(True)
        self.event_log.setMaximumHeight(140)
        ll.addWidget(self.event_log)
        layout.addWidget(log_box)
        return w

    def _build_employees_tab(self):
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 8)
        layout.setSpacing(8)

        ctrl = QHBoxLayout()
        ctrl.setSpacing(6)

        def _emp_btn(icon_key, label, tooltip=""):
            b = QPushButton()
            b.setIcon(_nav_icon(icon_key))
            b.setText(f" {label}")
            b.setIconSize(QSize(14, 14))
            b.setFixedHeight(26)
            b.setToolTip(tooltip or label)
            b.setStyleSheet("""
                QPushButton {
                    background: #161b22;
                    border: 1px solid #2a3a4a;
                    border-radius: 4px;
                    color: #8ab8d0;
                    font-size: 11px;
                    padding: 0 10px;
                }
                QPushButton:hover  { background: #1a2632; border-color: #00d4ff; color: #00d4ff; }
                QPushButton:pressed{ background: #0d1e2e; }
            """)
            return b

        self._btn_add_employee = _emp_btn("employees", "Add Employee", "Add a new employee")
        self._btn_add_employee.clicked.connect(self._add_employee)
        btn_ref = _emp_btn("reconnect", "Refresh", "Refresh employee list")
        btn_ref.clicked.connect(self._refresh_employee_list)

        ctrl.addWidget(self._btn_add_employee)
        ctrl.addWidget(btn_ref)
        ctrl.addStretch()
        layout.addLayout(ctrl)

        self.emp_table = QTableWidget(0, 5)
        self.emp_table.setHorizontalHeaderLabels(
            ["NAME", "EMPLOYEE ID", "DEPARTMENT", "CALIBRATED", "ACTIONS"])
        self.emp_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.emp_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Fixed)
        self.emp_table.setColumnWidth(4, 120)
        self.emp_table.verticalHeader().setDefaultSectionSize(34)
        self.emp_table.setAlternatingRowColors(True)
        self.emp_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.emp_table.setSelectionBehavior(QTableWidget.SelectRows)
        layout.addWidget(self.emp_table)
        return w

    def _build_reports_tab(self):
        w = QWidget()
        root = QVBoxLayout(w)
        root.setContentsMargins(10, 10, 10, 8)
        root.setSpacing(8)

        # ── Row 1: filters ────────────────────────────────────
        filter_row = QHBoxLayout()
        filter_row.setSpacing(8)

        lbl_emp = QLabel("Employee")
        lbl_emp.setStyleSheet("color: #4a6070; font-size: 11px;")
        self.report_emp_combo = QComboBox()
        self.report_emp_combo.setMinimumWidth(180)
        self.report_emp_combo.setFixedHeight(28)

        lbl_period = QLabel("Period")
        lbl_period.setStyleSheet("color: #4a6070; font-size: 11px;")
        self.report_days_combo = QComboBox()
        self.report_days_combo.setFixedHeight(28)
        for d in ["7 days", "14 days", "30 days"]:
            self.report_days_combo.addItem(d, int(d.split()[0]))

        lbl_zoom = QLabel("Zoom")
        lbl_zoom.setStyleSheet("color: #4a6070; font-size: 11px;")
        self.report_zoom_slider = QSlider(Qt.Horizontal)
        self.report_zoom_slider.setMinimum(50)
        self.report_zoom_slider.setMaximum(200)
        self.report_zoom_slider.setValue(100)
        self.report_zoom_slider.setFixedWidth(90)
        self.report_zoom_slider.setFixedHeight(20)
        self.report_zoom_slider.valueChanged.connect(self._scale_report_image)

        filter_row.addWidget(lbl_emp)
        filter_row.addWidget(self.report_emp_combo)
        filter_row.addSpacing(12)
        filter_row.addWidget(lbl_period)
        filter_row.addWidget(self.report_days_combo)
        filter_row.addSpacing(12)
        filter_row.addWidget(lbl_zoom)
        filter_row.addWidget(self.report_zoom_slider)
        filter_row.addStretch()
        root.addLayout(filter_row)

        # ── Row 2: action buttons ─────────────────────────────
        btn_row = QHBoxLayout()
        btn_row.setSpacing(6)

        def _rpt_btn(icon_key, label, tooltip=""):
            b = QPushButton()
            b.setIcon(_nav_icon(icon_key))
            b.setText(f" {label}")
            b.setIconSize(QSize(15, 15))
            b.setFixedHeight(28)
            b.setToolTip(tooltip or label)
            b.setStyleSheet("""
                QPushButton {
                    background: #161b22;
                    border: 1px solid #2a3a4a;
                    border-radius: 4px;
                    color: #8ab8d0;
                    font-size: 11px;
                    padding: 0 10px;
                }
                QPushButton:hover  { background: #1a2632; border-color: #00d4ff; color: #00d4ff; }
                QPushButton:pressed{ background: #0d1e2e; }
            """)
            return b

        btn_emp_report  = _rpt_btn("employees", "Employee",   "Generate employee report")
        btn_team_report = _rpt_btn("analytics",  "Team",       "Generate team summary")
        btn_csv         = _rpt_btn("reports",    "Export CSV", "Export attendance to CSV")
        btn_pdf_att     = _rpt_btn("attendance", "Attendance PDF", "Export today's attendance PDF")
        btn_pdf_shift   = _rpt_btn("shifts",     "Shift PDF",      "Export shift summary PDF")
        btn_export_png  = _rpt_btn("camera",     "Save PNG",       "Save current chart as PNG")

        btn_emp_report.clicked.connect(self._gen_emp_report)
        btn_team_report.clicked.connect(self._gen_team_report)
        btn_csv.clicked.connect(self._export_csv)
        btn_pdf_att.clicked.connect(self._export_attendance_pdf)
        btn_pdf_shift.clicked.connect(self._export_shift_pdf)
        btn_export_png.clicked.connect(self._export_report_png)

        btn_row.addWidget(btn_emp_report)
        btn_row.addWidget(btn_team_report)
        btn_row.addWidget(btn_csv)
        btn_row.addWidget(btn_pdf_att)
        btn_row.addWidget(btn_pdf_shift)
        btn_row.addWidget(btn_export_png)
        btn_row.addStretch()
        root.addLayout(btn_row)

        # ── Thin separator ────────────────────────────────────
        sep = QFrame()
        sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet("background: #1a2332; border: none; max-height: 1px; margin: 0;")
        root.addWidget(sep)

        # ── Report viewer ─────────────────────────────────────
        self.report_scroll = QScrollArea()
        self.report_scroll.setWidgetResizable(True)
        self.report_scroll.setStyleSheet(
            "QScrollArea { background: #080c12; border: none; }"
        )

        # Placeholder + real image share the same QLabel
        self.report_label = QLabel()
        self.report_label.setAlignment(Qt.AlignCenter)
        self.report_label.setStyleSheet("background: transparent;")
        self._set_report_placeholder()

        self.report_scroll.setWidget(self.report_label)
        root.addWidget(self.report_scroll, 1)

        # ── Status bar ────────────────────────────────────────
        self.report_path_lbl = QLabel("")
        self.report_path_lbl.setStyleSheet(
            "color: #3fb950; font-size: 10px; padding: 2px 0;"
        )
        root.addWidget(self.report_path_lbl)

        self._report_pixmap_full = None
        self._report_path        = None
        return w

    def _set_report_placeholder(self):
        """Show a centred empty-state message in the report viewer."""
        self.report_label.setPixmap(QPixmap())
        self.report_label.setText(
            "<div style='color:#2a4060;font-size:14px;line-height:2'>"
            "📊<br>"
            "<span style='color:#3a6080;font-size:13px;font-weight:600'>"
            "No report generated yet</span><br>"
            "<span style='color:#1e3040;font-size:11px'>"
            "Select an employee and period, then click a report button above."
            "</span></div>"
        )
        self.report_label.setTextFormat(Qt.RichText)

    def _build_attendance_tab(self):
        w = QWidget()
        layout = QVBoxLayout(w)
        ctrl = QHBoxLayout()
        ctrl.addWidget(QLabel("Date:"))
        self.attendance_date = QLineEdit(date.today().isoformat())
        self.attendance_date.setMaximumWidth(120)
        ctrl.addWidget(self.attendance_date)
        btn_refresh = QPushButton("Refresh")
        btn_refresh.clicked.connect(self._load_attendance)
        ctrl.addWidget(btn_refresh)
        ctrl.addStretch()
        layout.addLayout(ctrl)
        # Summary: time present until face disappeared > ATTENDANCE_ABSENCE_MINUTES
        summary_box = QGroupBox("Time present")
        summary_box.setStyleSheet("QGroupBox { font-size: 10px; margin-top: 6px; padding: 4px 8px 8px 8px; }")
        self.attendance_summary_label = QLabel("Refresh to see summary.")
        self.attendance_summary_label.setWordWrap(True)
        self.attendance_summary_label.setStyleSheet("color: #8ab8d0; font-size: 11px;")
        sl = QVBoxLayout(summary_box)
        sl.addWidget(self.attendance_summary_label)
        layout.addWidget(summary_box)
        self.attendance_table = QTableWidget(0, 6)
        self.attendance_table.setHorizontalHeaderLabels(
            ["Employee", "ID", "Department", "Event", "Status", "Time"])
        self.attendance_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        layout.addWidget(self.attendance_table)
        self._load_attendance()
        return w

    def _load_attendance(self):
        date_str = self.attendance_date.text().strip() or date.today().isoformat()
        self.attendance_date.setText(date_str)
        rows = self.db.get_attendance_for_date(date_str)
        self.attendance_table.setRowCount(len(rows))
        for row, r in enumerate(rows):
            self.attendance_table.setItem(row, 0, QTableWidgetItem(r.get("name", "")))
            self.attendance_table.setItem(row, 1, QTableWidgetItem(r.get("emp_code", "")))
            self.attendance_table.setItem(row, 2, QTableWidgetItem(r.get("department", "") or "—"))
            self.attendance_table.setItem(row, 3, QTableWidgetItem(r.get("event_type", "").upper()))
            status = (r.get("status", "") or "").replace("_", " ").title()
            status_item = QTableWidgetItem(status or "—")
            _status_colors = {
                "Present": "#3fb950", "Late": "#d29922",
                "Early Departure": "#f85149", "Absent": "#f85149"
            }
            status_item.setForeground(QColor(_status_colors.get(status, "#8b949e")))
            self.attendance_table.setItem(row, 4, status_item)
            t = r.get("recognized_at", "")
            self.attendance_table.setItem(row, 5, QTableWidgetItem(t[11:19] if len(t) >= 19 else t))
        # Summary: total time present per employee (session ends when gap > ATTENDANCE_ABSENCE_MINUTES)
        absence_sec = ATTENDANCE_ABSENCE_MINUTES * 60
        from collections import defaultdict
        by_emp = defaultdict(list)
        for r in rows:
            t = r.get("recognized_at")
            if t:
                try:
                    ts = datetime.fromisoformat(t).timestamp()
                    by_emp[(r.get("employee_id"), r.get("name", "?"), r.get("emp_code", ""))].append(ts)
                except Exception:
                    pass
        lines = []
        for (eid, name, code), timestamps in sorted(by_emp.items(), key=lambda x: x[1][1]):
            timestamps.sort()
            total_sec = 0
            session_start = None
            prev_ts = None
            for ts in timestamps:
                if session_start is None or (ts - prev_ts) > absence_sec:
                    if session_start is not None:
                        total_sec += prev_ts - session_start
                    session_start = ts
                prev_ts = ts
            if session_start is not None:
                total_sec += prev_ts - session_start
            h, rem = divmod(int(total_sec), 3600)
            m, _ = divmod(rem, 60)
            time_str = f"{h}h {m}m" if h else f"{m}m"
            last_str = datetime.fromtimestamp(timestamps[-1]).strftime("%H:%M") if timestamps else "—"
            lines.append(f"{name} ({code}): {time_str} present, last seen {last_str}")
        self.attendance_summary_label.setText("\n".join(lines) if lines else "No attendance for this date.")

    # ── Session Control ───────────────────────────────────────
    def _start_session(self):
        emp_id = self.emp_combo.currentData()
        if emp_id is None:
            QMessageBox.warning(self, "No Employee", "Please select an employee.")
            return
        enabled = [(i, c) for i, c in enumerate(load_cameras()) if c.get("enabled", True)]
        if not enabled:
            QMessageBox.warning(self, "No Cameras", "Enable at least one camera in Camera Setup.")
            return

        emp = self.db.get_employee(emp_id)
        self.active_emp_id = emp_id
        self.workers = {}
        for camera_id, cam in enabled:
            w = DetectionWorker(emp_id, cam["index"], camera_id)
            w.frame_ready.connect(self._on_frame)
            w.metrics_updated.connect(self._on_metrics)
            w.alert_triggered.connect(self._on_alert)
            w.status_changed.connect(self._on_status)
            w.attendance_logged.connect(self._on_attendance_logged)
            w.camera_disconnected.connect(self._on_camera_disconnected)
            w.camera_reconnected.connect(self._on_camera_reconnected)
            w.start()
            self.workers[camera_id] = w
            if camera_id in self.feed_panels:
                self.feed_panels[camera_id].set_paused(False)
                self.feed_panels[camera_id].set_placeholder("Starting…")

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.emp_combo.setEnabled(False)
        self.device_combo.setEnabled(False)
        self._status_session.setText(f"{emp['name']} · Started {datetime.now().strftime('%H:%M:%S')}")
        # Update KPI camera count
        if hasattr(self, "kpi_widget"):
            self.kpi_widget.set_camera_count(len(self.workers))

    def _stop_session(self):
        for camera_id, w in list(self.workers.items()):
            w.stop()
            w.wait(3000)
            if camera_id in self.feed_panels:
                self.feed_panels[camera_id].set_placeholder("No video signal")
                self.feed_panels[camera_id].set_paused(False)
        self.workers = {}
        for d in list(getattr(self, "_fullscreen_dialogs", {}).values()):
            d.reject()
        self._fullscreen_dialogs = {}

        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.emp_combo.setEnabled(True)
        self.device_combo.setEnabled(True)
        self._status_session.setText("No session")
        self._status_main.setText("Session stopped")

    def _stop_camera(self, camera_id):
        if camera_id not in self.workers:
            return
        w = self.workers.pop(camera_id)
        w.stop()
        w.wait(2000)
        if camera_id in self.feed_panels:
            self.feed_panels[camera_id].set_placeholder("Paused")

    def _start_camera(self, camera_id):
        if self.active_emp_id is None or camera_id in self.workers:
            return
        cameras = load_cameras()
        if camera_id >= len(cameras):
            return
        cam = cameras[camera_id]
        w = DetectionWorker(self.active_emp_id, cam["index"], camera_id)
        w.frame_ready.connect(self._on_frame)
        w.metrics_updated.connect(self._on_metrics)
        w.alert_triggered.connect(self._on_alert)
        w.status_changed.connect(self._on_status)
        w.start()
        self.workers[camera_id] = w
        if camera_id in self.feed_panels:
            self.feed_panels[camera_id].set_placeholder("Resuming…")

    def _set_device_combo_from_config(self):
        dev = getattr(config, "INFERENCE_DEVICE", "auto")
        for i in range(self.device_combo.count()):
            if self.device_combo.itemData(i) == dev:
                self.device_combo.blockSignals(True)
                self.device_combo.setCurrentIndex(i)
                self.device_combo.blockSignals(False)
                break

    def _on_device_changed(self):
        dev = self.device_combo.currentData()
        if dev:
            config.INFERENCE_DEVICE = dev

    def _run_calibration(self):
        emp_id = self.emp_combo.currentData()
        if emp_id is None:
            QMessageBox.warning(self, "No Employee", "Select an employee first.")
            return

        if getattr(self, "workers", None) and len(self.workers) > 0:
            QMessageBox.information(self, "Stop First", "Stop the active session before calibrating.")
            return

        cameras = load_cameras()
        if not cameras:
            QMessageBox.warning(self, "No Cameras", "Add at least one camera in Camera Setup.")
            return

        # Let user pick which camera to calibrate for
        dlg = QDialog(self)
        dlg.setWindowTitle("Calibrate — Select camera")
        layout = QVBoxLayout(dlg)
        layout.addWidget(QLabel("Calibration is stored per camera. Choose the camera to calibrate:"))
        cam_combo = QComboBox()
        for i, c in enumerate(cameras):
            cam_combo.addItem(f"{c['label']} (index: {c['index']})", (i, c["index"]))
        layout.addWidget(cam_combo)
        btns = QHBoxLayout()
        ok_btn = QPushButton("Start calibration")
        ok_btn.clicked.connect(dlg.accept)
        cxl_btn = QPushButton("Cancel")
        cxl_btn.clicked.connect(dlg.reject)
        btns.addWidget(ok_btn)
        btns.addWidget(cxl_btn)
        layout.addLayout(btns)
        if dlg.exec_() != QDialog.Accepted:
            return

        camera_id, cam_index = cam_combo.currentData()
        emp = self.db.get_employee(emp_id)
        import cv2
        from detection.calibration import run_calibration

        cap = cv2.VideoCapture(cam_index)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  CAM_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT)

        QMessageBox.information(self, "Calibration",
            "Calibration will open in a separate window.\n"
            "Follow the 3 phases (SPACE to start each, ESC to cancel).")

        profile = run_calibration(cap, emp_id, emp["name"], camera_id)
        cap.release()

        if profile:
            self.db.update_calib_path(emp_id, f"emp_{emp_id}_cam_{camera_id}.json")
            QMessageBox.information(self, "Done",
                f"Calibration complete for {cameras[camera_id]['label']}.")
            self._refresh_employee_list()
        else:
            QMessageBox.warning(self, "Cancelled", "Calibration was cancelled or failed.")

    # ── Slots ─────────────────────────────────────────────────
    @pyqtSlot(int, np.ndarray)
    def _on_frame(self, camera_id, frame):
        if camera_id in self.feed_panels:
            self.feed_panels[camera_id].set_frame(frame)
        if camera_id in getattr(self, "_fullscreen_dialogs", {}):
            self._fullscreen_dialogs[camera_id].set_frame(frame)

    @pyqtSlot(int, dict)
    def _on_metrics(self, camera_id, m):
        self._last_metrics = m
        # Use metrics from first camera for detection state display (aggregate view)
        if camera_id != 0:
            return

        # Update detection state indicators
        active_states = set()
        if m.get("sleep"):   active_states.add("SLEEP")
        elif m.get("drowsy"): active_states.add("DROWSY")
        if m.get("yawn"):    active_states.add("YAWN")
        if m.get("phone"):   active_states.add("PHONE")
        if m.get("absent"):  active_states.add("ABSENT")
        if not active_states: active_states.add("ACTIVE")

        for name, (lbl, color) in self._state_labels.items():
            if name in active_states:
                lbl.setStyleSheet(f"""
                    QLabel {{
                        background: {color}20;
                        border: 1px solid {color};
                        color: {color};
                        font-size: 10px;
                        font-weight: 600;
                        letter-spacing: 0.5px;
                        border-radius: 4px;
                    }}
                """)
            else:
                lbl.setStyleSheet("""
                    QLabel {
                        background: #21262d;
                        border: 1px solid #30363d;
                        color: #6e7681;
                        font-size: 10px;
                        font-weight: 600;
                        letter-spacing: 0.5px;
                        border-radius: 4px;
                    }
                """)

        self._status_fps.setText(f"Rate: {m.get('fps', 0):.1f}")

    @pyqtSlot(int, str, str, str)
    def _on_alert(self, camera_id, event_type, message, severity):
        self.alert_panel.show_alert(camera_id, message, severity)
        # Play alarm for critical (e.g. sleep) and warning (drowsy, phone, absent)
        if severity not in ("critical", "warning"):
            pass
        elif _use_winsound_alarm and os.path.isfile(ALARM_PATH):
            try:
                import winsound
                winsound.PlaySound(ALARM_PATH, winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)
            except Exception:
                pass
        elif self._alarm_sound is not None:
            try:
                self._alarm_sound.play()
            except Exception:
                pass
        icon = EVENT_ICONS.get(event_type, "●")
        color = ALERT_COLORS.get(severity, "#ffaa00")
        ts = datetime.now().strftime("%H:%M:%S")
        self.event_log.append(
            f'<span style="color:#3a6a80;">[{ts}]</span> '
            f'<span style="color:{color};">{icon} Cam {camera_id+1}: {message}</span>'
        )

    @pyqtSlot(int, str)
    def _on_status(self, camera_id, msg):
        self._status_main.setText(f"Cam {camera_id+1}: {msg}")

    @pyqtSlot(int, int)
    def _on_attendance_logged(self, employee_id, camera_id):
        # Do not refresh the attendance table on every log (every ~30 s); user can click Refresh
        pass

    # ── Employee management ───────────────────────────────────
    def _add_employee(self):
        if not (self._session and self._session.is_admin):
            QMessageBox.warning(self, "Access Denied", "Admin role required to add employees.")
            return
        dlg = EmployeeDialog(self, db=self.db)
        if dlg.exec_() == QDialog.Accepted and dlg.result_data:
            d = dlg.result_data
            try:
                emp_id = self.db.add_employee(d["name"], d["employee_id"], d["department"])
                photo_paths = d.get("photo_paths", [])
                if not isinstance(photo_paths, list):
                    photo_paths = list(photo_paths) if photo_paths else []
                photo_paths = [p for p in photo_paths if isinstance(p, str)]
                self._save_employee_photos(emp_id, photo_paths, replace=True)
                self._refresh_employee_list()
            except Exception as e:
                print(e)
                QMessageBox.critical(self, "Error", f"Failed to add employee:\n{e}")

    def _delete_employee(self, emp_id):
        if not (self._session and self._session.is_admin):
            QMessageBox.warning(self, "Access Denied", "Admin role required to delete employees.")
            return
        emp = self.db.get_employee(emp_id)
        if not emp:
            return
        name = emp["name"]
        reply = QMessageBox.question(
            self, "Delete employee",
            f"Permanently delete employee \"{name}\"?\nThis will remove their photos, attendance, and session data.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        if reply != QMessageBox.Yes:
            return
        try:
            try:
                from face_service import remove_employee_faces, is_available
                if is_available():
                    remove_employee_faces(emp_id)
            except Exception:
                pass
            self.db.delete_employee(emp_id)
            self._refresh_employee_list()
            QMessageBox.information(self, "Deleted", "Employee deleted.")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to delete employee:\n{e}")

    def _edit_employee(self, emp_id):
        if not (self._session and self._session.is_admin):
            QMessageBox.warning(self, "Access Denied", "Admin role required to edit employees.")
            return
        emp = self.db.get_employee(emp_id)
        if not emp:
            return
        # Convert Row to plain dict to avoid any unpack issues with sqlite3.Row
        emp_dict = dict(zip(emp.keys(), list(emp)))
        dlg = EmployeeDialog(self, employee=emp_dict, db=self.db)
        if dlg.exec_() == QDialog.Accepted and dlg.result_data:
            d = dlg.result_data
            try:
                self.db.update_employee(emp_id, name=d["name"], employee_id=d["employee_id"], department=d["department"])
                photo_paths = d.get("photo_paths", [])
                if not isinstance(photo_paths, list):
                    photo_paths = list(photo_paths) if photo_paths else []
                photo_paths = [p for p in photo_paths if isinstance(p, str)]
                self._save_employee_photos(emp_id, photo_paths, replace=True)
                self._refresh_employee_list()
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Failed to update employee:\n{e}")

    def _save_employee_photos(self, employee_id, photo_paths, replace=True):
        """Copy new photos to FACE_PHOTOS_DIR, save to DB, update face embeddings. Shows progress dialog."""
        prog = QProgressDialog("Saving employee & face data…", None, 0, 0, None)
        prog.setWindowTitle("Please wait")
        prog.setWindowModality(Qt.ApplicationModal)
        prog.setMinimumDuration(0)
        prog.setCancelButton(None)
        prog.setRange(0, 0)
        prog.show()
        QApplication.processEvents()
        try:
            if replace:
                self.db.delete_employee_photos(employee_id)
                try:
                    from face_service import remove_employee_faces, is_available
                    if is_available():
                        remove_employee_faces(employee_id)
                except Exception:
                    pass
            saved_paths = []
            skipped_no_face = 0
            for path in photo_paths or []:
                if not os.path.isfile(path):
                    continue
                base = os.path.basename(path)
                name, ext = os.path.splitext(base)
                crop = crop_face_from_image(path)  # extract face only; full image is not used
                if crop is None:
                    skipped_no_face += 1
                    continue
                dest = os.path.join(FACE_PHOTOS_DIR, f"emp_{employee_id}_{name}_{id(path)}.jpg")
                try:
                    cv2.imwrite(dest, crop)
                    self.db.add_employee_photo(employee_id, dest)
                    saved_paths.append(dest)
                except Exception:
                    pass
                QApplication.processEvents()

            if skipped_no_face:
                QMessageBox.information(self, "Some images skipped",
                    f"{skipped_no_face} image(s) had no face detected; only face crops were saved.")
            if saved_paths:
                from face_service import is_available
                if is_available():
                    prog.setLabelText("Converting photos to embeddings…")
                    prog.setRange(0, len(saved_paths))
                    prog.setValue(0)
                    QApplication.processEvents()
                    worker = EmbeddingWorker(employee_id, saved_paths, self)
                    def on_progress(*args):
                        if len(args) >= 2:
                            c, t = args[0], args[1]
                        elif len(args) == 1 and isinstance(args[0], (tuple, list)) and len(args[0]) >= 2:
                            c, t = args[0][0], args[0][1]
                        else:
                            return
                        if t:
                            prog.setMaximum(t)
                            prog.setValue(c)
                            prog.setLabelText(f"Converting to embeddings… {c}/{t}")
                    worker.progress.connect(on_progress)
                    worker.finished.connect(prog.accept)
                    worker.start()
                    prog.exec_()
                    worker.wait(5000)
        finally:
            prog.accept()

    def _refresh_employee_list(self):
        emps = self.db.get_employees()
        # Main combo
        self.emp_combo.clear()
        self.analytics_emp_combo.clear()
        self.events_emp_combo.clear()
        self.report_emp_combo.clear()

        for emp in emps:
            label = f"{emp['name']} ({emp['employee_id']})"
            for combo in [self.emp_combo, self.analytics_emp_combo,
                          self.events_emp_combo, self.report_emp_combo]:
                combo.addItem(label, emp["id"])

        # Employee table
        import os
        from config import CALIB_DIR
        self.emp_table.setRowCount(len(emps))
        for row, emp in enumerate(emps):
            self.emp_table.setItem(row, 0, QTableWidgetItem(emp["name"]))
            self.emp_table.setItem(row, 1, QTableWidgetItem(emp["employee_id"]))
            self.emp_table.setItem(row, 2, QTableWidgetItem(emp["department"] or "—"))
            calib_path = os.path.join(CALIB_DIR, f"emp_{emp['id']}.json")
            calib_status = "✓ Calibrated" if os.path.exists(calib_path) else "—"
            ci = QTableWidgetItem(calib_status)
            ci.setForeground(QColor("#3fb950") if "✓" in calib_status else QColor("#8b949e"))
            self.emp_table.setItem(row, 3, ci)
            is_admin = bool(self._session and self._session.is_admin)
            if is_admin:
                actions_w = QWidget()
                actions_layout = QHBoxLayout(actions_w)
                actions_layout.setContentsMargins(3, 2, 3, 2)
                actions_layout.setSpacing(4)
                edit_btn = QPushButton("Edit")
                edit_btn.setFixedHeight(22)
                edit_btn.setFixedWidth(46)
                edit_btn.setStyleSheet("""
                    QPushButton {
                        background: #1a2632; border: 1px solid #2a3a4a;
                        border-radius: 3px; color: #8ab8d0; font-size: 10px;
                    }
                    QPushButton:hover { border-color: #00d4ff; color: #00d4ff; }
                """)
                edit_btn.clicked.connect(lambda checked, eid=emp["id"]: self._edit_employee(eid))
                delete_btn = QPushButton("Delete")
                delete_btn.setFixedHeight(22)
                delete_btn.setFixedWidth(50)
                delete_btn.setStyleSheet("""
                    QPushButton {
                        background: #2a1010; border: 1px solid #3a1a1a;
                        border-radius: 3px; color: #f85149; font-size: 10px;
                    }
                    QPushButton:hover { border-color: #f85149; }
                """)
                delete_btn.clicked.connect(lambda checked, eid=emp["id"]: self._delete_employee(eid))
                actions_layout.addWidget(edit_btn)
                actions_layout.addWidget(delete_btn)
                self.emp_table.setCellWidget(row, 4, actions_w)
            else:
                self.emp_table.setCellWidget(row, 4, QLabel("—"))

    # ── Analytics tab ─────────────────────────────────────────
    def _load_analytics(self):
        emp_id = self.analytics_emp_combo.currentData()
        days   = self.analytics_days_combo.currentData()
        if emp_id is None: return

        from reports.generator import generate_employee_report
        path = generate_employee_report(emp_id, days)
        if path and os.path.exists(path):
            self._chart_pixmap_full = QPixmap(path)
            self._chart_path = path
            self.chart_label.setText("")
            QTimer.singleShot(50, self._scale_chart_image)
        else:
            self._chart_pixmap_full = None
            self._chart_path = None
            self._set_chart_placeholder()

    # ── Events tab ────────────────────────────────────────────
    def _load_events(self):
        emp_id    = self.events_emp_combo.currentData()
        date_str  = self.events_date_combo.currentData()
        if emp_id is None: return

        events = self.db.get_events_for_day(emp_id, date_str)
        self.events_table.setRowCount(len(events))
        for row, ev in enumerate(events):
            icon = EVENT_ICONS.get(ev["event_type"], "●")
            self.events_table.setItem(row, 0, QTableWidgetItem(ev["started_at"][11:19] if ev["started_at"] else ""))
            self.events_table.setItem(row, 1, QTableWidgetItem(f"{icon} {ev['event_type'].upper()}"))
            self.events_table.setItem(row, 2, QTableWidgetItem(ev["started_at"][11:19] if ev["started_at"] else ""))
            self.events_table.setItem(row, 3, QTableWidgetItem(ev["ended_at"][11:19]   if ev["ended_at"]   else "ongoing"))
            dur = ev["duration_sec"] or 0
            self.events_table.setItem(row, 4, QTableWidgetItem(_sec_to_hms(dur)))
            sev_item = QTableWidgetItem(ev["severity"].upper())
            sev_item.setForeground(QColor(ALERT_COLORS.get(ev["severity"], "#8ab8d0")))
            self.events_table.setItem(row, 5, sev_item)

    # ── Reports tab ───────────────────────────────────────────
    def _gen_emp_report(self):
        emp_id = self.report_emp_combo.currentData()
        days   = self.report_days_combo.currentData()
        if emp_id is None: return
        from reports.generator import generate_employee_report
        path = generate_employee_report(emp_id, days)
        self._show_report(path)

    def _gen_team_report(self):
        days = self.report_days_combo.currentData()
        from reports.generator import generate_team_report
        path = generate_team_report(days)
        self._show_report(path)

    def _export_csv(self):
        emp_id = self.report_emp_combo.currentData()
        days   = self.report_days_combo.currentData()
        if emp_id is None: return
        from reports.generator import export_csv
        path = export_csv(emp_id, days)
        if path:
            self.report_path_lbl.setText(f"CSV saved: {path}")
            QMessageBox.information(self, "Exported", f"CSV saved to:\n{path}")

    def _show_report(self, path):
        if path and os.path.exists(path):
            self._report_pixmap_full = QPixmap(path)
            self._report_path = path
            self.report_label.setText("")
            QTimer.singleShot(50, self._scale_report_image)
            self.report_path_lbl.setText(f"✓  Saved: {path}")
        else:
            self._report_pixmap_full = None
            self._report_path = None
            self._set_report_placeholder()
            self.report_path_lbl.setText("No data available for the selected period.")

    def _scale_report_image(self):
        if getattr(self, "_report_pixmap_full", None) is None or self._report_pixmap_full.isNull():
            return
        pm = self._report_pixmap_full
        factor = (self.report_zoom_slider.value() / 100.0) if getattr(self, "report_zoom_slider", None) else 1.0
        vw = self.report_scroll.viewport().width()
        base_w = max(vw - 20, 100)
        dw = max(80, int(base_w * factor))
        scaled = pm.scaledToWidth(dw, Qt.SmoothTransformation)
        self.report_label.setPixmap(scaled)
        self.report_label.setFixedSize(scaled.size())

    def _export_report_png(self):
        path = getattr(self, "_report_path", None)
        if not path or not os.path.exists(path):
            QMessageBox.information(self, "Export", "Generate a report first, or use the path shown below.")
            return
        default_name = os.path.basename(path)
        dest, _ = QFileDialog.getSaveFileName(self, "Export PNG", default_name, "PNG (*.png)")
        if dest:
            try:
                import shutil
                shutil.copy2(path, dest)
                self.report_path_lbl.setText(f"Exported: {dest}")
                QMessageBox.information(self, "Export", f"Saved to:\n{dest}")
            except Exception as e:
                QMessageBox.warning(self, "Export", str(e))

    def _scale_chart_image(self):
        if getattr(self, "_chart_pixmap_full", None) is None or self._chart_pixmap_full.isNull():
            return
        pm = self._chart_pixmap_full
        factor = (self.chart_zoom_slider.value() / 100.0) if getattr(self, "chart_zoom_slider", None) else 1.0
        vw = self.chart_scroll.viewport().width()
        base_w = max(vw - 20, 100)
        dw = max(80, int(base_w * factor))
        scaled = pm.scaledToWidth(dw, Qt.SmoothTransformation)
        self.chart_label.setPixmap(scaled)
        self.chart_label.setFixedSize(scaled.size())

    def _export_chart_png(self):
        path = getattr(self, "_chart_path", None)
        if not path or not os.path.exists(path):
            QMessageBox.information(self, "Export", "Load a chart first.")
            return
        default_name = os.path.basename(path)
        dest, _ = QFileDialog.getSaveFileName(self, "Export PNG", default_name, "PNG (*.png)")
        if dest:
            try:
                import shutil
                shutil.copy2(path, dest)
                QMessageBox.information(self, "Export", f"Saved to:\n{dest}")
            except Exception as e:
                QMessageBox.warning(self, "Export", str(e))

    # ── Clock ─────────────────────────────────────────────────
    def _start_clock(self):
        timer = QTimer(self)
        timer.timeout.connect(self._tick_clock)
        timer.start(1000)

    def _tick_clock(self):
        self._status_clock.setText(datetime.now().strftime("%Y-%m-%d  %H:%M:%S"))

    def _export_attendance_pdf(self):
        """Export today's attendance as a PDF report (FR-10)."""
        from reports.generator import export_attendance_pdf
        from datetime import date
        path = export_attendance_pdf(date.today().isoformat())
        if path:
            self.report_path_lbl.setText(f"PDF saved: {path}")
            QMessageBox.information(self, "Exported", f"Attendance PDF saved to:\n{path}")
        else:
            QMessageBox.warning(self, "Error", "PDF export failed. Is reportlab installed?")

    def _export_shift_pdf(self):
        """Export today's shift summary as a PDF report (FR-10)."""
        from reports.generator import export_shift_summary_pdf
        from datetime import date
        path = export_shift_summary_pdf(date.today().isoformat())
        if path:
            self.report_path_lbl.setText(f"PDF saved: {path}")
            QMessageBox.information(self, "Exported", f"Shift Summary PDF saved to:\n{path}")
        else:
            QMessageBox.warning(self, "Error", "PDF export failed. Is reportlab installed?")

    def _open_about(self):
        """Show the About dialog."""
        dlg = AboutDialog(self)
        dlg.exec_()

    def _open_shift_management(self):
        """Open shift & schedule management dialog (admin only, FR-6)."""
        if not (self._session and self._session.is_admin):
            QMessageBox.warning(self, "Access Denied", "Admin role required.")
            return
        from ui.shift_dialog import ShiftManagementDialog
        dlg = ShiftManagementDialog(self)
        dlg.exec_()

    def _open_user_management(self):
        """Open user management & system config dialog (admin only, FR-8)."""
        if not (self._session and self._session.is_admin):
            QMessageBox.warning(self, "Access Denied", "Admin role required.")
            return
        from ui.user_dialog import UserManagementDialog
        dlg = UserManagementDialog(self)
        dlg.exec_()

    @pyqtSlot(int)
    def _on_camera_disconnected(self, camera_id: int):
        """Handle camera disconnection signal (FR-7)."""
        if camera_id in self.feed_panels:
            self.feed_panels[camera_id].set_placeholder("⚠ DISCONNECTED")
            self.feed_panels[camera_id].set_disconnected(True)
            self.feed_panels[camera_id].title_lbl.setStyleSheet(
                "color: #f85149; font-weight: 600; font-size: 10px; background: transparent;"
            )

    @pyqtSlot(int)
    def _on_camera_reconnected(self, camera_id: int):
        """Handle camera reconnection signal (FR-7)."""
        if camera_id in self.feed_panels:
            cameras = load_cameras()
            self.feed_panels[camera_id].set_disconnected(False)
            self.feed_panels[camera_id].title_lbl.setStyleSheet(
                "color: #8b949e; font-weight: 600; font-size: 10px; background: transparent;"
            )
            self.feed_panels[camera_id].set_placeholder("Reconnected — monitoring…")

    def closeEvent(self, event):
        # Only admin can exit; require password confirmation
        if not (self._session and self._session.is_admin):
            QMessageBox.warning(
                self, "Exit",
                "Only administrators can exit the application."
            )
            event.ignore()
            return
        dlg = ExitConfirmDialog(self._session.username, self)
        if dlg.exec_() != QDialog.Accepted:
            event.ignore()
            return
        if getattr(self, "workers", None):
            for w in self.workers.values():
                w.stop()
                w.wait(2000)
        event.accept()