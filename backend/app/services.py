from __future__ import annotations

import datetime as dt
from typing import Dict, List, Tuple

import httpx

NASA_POWER_BASE = "https://power.larc.nasa.gov/api/temporal/monthly/point"
NASA_PARAMS = ["T2M", "PRECTOTCORR", "RH2M"]

USER_AGENT = "EcoShield/1.0 (contact: ecoshield@example.com)"


async def geocode_query(query: str) -> Tuple[float, float, str]:
    """Resolve a free-text place to lat/lon using OSM Nominatim.
    Returns (lat, lon, display_name).
    """
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "format": "jsonv2",
        "q": query,
        "limit": 1,
    }
    headers = {"User-Agent": USER_AGENT}

    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    if not data:
        raise ValueError("No results for query")
    first = data[0]
    lat = float(first["lat"])
    lon = float(first["lon"])
    display = first.get("display_name", query)
    return lat, lon, display


def _yyyymm_range(start: dt.date | None, end: dt.date | None) -> Tuple[str, str]:
    today = dt.date.today().replace(day=1)
    default_start = dt.date(today.year - 20, 1, 1)  # last 20 years
    s = (start or default_start)
    e = (end or today)
    return s.strftime("%Y%m"), e.strftime("%Y%m")


async def fetch_nasa_power_monthly(lat: float, lon: float, start: dt.date | None = None, end: dt.date | None = None) -> Dict:
    """Fetch monthly climate series from NASA POWER for given point.
    Returns normalized series list with keys: date (YYYY-MM), temperature_c, precip_mm, humidity_percent
    """
    start_str, end_str = _yyyymm_range(start, end)
    params = {
        "parameters": ",".join(NASA_PARAMS),
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": start_str,
        "end": end_str,
        "format": "JSON",
    }
    headers = {"User-Agent": USER_AGENT}

    async with httpx.AsyncClient(timeout=60, headers=headers) as client:
        resp = await client.get(NASA_POWER_BASE, params=params)
        resp.raise_for_status()
        payload = resp.json()

    # NASA POWER has used different top-level shapes over time; handle flexibly
    parameter_root = None
    if isinstance(payload, dict):
        if "properties" in payload and isinstance(payload["properties"], dict):
            props = payload["properties"]
            parameter_root = props.get("parameter") or props.get("parameters")
        if parameter_root is None and "parameters" in payload:
            parameter_root = payload["parameters"]
    if not parameter_root:
        raise ValueError("Unexpected NASA POWER response structure")

    # Map of parameter -> {YYYYMM: value}
    t2m = parameter_root.get("T2M", {})
    prcp = parameter_root.get("PRECTOTCORR", {})
    rh = parameter_root.get("RH2M", {})

    # Merge keys and produce sorted timeseries
    all_keys = sorted({*t2m.keys(), *prcp.keys(), *rh.keys()})
    series: List[Dict] = []
    for k in all_keys:
        # Keys may be int or str; normalize to str
        key = str(k)
        if len(key) == 6:  # YYYYMM
            date_label = f"{key[:4]}-{key[4:]}"
        elif len(key) == 8:  # YYYYMMDD -> month
            date_label = f"{key[:4]}-{key[4:6]}"
        else:
            # Fallback: try to parse
            try:
                if len(key) >= 6:
                    date_label = f"{key[:4]}-{key[4:6]}"
                else:
                    continue
            except Exception:
                continue

        series.append(
            {
                "date": date_label,
                "temperature_c": _safe_float(t2m.get(k)),
                "precip_mm": _safe_float(prcp.get(k)),
                "humidity_percent": _safe_float(rh.get(k)),
            }
        )

    # Remove entries with all Nones
    series = [row for row in series if any(v is not None for v in (row["temperature_c"], row["precip_mm"], row["humidity_percent"]))]

    return {"series": series}


def _safe_float(value) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def compute_business_suitability(series: List[Dict]) -> int:
    """Compute a 0-100 suitability score from monthly series.
    Penalize distance from comfortable ranges; average across time and variables.
    """
    if not series:
        return 0

    temp_penalties: List[float] = []
    precip_penalties: List[float] = []
    humidity_penalties: List[float] = []

    for row in series:
        t = row.get("temperature_c")
        p = row.get("precip_mm")
        h = row.get("humidity_percent")

        if t is not None:
            # Ideal ~20C; 0 penalty at 20; 1 penalty at <=5 or >=35
            temp_penalties.append(_clamp_abs_scale(t, center=20.0, half_span=15.0))
        if p is not None:
            # Ideal monthly precip 40-150 mm
            precip_penalties.append(_range_penalty(p, low=40.0, high=150.0, full_span=300.0))
        if h is not None:
            # Ideal humidity 30-60%
            humidity_penalties.append(_range_penalty(h, low=30.0, high=60.0, full_span=100.0))

    def mean(values: List[float]) -> float:
        return sum(values) / len(values) if values else 1.0

    avg_penalty = mean(temp_penalties) * 0.4 + mean(precip_penalties) * 0.3 + mean(humidity_penalties) * 0.3
    score = int(round(100.0 * max(0.0, 1.0 - avg_penalty)))
    return max(0, min(100, score))


def _clamp_abs_scale(value: float, center: float, half_span: float) -> float:
    """Absolute distance from center scaled to [0,1] over half-span."""
    dist = abs(value - center)
    return min(1.0, dist / half_span)


def _range_penalty(value: float, low: float, high: float, full_span: float) -> float:
    """Penalty 0 inside [low, high]; outside grows linearly to 1 at distance full_span/2 beyond.
    Example: low=40, high=150, full_span=300 -> 0 at [40,150], 1 at <=-110 or >=300.
    """
    if low <= value <= high:
        return 0.0
    if value < low:
        return min(1.0, (low - value) / (full_span / 2))
    return min(1.0, (value - high) / (full_span / 2))
