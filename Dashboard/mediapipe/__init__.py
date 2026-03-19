# Shim: load only solutions (face_mesh, hands), not tasks.
# This avoids importing the tasks submodule which pulls in conflicting dependencies.
# We redirect this package to the real implementation in site-packages.

import os
import site

_real_mp = None
_search_paths = site.getsitepackages() + [site.getusersitepackages()]
for _p in _search_paths:
    _cand = os.path.join(_p, "mediapipe")
    if os.path.isdir(_cand) and os.path.isfile(os.path.join(_cand, "__init__.py")):
        _real_mp = _cand
        break

if _real_mp is None:
    raise ImportError(
        "Shim could not find required package in site-packages. "
        "Install the face/hands dependency (see requirements.txt)."
    )

# Point this package at the real implementation so submodules load from there
__path__ = [_real_mp]

from mediapipe.python import *
import mediapipe.python.solutions as solutions

# Expose face_mesh and hands; avoid importing tasks submodule.

try:
    __version__ = getattr(solutions, "__version__", None) or "0.10.9"
except Exception:
    __version__ = "0.10.9"
