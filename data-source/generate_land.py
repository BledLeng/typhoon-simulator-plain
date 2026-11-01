#!/usr/bin/env python3
"""Convert the pinned Natural Earth land archive into compact, global GeoJSON.

Requires Python 3 and pyshp==2.3.1. This is a build-time conversion only;
the website fetches ne_50m_land.geojson without any Python dependency.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
from pathlib import Path
import zipfile

import shapefile


DIRECTORY = Path(__file__).resolve().parent
SOURCE = DIRECTORY / "ne_50m_land.source.zip"
DESTINATION = DIRECTORY.parent / "dist" / "data" / "ne_50m_land.geojson"
SOURCE_SHA256 = "0b8e670cf80dce9cbebe2a193bc44ba5602758c22e1fa603980553646d7ff162"
DECIMAL_PLACES = 5


def ring_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def normalize_polygon(polygon):
    """Keep every original vertex; round coordinates and normalize winding."""
    result = []
    for index, source_ring in enumerate(polygon):
        ring = [[round(float(x), DECIMAL_PLACES), round(float(y), DECIMAL_PLACES)]
                for x, y in source_ring]
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("Invalid source polygon ring")
        for x, y in ring:
            if not (math.isfinite(x) and math.isfinite(y)
                    and -180 <= x <= 180 and -90 <= y <= 90):
                raise ValueError(f"Invalid geographic coordinate: {x}, {y}")
        area = ring_area(ring)
        if area == 0:
            raise ValueError("Coordinate rounding collapsed a source ring")
        # RFC 7946: counter-clockwise exterior, clockwise interior rings.
        if (area > 0) != (index == 0):
            ring.reverse()
        result.append(ring)
    return result


def main():
    source_bytes = SOURCE.read_bytes()
    if hashlib.sha256(source_bytes).hexdigest() != SOURCE_SHA256:
        raise ValueError("Source ZIP differs from the reviewed Natural Earth archive")

    with zipfile.ZipFile(io.BytesIO(source_bytes)) as archive:
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read("ne_50m_land.shp")),
            shx=io.BytesIO(archive.read("ne_50m_land.shx")),
            dbf=io.BytesIO(archive.read("ne_50m_land.dbf")),
        )
        version = archive.read("ne_50m_land.VERSION.txt").decode().strip()
        features = []
        vertex_count = 0
        polygon_count = 0
        for feature_id, source_shape in enumerate(reader.iterShapes()):
            geometry = source_shape.__geo_interface__
            if geometry["type"] == "Polygon":
                polygons = [normalize_polygon(geometry["coordinates"])]
                coordinates = polygons[0]
            elif geometry["type"] == "MultiPolygon":
                polygons = [normalize_polygon(p) for p in geometry["coordinates"]]
                coordinates = polygons
            else:
                raise ValueError(f"Unexpected geometry type: {geometry['type']}")
            polygon_count += len(polygons)
            vertex_count += sum(len(ring) for polygon in polygons for ring in polygon)
            features.append({
                "type": "Feature",
                "id": feature_id,
                "properties": {},
                "geometry": {"type": geometry["type"], "coordinates": coordinates},
            })
        if vertex_count != sum(len(shape.points) for shape in reader.iterShapes()):
            raise ValueError("Conversion changed the number of source vertices")

    document = {
        "type": "FeatureCollection",
        "name": "Natural Earth 1:50m land",
        "source": "https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/",
        "license": "Public domain",
        "sourceVersion": version,
        "features": features,
    }
    DESTINATION.write_text(json.dumps(document, separators=(",", ":")) + "\n")
    print(json.dumps({
        "output": str(DESTINATION),
        "bytes": DESTINATION.stat().st_size,
        "sourceVersion": version,
        "features": len(features),
        "polygons": polygon_count,
        "vertices": vertex_count,
        "sha256": hashlib.sha256(DESTINATION.read_bytes()).hexdigest(),
    }, indent=2))


if __name__ == "__main__":
    main()
