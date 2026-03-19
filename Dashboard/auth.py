# ============================================================
#  auth.py  —  RBAC session management (FR-8)
#  Roles: admin (full), viewer (read-only)
#  Session auto-logout after configurable inactivity period
# ============================================================
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Roles
ROLE_ADMIN  = "admin"
ROLE_VIEWER = "viewer"


class Session:
    """Represents an authenticated user session."""

    def __init__(self, user: dict, timeout_minutes: int = 30):
        self.user_id       = user["id"]
        self.username      = user["username"]
        self.role          = user["role"]
        self.timeout_sec   = timeout_minutes * 60
        self._last_active  = time.time()

    def touch(self):
        """Reset the inactivity timer."""
        self._last_active = time.time()

    @property
    def is_expired(self) -> bool:
        return (time.time() - self._last_active) > self.timeout_sec

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN

    @property
    def is_viewer(self) -> bool:
        return self.role == ROLE_VIEWER

    def remaining_seconds(self) -> int:
        remaining = self.timeout_sec - (time.time() - self._last_active)
        return max(0, int(remaining))


class AuthManager:
    """Singleton RBAC manager.

    Usage::

        auth = AuthManager()
        session = auth.login("admin", "admin123")
        if session and session.is_admin:
            ...
        auth.logout()
    """

    _instance: Optional["AuthManager"] = None
    _current_session: Optional[Session] = None

    @classmethod
    def instance(cls) -> "AuthManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def login(self, username: str, password: str) -> Optional[Session]:
        """Verify credentials and open a session.  Returns Session or None."""
        from database import get_db
        db = get_db()
        user = db.verify_password(username, password)
        if not user:
            logger.warning("[AUTH] Failed login attempt for user '%s'", username)
            db.audit("system", "LOGIN_FAILED", f"username={username}")
            return None
        timeout = db.get_config_int("session_timeout_minutes", 30)
        session = Session(user, timeout)
        self.__class__._current_session = session
        logger.info("[AUTH] Login: %s (%s)", username, user["role"])
        db.audit(username, "LOGIN", f"role={user['role']}", user_id=user["id"])
        return session

    def logout(self):
        """End the current session."""
        if self._current_session:
            from database import get_db
            db = get_db()
            db.audit(self._current_session.username, "LOGOUT",
                     user_id=self._current_session.user_id)
            logger.info("[AUTH] Logout: %s", self._current_session.username)
        self.__class__._current_session = None

    @property
    def session(self) -> Optional[Session]:
        s = self.__class__._current_session
        if s and s.is_expired:
            logger.info("[AUTH] Session expired for %s", s.username)
            self.__class__._current_session = None
            return None
        return s

    def touch(self):
        """Call on any user interaction to prevent session timeout."""
        if self.__class__._current_session:
            self.__class__._current_session.touch()

    def require_admin(self) -> bool:
        """Return True if current session has admin role."""
        s = self.session
        return s is not None and s.is_admin

    def require_any(self) -> bool:
        """Return True if any user is logged in and session valid."""
        return self.session is not None

    @property
    def current_username(self) -> str:
        s = self.session
        return s.username if s else "—"

    @property
    def current_role(self) -> str:
        s = self.session
        return s.role if s else "—"


# Module-level convenience
auth = AuthManager.instance()
