from fastapi.testclient import TestClient
from .main import app

client = TestClient(app)

def test_healthz():
    r = client.get('/api/healthz')
    assert r.status_code == 200
    assert r.json()['status'] == 'ok'

def test_geocode_roundtrip():
    r = client.get('/api/geocode', params={'q': 'Nairobi'})
    assert r.status_code == 200
    data = r.json()
    assert 'lat' in data and 'lon' in data


def test_climate_history_smoke(monkeypatch):
    # Avoid hitting NASA during tests by monkeypatching service
    from . import services

    async def fake_fetch(lat: float, lon: float, start=None, end=None):
        return {
            'series': [
                {'date': '2020-01', 'temperature_c': 20.0, 'precip_mm': 80.0, 'humidity_percent': 50.0},
                {'date': '2020-02', 'temperature_c': 22.0, 'precip_mm': 60.0, 'humidity_percent': 55.0},
            ]
        }

    monkeypatch.setattr(services, 'fetch_nasa_power_monthly', fake_fetch)

    r = client.get('/api/climate/history', params={'lat': -1.286389, 'lon': 36.817223})
    assert r.status_code == 200
    data = r.json()
    assert 'series' in data and 'suitability_score' in data
