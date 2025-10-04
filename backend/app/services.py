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


# --------------------
# Climate stability scoring
# --------------------

def calculate_stability_score(data: Dict) -> int:
    """Calculate a 0-100 climate Stability Score using simple linear regression.

    Input formats supported:
    - {'years': [{ 'year': 2006, 'average_temperature_c': 21.3, 'average_precip_mm': 76.4 }, ...]}
    - {'series': [{ 'date': 'YYYY-MM', 'temperature_c': 21.3, 'precip_mm': 80.1 }, ...]}

    Method:
    - Take last up-to-20 years of data
    - Compute linear regression slope per year for temperature and precipitation
    - Convert slopes to penalties via soft thresholds
      * Temperature thresholds: |slope| <= 0.02°C/yr (no penalty), >= 0.05°C/yr (max)
      * Precipitation uses relative slope (fraction per year):
        - drying (negative) penalized with thresholds: |rel| <= 0.01/yr (no penalty), >= 0.03/yr (max)
        - wetting (positive) penalized at half strength
    - Score = 100 * (1 - (0.6 * temp_penalty + 0.4 * precip_penalty))
    """
    years_records: List[Dict] = []

    if isinstance(data, dict) and "years" in data and isinstance(data["years"], list):
        years_records = [r for r in data["years"] if isinstance(r, dict) and "year" in r]
    elif isinstance(data, dict) and "series" in data and isinstance(data["series"], list):
        # Aggregate monthly series to yearly averages
        by_year: Dict[int, Dict[str, float]] = {}
        counts: Dict[int, Dict[str, int]] = {}
        for row in data["series"]:
            try:
                date = str(row.get("date"))
                y = int(date[:4])
            except Exception:
                continue
            by_year.setdefault(y, {"t": 0.0, "p": 0.0})
            counts.setdefault(y, {"t": 0, "p": 0})
            t = row.get("temperature_c")
            if isinstance(t, (int, float)):
                by_year[y]["t"] += float(t)
                counts[y]["t"] += 1
            p = row.get("precip_mm")
            if isinstance(p, (int, float)):
                by_year[y]["p"] += float(p)
                counts[y]["p"] += 1
        for y in sorted(by_year.keys()):
            t_avg = (by_year[y]["t"] / counts[y]["t"]) if counts[y]["t"] else None
            p_avg = (by_year[y]["p"] / counts[y]["p"]) if counts[y]["p"] else None
            years_records.append({
                "year": y,
                "average_temperature_c": t_avg,
                "average_precip_mm": p_avg,
            })
    else:
        return 0

    # Keep last 20 years with any usable data
    years_records = sorted(years_records, key=lambda r: r["year"]) [-20:]
    if not years_records:
        return 0

    # Build regression inputs per metric
    def build_series(key: str) -> List[Tuple[float, float]]:
        pts: List[Tuple[float, float]] = []
        for idx, rec in enumerate(years_records):
            val = rec.get(key)
            if isinstance(val, (int, float)):
                pts.append((float(idx), float(val)))
        return pts

    temp_pts = build_series("average_temperature_c")
    precip_pts = build_series("average_precip_mm")

    temp_slope = _linear_regression_slope(temp_pts)
    precip_slope = _linear_regression_slope(precip_pts)

    # Convert precip slope to relative per-year slope using mean level
    def mean_of(pts: List[Tuple[float, float]]) -> Optional[float]:
        return sum(y for _, y in pts) / len(pts) if pts else None

    precip_mean = mean_of(precip_pts) or 0.0
    rel_precip_slope = (precip_slope / precip_mean) if precip_mean > 0 else 0.0

    # Temperature penalty: piecewise from 0 at 0.02 to 1 at 0.05 degC/yr
    def piecewise_penalty(x: float, lo: float, hi: float) -> float:
        ax = abs(x)
        if ax <= lo:
            return 0.0
        if ax >= hi:
            return 1.0
        return (ax - lo) / (hi - lo)

    temp_penalty = piecewise_penalty(temp_slope, lo=0.02, hi=0.05)

    # Precipitation penalty: drying heavier than wetting
    # relative slope thresholds per year: 1% (no penalty) to 3% (max)
    drying_pen = piecewise_penalty(min(0.0, rel_precip_slope), lo=0.01, hi=0.03)  # min(0, rel) gives negative or zero
    # For wetting, penalize at half strength
    wetting_pen = 0.5 * piecewise_penalty(max(0.0, rel_precip_slope), lo=0.01, hi=0.03)
    precip_penalty = max(drying_pen, wetting_pen)

    overall_penalty = 0.6 * temp_penalty + 0.4 * precip_penalty
    score = int(round(100 * max(0.0, 1.0 - overall_penalty)))
    return max(0, min(100, score))


def _linear_regression_slope(points: List[Tuple[float, float]]) -> float:
    """Return slope of simple linear regression y ~ a + b*x for given points.
    If insufficient variance or <2 points, return 0.0.
    """
    n = len(points)
    if n < 2:
        return 0.0
    sum_x = sum(p[0] for p in points)
    sum_y = sum(p[1] for p in points)
    mean_x = sum_x / n
    mean_y = sum_y / n

    ss_xx = sum((x - mean_x) ** 2 for x, _ in points)
    if ss_xx == 0:
        return 0.0
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in points)
    return ss_xy / ss_xx


def _linear_regression(points: List[Tuple[float, float]]) -> Tuple[float, float]:
    """Return (slope, intercept) for y ~ a + b*x. If <2 points or no variance, returns (0, mean_y)."""
    n = len(points)
    if n < 2:
        mean_y = sum((y for _, y in points), 0.0) / n if n else 0.0
        return 0.0, mean_y
    sum_x = sum(p[0] for p in points)
    sum_y = sum(p[1] for p in points)
    mean_x = sum_x / n
    mean_y = sum_y / n
    ss_xx = sum((x - mean_x) ** 2 for x, _ in points)
    if ss_xx == 0:
        return 0.0, mean_y
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in points)
    slope = ss_xy / ss_xx
    intercept = mean_y - slope * mean_x
    return slope, intercept


def project_trend_to(years: List[Dict], key: str, target_year: int) -> List[Dict[str, float]]:
    """Project linear trend for the given key up to target_year.
    years: list of {'year': int, key: float | None}
    Returns list of {'year': int, 'value': float} for years > last_actual_year up to target_year.
    """
    pts: List[Tuple[float, float]] = []
    last_year = None
    for rec in sorted(years, key=lambda r: r["year"]):
        y = rec.get("year")
        v = rec.get(key)
        if isinstance(y, int):
            last_year = y
        if isinstance(y, int) and isinstance(v, (int, float)):
            pts.append((float(y), float(v)))
    if last_year is None or target_year <= last_year:
        return []
    slope, intercept = _linear_regression(pts)
    out: List[Dict[str, float]] = []
    for yr in range(last_year + 1, target_year + 1):
        val = intercept + slope * yr
        if key in ("average_precip_mm", "average_humidity_percent"):
            val = max(0.0, val)
        out.append({"year": yr, "value": float(val)})
    return out
