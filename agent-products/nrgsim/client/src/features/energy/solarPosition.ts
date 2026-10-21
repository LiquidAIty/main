export type SolarPositionInput = {
  dayOfYear: number;
  hour: number;
  latitudeDeg: number;
  orientationDeg: number;
  radius: number;
};

export type SolarPosition = {
  x: number;
  y: number;
  z: number;
  altitudeDeg: number;
  azimuthDeg: number;
  sunriseHour: number;
  sunsetHour: number;
  possibleSunshineHours: number;
  aboveHorizon: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function acosClamped(value: number): number {
  return Math.acos(clamp(value, -1, 1));
}

export function calculateSolarPosition({
  dayOfYear,
  hour,
  latitudeDeg,
  orientationDeg,
  radius,
}: SolarPositionInput): SolarPosition {
  const dtr = Math.PI / 180;
  const rtd = 180 / Math.PI;
  const hourAngle = 15 * hour - 180;
  const solarDeclination =
    23.45 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear + 284));
  const sunriseHour =
    (12 / Math.PI) *
    acosClamped(
      Math.tan(latitudeDeg * dtr) * Math.tan(solarDeclination * dtr),
    );
  const sunsetHour =
    (12 / Math.PI) *
    (2 * Math.PI -
      acosClamped(
        Math.tan(latitudeDeg * dtr) * Math.tan(solarDeclination * dtr),
      ));
  const possibleSunshineHours = sunsetHour - sunriseHour;
  const altitudeDeg =
    rtd *
    Math.asin(
      Math.sin(solarDeclination * dtr) * Math.sin(latitudeDeg * dtr) +
        Math.cos(solarDeclination * dtr) *
          Math.cos(latitudeDeg * dtr) *
          Math.cos(hourAngle * dtr),
    );

  const azimuthBase =
    ((Math.sin(altitudeDeg * dtr) * Math.sin(latitudeDeg * dtr) -
      Math.sin(solarDeclination * dtr)) /
      (Math.cos(altitudeDeg * dtr) * Math.cos(latitudeDeg * dtr))) ||
    0;
  const azimuthOffset = rtd * acosClamped(azimuthBase);
  const azimuthDeg =
    hour === 12
      ? 180 - orientationDeg
      : hour < 12
      ? 180 - orientationDeg - azimuthOffset
      : 180 - orientationDeg + azimuthOffset;

  const aboveHorizon = hour > sunriseHour && hour < sunsetHour && altitudeDeg > 0;
  const activeRadius = aboveHorizon ? radius : radius * 0.18;
  const altitudeProjection = Math.cos(altitudeDeg * dtr);

  return {
    x: -activeRadius * altitudeProjection * Math.sin(azimuthDeg * dtr),
    y: -activeRadius * altitudeProjection * Math.cos(azimuthDeg * dtr),
    z: activeRadius * Math.sin(altitudeDeg * dtr),
    altitudeDeg,
    azimuthDeg,
    sunriseHour,
    sunsetHour,
    possibleSunshineHours,
    aboveHorizon,
  };
}
