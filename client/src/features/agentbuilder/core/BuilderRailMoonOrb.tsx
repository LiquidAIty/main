// The rail moon orb: real synodic-phase math driving the central
// project/intelligence affordance. Extracted verbatim from
// pages/agentbuilder.tsx (decomposition pass 2026-07-08).
import React from 'react';

export const SYNODIC_MONTH_DAYS = 29.530588861;
/** Reference Julian Date of a known new moon (2000-01-06 18:14 UTC ≈ JD 2451550.09765). */
export const REF_NEW_MOON_JD = 2451550.09765;

export function julianDateUtc(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

/**
 * Synodic phase in [0,1): 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter, 1≡0 new.
 * Waxing for p in (0, 0.5), waning for p in (0.5, 1).
 */
export function synodicPhaseFromDate(d: Date): number {
  const jd = julianDateUtc(d);
  let age = (jd - REF_NEW_MOON_JD) % SYNODIC_MONTH_DAYS;
  if (age < 0) age += SYNODIC_MONTH_DAYS;
  return age / SYNODIC_MONTH_DAYS;
}

/** Illuminated fraction of the lunar disk (0=new … 1=full … 0=new). */
export function moonIllumination(phase01: number): number {
  const p = ((phase01 % 1) + 1) % 1;
  return 0.5 * (1 - Math.cos(2 * Math.PI * p));
}

/**
 * For two unit circles (R=1) whose centers are distance d=2t apart (t in [0,1]),
 * fraction of the left disk covered by the right disk (overlap / π).
 * Monotonic decreasing in t: t=0 → 1, t=1 → 0.
 */
export function overlapFractionTwoUnitCircles(t: number): number {
  const tt = Math.min(1, Math.max(0, t));
  return (
    (2 / Math.PI) * (Math.acos(tt) - tt * Math.sqrt(Math.max(0, 1 - tt * tt)))
  );
}

/** Invert overlap fraction to separation parameter t=d/(2R) for the two-circle terminator model. */
export function separationTFromOverlapFraction(targetOverlap: number): number {
  const g = Math.min(1, Math.max(0, targetOverlap));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const v = overlapFractionTwoUnitCircles(mid);
    if (v > g) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export type BuilderRailMoonOrbProps = {
  /** Synodic phase in [0,1); values outside are wrapped. */
  phase01: number;
};

/**
 * Code-driven lunar terminator: same-radius eclipser circle (true circular arc terminator),
 * waxing lit on the right, waning lit on the left. Overlap geometry inverts
 * illumination k = 0.5*(1-cos(2πp)) via overlap = 1 - k on the lit mask.
 */
export function BuilderRailMoonOrb({
  phase01,
}: BuilderRailMoonOrbProps): React.ReactElement {
  const uid = React.useId().replace(/:/g, '');
  const diskClipId = `moon-disk-${uid}`;
  const litMaskId = `moon-lit-${uid}`;
  const litGradId = `moon-lit-grad-${uid}`;
  const baseGradId = `moon-base-grad-${uid}`;
  const glowFilterId = `moon-glow-${uid}`;

  const p = ((phase01 % 1) + 1) % 1;
  const illumination = moonIllumination(p);
  const targetOverlap = 1 - illumination;
  const t = separationTFromOverlapFraction(targetOverlap);

  const R = 14;
  const cx = 14;
  const cy = 14;
  const waxing = p <= 0.5;
  const sep = 2 * R * t;
  const shadowCx = waxing ? cx - sep : cx + sep;

  const limbGlowOpacity = 0.06 + 0.14 * illumination;
  const purpleRimOpacity = 0.12 + 0.08 * illumination;

  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 28 28"
      role="img"
      aria-label={`Moon phase ${Math.round(illumination * 100)}% illuminated`}
    >
      <defs>
        <radialGradient id={baseGradId} cx="38%" cy="35%" r="72%">
          <stop offset="0%" stopColor="rgba(12,42,52,0.98)" />
          <stop offset="55%" stopColor="rgba(30,89,102,0.96)" />
          <stop offset="100%" stopColor="rgba(6,22,30,0.98)" />
        </radialGradient>
        <radialGradient id={litGradId} cx="32%" cy="30%" r="78%">
          <stop offset="0%" stopColor="rgba(255,252,244,0.98)" />
          <stop offset="42%" stopColor="rgba(255,228,196,0.92)" />
          <stop offset="100%" stopColor="rgba(223,146,84,0.55)" />
        </radialGradient>
        <filter id={glowFilterId} x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.9" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={diskClipId}>
          <circle cx={cx} cy={cy} r={R} />
        </clipPath>
        <mask id={litMaskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="28" height="28" fill="white" />
          <circle cx={shadowCx} cy={cy} r={R} fill="black" />
        </mask>
      </defs>

      <g filter={`url(#${glowFilterId})`}>
        <circle cx={cx} cy={cy} r={R} fill={`url(#${baseGradId})`} />
        <g clipPath={`url(#${diskClipId})`}>
          <circle
            cx={cx}
            cy={cy}
            r={R}
            fill={`url(#${litGradId})`}
            mask={`url(#${litMaskId})`}
          />
        </g>
        <circle
          cx={cx}
          cy={cy}
          r={R - 0.5}
          fill="none"
          stroke={`rgba(125,105,180,${purpleRimOpacity.toFixed(3)})`}
          strokeWidth={0.9}
        />
        <circle
          cx={cx}
          cy={cy}
          r={R - 1.25}
          fill="none"
          stroke={`rgba(79,162,173,${limbGlowOpacity.toFixed(3)})`}
          strokeWidth={1.1}
        />
      </g>
    </svg>
  );
}

// -------- Main page --------

