"""Weather-file calendar and astronomical sun positions for the model viewport."""
# Entity: Building Geometry
# Relationship: Derives the sun display from the selected OSM weather file and simulation calendar; does not create simulated outputs.

import calendar
import csv
import hashlib
import math
from datetime import date
from pathlib import Path

import openstudio


def weather_view(model, selected_date=None):
    weather = model.weatherFile()
    if not weather.is_initialized() or not weather.get().path().is_initialized():
        return None
    path = Path(str(weather.get().path().get()))
    epw = openstudio.EpwFile(str(path))
    year = model.getYearDescription().calendarYear()
    if not year.is_initialized():
        return None  # Do not invent a calendar for an unspecified model.
    year = year.get()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.reader(stream))[8:]
    dates = sorted({f"{year:04d}-{int(row[1]):02d}-{int(row[2]):02d}" for row in rows if len(row) > 4})
    result = dict(file=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), city=epw.city(),
                  latitude=epw.latitude(), longitude=epw.longitude(), timeZone=epw.timeZone(), dates=dates)
    if selected_date is None:
        return result
    if selected_date not in dates:
        raise ValueError("This date is not present in the model's weather file")
    selected = date.fromisoformat(selected_date)
    day = selected.timetuple().tm_yday
    latitude = math.radians(epw.latitude())
    points = []
    # NOAA's published fractional-year equations include longitude, standard-time
    # offset and equation of time: gml.noaa.gov/grad/solcalc/solareqns.PDF.
    for row in rows:
        if int(row[1]) != selected.month or int(row[2]) != selected.day:
            continue
        hour = int(row[3])
        gamma = 2 * math.pi / (366 if calendar.isleap(year) else 365) * (day - 1 + (hour - 12) / 24)
        eq = 229.18 * (.000075 + .001868 * math.cos(gamma) - .032077 * math.sin(gamma)
                       - .014615 * math.cos(2 * gamma) - .040849 * math.sin(2 * gamma))
        decl = (.006918 - .399912 * math.cos(gamma) + .070257 * math.sin(gamma)
                - .006758 * math.cos(2 * gamma) + .000907 * math.sin(2 * gamma)
                - .002697 * math.cos(3 * gamma) + .00148 * math.sin(3 * gamma))
        angle = math.radians((hour * 60 + eq + 4 * epw.longitude() - 60 * epw.timeZone()) / 4 - 180)
        x = -math.cos(decl) * math.sin(angle)
        y = math.cos(latitude) * math.sin(decl) - math.sin(latitude) * math.cos(decl) * math.cos(angle)
        z = math.sin(latitude) * math.sin(decl) + math.cos(latitude) * math.cos(decl) * math.cos(angle)
        points.append(dict(hour=hour, x=x, y=y, z=z, aboveHorizon=z > 0))
    return {**result, "date": selected_date, "points": points}
