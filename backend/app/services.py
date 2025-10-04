from __future__ import annotations

import datetime as dt
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
import os
import requests

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


# --------------------
# requests-based helpers (sync) for NASA POWER and FIRMS
# --------------------

def fetch_power_monthly_requests(lat: float, lon: float, start_year: int, end_year: int) -> Dict[str, Dict[str, Optional[float]]]:
    """Fetch monthly data using requests for a year range.
    Returns mapping YYYYMM -> { 'T2M': value, 'PRECTOTCORR': value, 'RH2M': value }
    """
    if start_year > end_year:
        raise ValueError("start_year must be <= end_year")
    start = f"{start_year:04d}01"
    end = f"{end_year:04d}12"
    params = {
        "parameters": ",".join(NASA_PARAMS),
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": start,
        "end": end,
        "format": "JSON",
    }
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(NASA_POWER_BASE, params=params, headers=headers, timeout=60)
    resp.raise_for_status()
    payload = resp.json()

    parameter_root = None
    if isinstance(payload, dict):
        if "properties" in payload and isinstance(payload["properties"], dict):
            props = payload["properties"]
            parameter_root = props.get("parameter") or props.get("parameters")
        if parameter_root is None and "parameters" in payload:
            parameter_root = payload["parameters"]
    if not parameter_root:
        raise ValueError("Unexpected NASA POWER response structure")

    t2m = parameter_root.get("T2M", {})
    prcp = parameter_root.get("PRECTOTCORR", {})
    rh = parameter_root.get("RH2M", {})

    monthly: Dict[str, Dict[str, Optional[float]]] = {}
    for k in set(map(str, [*t2m.keys(), *prcp.keys(), *rh.keys()])):
        monthly[k] = {
            "T2M": _safe_float(t2m.get(k) if k in t2m else t2m.get(int(k)) if isinstance(next(iter(t2m or {}), None), int) else t2m.get(k)),
            "PRECTOTCORR": _safe_float(prcp.get(k) if k in prcp else prcp.get(int(k)) if isinstance(next(iter(prcp or {}), None), int) else prcp.get(k)),
            "RH2M": _safe_float(rh.get(k) if k in rh else rh.get(int(k)) if isinstance(next(iter(rh or {}), None), int) else rh.get(k)),
        }
    return monthly


def aggregate_yearly_averages(monthly: Dict[str, Dict[str, Optional[float]]]) -> List[Dict]:
    """Aggregate monthly (YYYYMM) dict to yearly averages of T2M, PRECTOTCORR, RH2M."""
    sums = defaultdict(lambda: {"T2M": 0.0, "T2M_n": 0, "PRECTOTCORR": 0.0, "PRECTOTCORR_n": 0, "RH2M": 0.0, "RH2M_n": 0})
    for yyyymm, vals in monthly.items():
        year = int(str(yyyymm)[:4])
        if (t := vals.get("T2M")) is not None:
            sums[year]["T2M"] += t
            sums[year]["T2M_n"] += 1
        if (p := vals.get("PRECTOTCORR")) is not None:
            sums[year]["PRECTOTCORR"] += p
            sums[year]["PRECTOTCORR_n"] += 1
        if (h := vals.get("RH2M")) is not None:
            sums[year]["RH2M"] += h
            sums[year]["RH2M_n"] += 1

    years = []
    for year in sorted(sums.keys()):
        rec = sums[year]
        years.append(
            {
                "year": year,
                "average_temperature_c": rec["T2M"] / rec["T2M_n"] if rec["T2M_n"] else None,
                "average_precip_mm": rec["PRECTOTCORR"] / rec["PRECTOTCORR_n"] if rec["PRECTOTCORR_n"] else None,
                "average_humidity_percent": rec["RH2M"] / rec["RH2M_n"] if rec["RH2M_n"] else None,
            }
        )
    return years


def count_firms_recent_fires(lon_min: float, lat_min: float, lon_max: float, lat_max: float, days: int = 30, token: Optional[str] = None) -> Dict:
    """Count recent fires in bbox over last `days` using NASA FIRMS area API (CSV).
    Requires an API token in `token` or env FIRMS_API_KEY.
    """
    token = token or os.getenv("FIRMS_API_KEY")
    if not token:
        raise ValueError("FIRMS_API_KEY is required for FIRMS API")

    base = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
    bbox = f"{lon_min},{lat_min},{lon_max},{lat_max}"
    headers = {"User-Agent": USER_AGENT}
    products = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT"]
    per_source: Dict[str, int] = {}
    total = 0
    for product in products:
        url = f"{base}/{token}/{product}/{days}/{bbox}"
        r = requests.get(url, headers=headers, timeout=60)
        if r.status_code == 401:
            raise PermissionError("Unauthorized to FIRMS API; check FIRMS_API_KEY")
        r.raise_for_status()
        text = r.text.strip()
        # CSV header + rows; count data rows
        lines = [ln for ln in text.splitlines() if ln.strip()]
        count = max(0, len(lines) - 1) if lines else 0
        per_source[product] = count
        total += count
    return {"days": days, "total": total, "by_source": per_source}


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
