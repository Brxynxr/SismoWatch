"""
SismoWatch - Data Transformation and Feature Engineering Module
Transforms raw USGS GeoJSON events into typed, enriched Medallion records.
"""
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any

US_STATE_CODES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "PR": "Puerto Rico", "VI": "Virgin Islands", "GU": "Guam", "MP": "Northern Mariana Islands"
}

def compute_payload_hash(payload: Any) -> str:
    """Calculates SHA-256 hash of a canonical JSON payload for idempotency."""
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def extract_region_from_place(place: Optional[str]) -> str:
    """
    Extracts a standardized region name from USGS place description.
    Examples:
      '13 km N of Borrego Springs, CA' -> 'California'
      '75 km W of Hualien City, Taiwan' -> 'Taiwan'
      'near the coast of Central Chile' -> 'Chile'
    """
    if not place or not place.strip():
        return "Desconocida"

    place = place.strip()

    # Case 1: Has comma separator (e.g. '... of City, State/Country')
    if "," in place:
        parts = [p.strip() for p in place.split(",")]
        tail = parts[-1]
        # Check if tail is 2-letter US state code
        if tail.upper() in US_STATE_CODES:
            return US_STATE_CODES[tail.upper()]
        # Check if tail contains words like 'B.C., Mexico' or 'Fiji'
        if tail:
            # Clean up trailing punctuation
            clean_tail = re.sub(r"[^\w\s]", "", tail).strip()
            if clean_tail:
                return clean_tail

    # Case 2: 'of Region' pattern (e.g. 'near the coast of Central Chile')
    match = re.search(r"\bof\s+(.+)$", place, re.IGNORECASE)
    if match:
        candidate = match.group(1).strip()
        # Clean direction words (e.g. 'Northern', 'Central', 'Southern')
        candidate = re.sub(r"^(northern|southern|eastern|western|central)\s+", "", candidate, flags=re.IGNORECASE)
        clean = re.sub(r"[^\w\s]", "", candidate).strip()
        if clean:
            return clean

    return place[:50].strip()

def classify_magnitude(mag: Optional[float]) -> str:
    """
    Categorizes earthquake magnitude according to USGS standard scales.
    """
    if mag is None:
        return "Unknown"
    m = float(mag)
    if m < 2.0:
        return "Micro"
    elif m < 4.0:
        return "Minor"
    elif m < 5.0:
        return "Light"
    elif m < 6.0:
        return "Moderate"
    elif m < 7.0:
        return "Strong"
    elif m < 8.0:
        return "Major"
    else:
        return "Great"

def calculate_impact_radius(magnitude: Optional[float], depth_km: Optional[float] = 10.0) -> float:
    """
    Estimates theoretical perceptible impact radius (MMI III+) in kilometers using
    attenuation law: R = 10^(0.45 * M - 0.8), with depth adjustment.
    """
    if magnitude is None or magnitude <= 0:
        return 1.0

    mag = float(magnitude)
    depth = max(1.0, float(depth_km or 10.0))

    # Base perceptible radius
    base_r = math.pow(10, (0.45 * mag - 0.8))

    # Deeper earthquakes dissipate more energy before reaching surface
    if depth > 30.0:
        depth_attenuation = math.sqrt(base_r**2 + depth**2) - depth
        radius = max(1.0, depth_attenuation)
    else:
        radius = max(1.0, base_r)

    return round(radius, 2)

def parse_epoch_ms(epoch_ms: Optional[int]) -> Optional[datetime]:
    """Converts epoch milliseconds to UTC datetime with timezone."""
    if epoch_ms is None:
        return None
    try:
        return datetime.fromtimestamp(epoch_ms / 1000.0, tz=timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None

def parse_geojson_feature(feature: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parses a single GeoJSON Feature dictionary into a flat, typed record
    ready for Staging and Curated layers.
    """
    props = feature.get("properties") or {}
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []

    event_id = str(feature.get("id") or "").strip()
    try:
        raw_mag = props.get("mag")
        mag = float(raw_mag) if raw_mag is not None else None
    except (ValueError, TypeError):
        mag = None

    try:
        depth = float(coords[2]) if len(coords) > 2 and coords[2] is not None else 10.0
    except (ValueError, TypeError):
        depth = 10.0

    try:
        lon = float(coords[0]) if len(coords) > 0 and coords[0] is not None else None
    except (ValueError, TypeError):
        lon = None

    try:
        lat = float(coords[1]) if len(coords) > 1 and coords[1] is not None else None
    except (ValueError, TypeError):
        lat = None

    place = str(props.get("place") or "").strip()
    region = extract_region_from_place(place)
    mag_class = classify_magnitude(mag)
    impact_radius = calculate_impact_radius(mag, depth)

    event_time = parse_epoch_ms(props.get("time"))
    updated_time = parse_epoch_ms(props.get("updated")) or event_time

    tsunami_val = props.get("tsunami")
    tsunami_alert = bool(tsunami_val == 1 or tsunami_val is True)

    return {
        "event_id": event_id,
        "magnitude": mag,
        "magnitude_class": mag_class,
        "mag_type": str(props.get("magType") or "")[:10] if props.get("magType") else None,
        "place": place[:255] if place else None,
        "region": region[:100],
        "impact_radius_km": impact_radius,
        "event_time": event_time,
        "updated_time": updated_time,
        "longitude": lon,
        "latitude": lat,
        "depth_km": depth,
        "tsunami_alert": tsunami_alert,
        "significance": int(props["sig"]) if props.get("sig") is not None else None,
        "status": str(props.get("status") or "")[:50] if props.get("status") else None,
        "event_type": str(props.get("type") or "")[:50] if props.get("type") else None,
        "usgs_url": str(props.get("url") or "") if props.get("url") else None
    }
