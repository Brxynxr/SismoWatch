"""
Unit Tests: Data Transformation & Feature Engineering
Tests GeoJSON parsing, region extraction, magnitude classification, and impact radius.
"""
import pytest
from include.transform import (
    extract_region_from_place,
    classify_magnitude,
    calculate_impact_radius,
    compute_payload_hash,
    parse_geojson_feature
)

def test_extract_region_from_place():
    assert extract_region_from_place("13 km N of Borrego Springs, CA") == "California"
    assert extract_region_from_place("11 km S of Empire, Nevada") == "Nevada"
    assert extract_region_from_place("75 km W of Hualien City, Taiwan") == "Taiwan"
    assert extract_region_from_place("near the coast of Central Chile") == "Chile"
    assert extract_region_from_place("off the coast of Oregon") == "Oregon"
    assert extract_region_from_place(None) == "Desconocida"
    assert extract_region_from_place("") == "Desconocida"

def test_classify_magnitude():
    assert classify_magnitude(1.2) == "Micro"
    assert classify_magnitude(3.5) == "Minor"
    assert classify_magnitude(4.7) == "Light"
    assert classify_magnitude(5.8) == "Moderate"
    assert classify_magnitude(6.5) == "Strong"
    assert classify_magnitude(7.3) == "Major"
    assert classify_magnitude(8.5) == "Great"
    assert classify_magnitude(None) == "Unknown"

def test_calculate_impact_radius():
    r_small = calculate_impact_radius(2.0, depth_km=5.0)
    r_med = calculate_impact_radius(5.0, depth_km=10.0)
    r_large = calculate_impact_radius(7.5, depth_km=15.0)

    assert r_small > 0
    assert r_med > r_small
    assert r_large > r_med
    assert round(r_med) > 20.0  # M 5.0 typically gives ~28 km radius

    # Test edge case: null or negative magnitude returns 1.0
    assert calculate_impact_radius(None) == 1.0
    assert calculate_impact_radius(-1.0) == 1.0

def test_compute_payload_hash_determinism():
    payload_a = {"id": "us123", "mag": 4.5, "place": "Alaska"}
    payload_b = {"place": "Alaska", "mag": 4.5, "id": "us123"}
    payload_c = {"id": "us123", "mag": 4.6, "place": "Alaska"}

    hash_a = compute_payload_hash(payload_a)
    hash_b = compute_payload_hash(payload_b)
    hash_c = compute_payload_hash(payload_c)

    # Key order must not affect the hash
    assert hash_a == hash_b
    # Different payload must produce different hash
    assert hash_a != hash_c

def test_parse_geojson_feature():
    sample_feature = {
        "type": "Feature",
        "id": "us7000test",
        "properties": {
            "mag": 5.4,
            "place": "20 km S of Coquimbo, Chile",
            "time": 1700000000000,
            "updated": 1700000500000,
            "tsunami": 1,
            "sig": 450,
            "magType": "mww",
            "status": "reviewed",
            "type": "earthquake",
            "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test"
        },
        "geometry": {
            "type": "Point",
            "coordinates": [-71.34, -30.12, 25.5]
        }
    }

    parsed = parse_geojson_feature(sample_feature)
    assert parsed["event_id"] == "us7000test"
    assert parsed["magnitude"] == 5.4
    assert parsed["magnitude_class"] == "Moderate"
    assert parsed["region"] == "Chile"
    assert parsed["longitude"] == -71.34
    assert parsed["latitude"] == -30.12
    assert parsed["depth_km"] == 25.5
    assert parsed["tsunami_alert"] is True
    assert parsed["impact_radius_km"] > 10.0
    assert parsed["event_time"] is not None
