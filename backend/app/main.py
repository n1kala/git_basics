from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .services import (
    fetch_nasa_power_monthly,
    geocode_query,
    compute_business_suitability,
    fetch_power_monthly_requests,
    aggregate_yearly_averages,
    count_firms_recent_fires,
    project_trend_to,
)

app = FastAPI(title="EcoShield API", version="1.0.0")

# CORS - during development allow all; tighten for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/geocode")
async def geocode(q: str = Query(..., description="Place name or address to geocode")):
    try:
        lat, lon, display = await geocode_query(q)
        return {"lat": lat, "lon": lon, "label": display}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/climate/history")
async def climate_history(
    lat: float = Query(...),
    lon: float = Query(...),
    start: Optional[str] = Query(None, description="YYYY-MM (optional)"),
    end: Optional[str] = Query(None, description="YYYY-MM (optional)"),
):
    def parse_ym(s: Optional[str]):
        if not s:
            return None
        try:
            return dt.datetime.strptime(s, "%Y-%m").date().replace(day=1)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM")

    s_date = parse_ym(start)
    e_date = parse_ym(end)

    try:
        data = await fetch_nasa_power_monthly(lat=lat, lon=lon, start=s_date, end=e_date)
        series = data["series"]
        score = compute_business_suitability(series)
        return {
            "location": {"lat": lat, "lon": lon},
            "period": {
                "start": start or (series[0]["date"] if series else None),
                "end": end or (series[-1]["date"] if series else None),
            },
            "series": series,
            "suitability_score": score,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch climate data: {e}")


@app.get("/api/climate")
def climate_yearly(
    lat: float = Query(...),
    lon: float = Query(...),
    start_year: int = Query(..., ge=1981, le=2100),
    end_year: int = Query(..., ge=1981, le=2100),
):
    try:
        monthly = fetch_power_monthly_requests(lat=lat, lon=lon, start_year=start_year, end_year=end_year)
        years = aggregate_yearly_averages(monthly)
        target = max(end_year, 2035)
        proj_temp = project_trend_to(years, key="average_temperature_c", target_year=target)
        proj_precip = project_trend_to(years, key="average_precip_mm", target_year=target)
        return {
            "location": {"lat": lat, "lon": lon},
            "years": years,
            "projections": {
                "temperature_c": proj_temp,
                "precip_mm": proj_precip,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch yearly climate: {e}")


@app.get("/api/fires")
def fires_count(
    lat_min: float = Query(...),
    lon_min: float = Query(...),
    lat_max: float = Query(...),
    lon_max: float = Query(...),
    days: int = Query(30, ge=1, le=60),
):
    try:
        result = count_firms_recent_fires(lon_min=lon_min, lat_min=lat_min, lon_max=lon_max, lat_max=lat_max, days=days)
        return {"bbox": {"lat_min": lat_min, "lon_min": lon_min, "lat_max": lat_max, "lon_max": lon_max}, **result}
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch fires: {e}")
