# ============================================================
#  mqtt_service.py  —  MQTT + Redis alert publisher (FR-9)
#  Publishes structured JSON payloads on alert events.
#  Topic pattern: ems/{site_id}/{camera_id}/{alert_type}
#  Redis channel: ems:alerts
# ============================================================
import json
import logging
import threading
import time
import base64
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_MQTT_CLIENT: Optional[object] = None
_REDIS_CLIENT: Optional[object] = None
_lock = threading.Lock()


# ── MQTT ──────────────────────────────────────────────────────
def _get_mqtt():
    """Lazy-init MQTT client; returns None if disabled or paho unavailable."""
    global _MQTT_CLIENT
    if _MQTT_CLIENT is not None:
        return _MQTT_CLIENT
    with _lock:
        if _MQTT_CLIENT is not None:
            return _MQTT_CLIENT
        from database import get_db
        db = get_db()
        if not db.get_config_bool("mqtt_enabled", False):
            return None
        try:
            import paho.mqtt.client as mqtt
            broker = db.get_config("mqtt_broker", "localhost")
            port   = db.get_config_int("mqtt_port", 1883)
            use_tls = db.get_config_bool("mqtt_use_tls", False)
            client = mqtt.Client(client_id="ems_sentinel")
            if use_tls:
                client.tls_set()
            client.connect(broker, port, keepalive=60)
            client.loop_start()
            _MQTT_CLIENT = client
            logger.info("[MQTT] Connected to %s:%d", broker, port)
        except Exception as e:
            logger.warning("[MQTT] Connection failed: %s", e)
            _MQTT_CLIENT = None
    return _MQTT_CLIENT


def _get_redis():
    """Lazy-init Redis client; returns None if disabled or redis-py unavailable."""
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    with _lock:
        if _REDIS_CLIENT is not None:
            return _REDIS_CLIENT
        from database import get_db
        db = get_db()
        if not db.get_config_bool("redis_enabled", False):
            return None
        try:
            import redis
            host = db.get_config("redis_host", "localhost")
            port = db.get_config_int("redis_port", 6379)
            _REDIS_CLIENT = redis.Redis(host=host, port=port, decode_responses=True)
            _REDIS_CLIENT.ping()
            logger.info("[Redis] Connected to %s:%d", host, port)
        except Exception as e:
            logger.warning("[Redis] Connection failed: %s", e)
            _REDIS_CLIENT = None
    return _REDIS_CLIENT


def _build_payload(alert_id: int, site_id: str, camera_id: str, employee_id: str,
                   employee_name: str, alert_type: str, severity: str,
                   shift_label: str, thumbnail_path: str) -> dict:
    """Build the canonical alert JSON payload (FR-9)."""
    thumbnail_b64 = ""
    if thumbnail_path and os.path.isfile(thumbnail_path):
        try:
            with open(thumbnail_path, "rb") as f:
                thumbnail_b64 = base64.b64encode(f.read()).decode()
        except Exception:
            pass
    return {
        "event_id":      alert_id,
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "site_id":       site_id,
        "camera_id":     camera_id,
        "employee_id":   employee_id,
        "employee_name": employee_name,
        "alert_type":    alert_type,
        "severity":      severity,
        "shift_label":   shift_label,
        "thumbnail_b64": thumbnail_b64,
    }


def publish_alert(site_id: str, camera_id: str, employee_id: str, employee_name: str,
                  alert_type: str, severity: str, shift_label: str = "",
                  thumbnail_path: str = "") -> int:
    """Log alert to DB and publish to MQTT + Redis.

    Returns the alert_events row id.
    """
    from database import get_db
    db = get_db()

    # Persist first (crash safety before any network I/O)
    alert_id = db.log_alert_event(
        site_id=site_id,
        camera_id=camera_id,
        employee_id=employee_id,
        employee_name=employee_name,
        alert_type=alert_type,
        severity=severity,
        shift_label=shift_label,
        thumbnail_path=thumbnail_path,
    )

    payload = _build_payload(
        alert_id, site_id, camera_id, employee_id, employee_name,
        alert_type, severity, shift_label, thumbnail_path
    )
    payload_json = json.dumps(payload)

    # MQTT
    mqtt_ok = False
    client = _get_mqtt()
    if client is not None:
        topic = f"ems/{site_id}/{camera_id}/{alert_type}"
        try:
            result = client.publish(topic, payload_json, qos=1, retain=False)
            mqtt_ok = result.rc == 0
            if mqtt_ok:
                logger.debug("[MQTT] Published to %s", topic)
        except Exception as e:
            logger.warning("[MQTT] Publish failed: %s", e)

    # Redis
    redis_ok = False
    r = _get_redis()
    if r is not None:
        try:
            r.publish("ems:alerts", payload_json)
            redis_ok = True
            logger.debug("[Redis] Published alert %d", alert_id)
        except Exception as e:
            logger.warning("[Redis] Publish failed: %s", e)

    db.mark_alert_published(alert_id, mqtt=mqtt_ok, redis=redis_ok)
    return alert_id


def retry_unpublished():
    """Retry publishing any un-published alerts (e.g. after reconnect).

    Call this from a background timer, e.g. every 60 s.
    """
    from database import get_db
    db = get_db()
    rows = db.get_unpublished_alerts(limit=50)
    if not rows:
        return
    for row in rows:
        try:
            payload = _build_payload(
                row["id"], row["site_id"], row["camera_id"],
                row["employee_id"], row["employee_name"],
                row["alert_type"], row["severity"],
                row["shift_label"], row["thumbnail_path"],
            )
            payload_json = json.dumps(payload)
            mqtt_ok, redis_ok = False, False
            client = _get_mqtt()
            if client and not row["mqtt_published"]:
                try:
                    topic = f"ems/{row['site_id']}/{row['camera_id']}/{row['alert_type']}"
                    res = client.publish(topic, payload_json, qos=1)
                    mqtt_ok = res.rc == 0
                except Exception:
                    pass
            r = _get_redis()
            if r and not row["redis_published"]:
                try:
                    r.publish("ems:alerts", payload_json)
                    redis_ok = True
                except Exception:
                    pass
            db.mark_alert_published(row["id"], mqtt=mqtt_ok, redis=redis_ok)
        except Exception as e:
            logger.warning("[Retry] Alert %d: %s", row["id"], e)


def reset_connections():
    """Force-close MQTT and Redis connections (e.g. after config change)."""
    global _MQTT_CLIENT, _REDIS_CLIENT
    with _lock:
        if _MQTT_CLIENT:
            try:
                _MQTT_CLIENT.loop_stop()
                _MQTT_CLIENT.disconnect()
            except Exception:
                pass
            _MQTT_CLIENT = None
        _REDIS_CLIENT = None
    logger.info("[MQ] Connections reset.")
