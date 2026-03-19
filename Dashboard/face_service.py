# ============================================================
#  face_service.py  —  Face recognition
# ============================================================
import os
import numpy as np
from config import (
    FACE_INDEX_DIR,
    FACE_RECOGNITION_THRESHOLD,
)

_METADATA_PATH = os.path.join(FACE_INDEX_DIR, "face_embeddings.npz")

_index = None
_employee_ids = None  # np.array of int, same order as index
_embeddings = None   # (n, 512) float32, kept in sync with index
_deepface_available = False

try:
    from deepface import DeepFace
    _deepface_available = True
except Exception:
    _deepface_available = False


def _build_index(embeddings, employee_ids):
    """Build face index from (n, dim) embeddings and (n,) employee_ids."""
    try:
        import faiss
        if embeddings is None or len(embeddings) == 0:
            return faiss.IndexFlatL2(512), np.array([], dtype=np.int64), np.zeros((0, 512), dtype=np.float32)
        emb = np.asarray(embeddings, dtype=np.float32)
        if emb.ndim == 1:
            emb = emb.reshape(1, -1)
        idx = faiss.IndexFlatL2(emb.shape[1])
        idx.add(emb)
        ids = np.asarray(employee_ids, dtype=np.int64)
        if ids.ndim == 0:
            ids = ids.reshape(1)
        return idx, ids, emb
    except Exception:
        return None, None, None


def _get_index():
    """Load or create face index and employee_id mapping. Returns (index, employee_ids, embeddings) or (None, None, None)."""
    global _index, _employee_ids, _embeddings
    if _index is not None:
        return _index, _employee_ids, _embeddings
    try:
        import faiss
        if os.path.isfile(_METADATA_PATH):
            data = np.load(_METADATA_PATH, allow_pickle=True)
            emb = data["embeddings"]
            ids = data["employee_ids"]
            if emb.size == 0:
                _index = faiss.IndexFlatL2(512)
                _employee_ids = np.array([], dtype=np.int64)
                _embeddings = np.zeros((0, 512), dtype=np.float32)
            else:
                _index, _employee_ids, _embeddings = _build_index(emb, ids)
                if _index is None:
                    return None, None, None
            return _index, _employee_ids, _embeddings
        _index = faiss.IndexFlatL2(512)
        _employee_ids = np.array([], dtype=np.int64)
        _embeddings = np.zeros((0, 512), dtype=np.float32)
        return _index, _employee_ids, _embeddings
    except Exception:
        return None, None, None


def _save(embeddings, employee_ids):
    try:
        np.savez(_METADATA_PATH, embeddings=embeddings, employee_ids=employee_ids)
    except Exception:
        pass


def get_embedding_from_image(image_input):
    """Get 512-dim face embedding. image_input: path or BGR numpy (h,w,3)."""
    if not _deepface_available:
        return None
    try:
        if isinstance(image_input, np.ndarray):
            result = DeepFace.represent(image_input, enforce_detection=False)
        else:
            result = DeepFace.represent(img_path=image_input, enforce_detection=False)
        if result and len(result) > 0:
            return np.array(result[0]["embedding"], dtype=np.float32)
    except Exception:
        pass
    return None


def add_faces(employee_id, image_paths, progress_callback=None):
    """Add face embeddings for an employee from one or more photo paths. Returns count added.
    If progress_callback(current, total) is given, it is called after each image (1-based)."""
    index, employee_ids, embeddings = _get_index()
    if index is None:
        return 0
    paths = [p for p in image_paths if os.path.isfile(p)]
    total = len(paths)
    new_emb_list = []
    for i, path in enumerate(paths):
        if progress_callback:
            progress_callback(i + 1, total)
        emb = get_embedding_from_image(path)
        if emb is None:
            continue
        new_emb_list.append(emb)
    if not new_emb_list:
        return 0
    global _index, _employee_ids, _embeddings
    new_emb = np.stack(new_emb_list, axis=0)
    new_ids = np.full(len(new_emb_list), employee_id, dtype=np.int64)
    if len(embeddings) == 0:
        all_emb = new_emb
        all_ids = new_ids
    else:
        all_emb = np.concatenate([embeddings, new_emb], axis=0)
        all_ids = np.concatenate([employee_ids, new_ids], axis=0)
    _index, _employee_ids, _embeddings = _build_index(all_emb, all_ids)
    _save(_embeddings, _employee_ids)
    return len(new_emb_list)


def clear_face_index():
    """Remove all face embeddings (e.g. after database reset)."""
    global _index, _employee_ids, _embeddings
    try:
        import faiss
        _index = faiss.IndexFlatL2(512)
        _employee_ids = np.array([], dtype=np.int64)
        _embeddings = np.zeros((0, 512), dtype=np.float32)
        _save(_embeddings, _employee_ids)
    except Exception:
        pass


def remove_employee_faces(employee_id):
    """Remove all embeddings for an employee (rebuild index without that employee)."""
    index, employee_ids, embeddings = _get_index()
    if index is None or len(employee_ids) == 0:
        return
    try:
        mask = employee_ids != employee_id
        if not np.any(mask):
            new_emb = np.zeros((0, embeddings.shape[1]), dtype=np.float32)
            new_ids = np.array([], dtype=np.int64)
        else:
            new_emb = embeddings[mask]
            new_ids = employee_ids[mask]
        global _index, _employee_ids, _embeddings
        _index, _employee_ids, _embeddings = _build_index(new_emb, new_ids)
        _save(_embeddings, _employee_ids)
    except Exception:
        pass


def recognize_face(embedding):
    """
    Find best matching employee. Returns (employee_id, distance) or (None, None).
    L2 distance; only returns if distance <= FACE_RECOGNITION_THRESHOLD.
    """
    index, employee_ids, _ = _get_index()
    if index is None or embedding is None or index.ntotal == 0:
        return None, None
    try:
        q = np.array(embedding, dtype=np.float32).reshape(1, -1)
        distances, indices = index.search(q, 1)
        if indices.size == 0:
            return None, None
        dist = float(distances[0][0])
        if dist > FACE_RECOGNITION_THRESHOLD:
            return None, None
        idx = int(indices[0][0])
        rid = int(employee_ids[idx])
        return rid, dist
    except Exception:
        return None, None


def is_available():
    """True if face recognition and index are available."""
    if not _deepface_available:
        return False
    index, _, _ = _get_index()
    return index is not None


def get_backend_name():
    """Return display name for face recognition backend or None."""
    return "Face recognition" if _deepface_available else None
