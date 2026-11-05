/**
 * Entity: Saved Cards
 * Relationship: Binds saved Card/profile identities to Hermes runtime snapshots for the Card glow, active-model count, and Runtime inspector.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  subscribeHermesRuntime,
  type HermesRuntimeSnapshot,
} from './hermesRuntimeClient';

type CardRuntimeIdentity = { cardId: string; profile: string };

export default function useHermesCardRuntime(
  identities: CardRuntimeIdentity[],
): Record<string, HermesRuntimeSnapshot> {
  const normalized = useMemo(() => identities
    .map((identity) => ({
      cardId: String(identity.cardId || '').trim(),
      profile: String(identity.profile || '').trim().toLowerCase(),
    }))
    .filter((identity) => identity.cardId && identity.profile)
    .sort((left, right) => `${left.profile}\u0000${left.cardId}`.localeCompare(
      `${right.profile}\u0000${right.cardId}`,
    )), [identities]);
  const identityKey = normalized
    .map((identity) => `${identity.profile}\u0000${identity.cardId}`)
    .join('\u0001');
  const [snapshots, setSnapshots] = useState<Record<string, HermesRuntimeSnapshot>>({});

  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    const cardsByProfile = new Map<string, string[]>();
    for (const identity of normalized) {
      const cardIds = cardsByProfile.get(identity.profile) || [];
      cardIds.push(identity.cardId);
      cardsByProfile.set(identity.profile, cardIds);
    }
    setSnapshots((current) => Object.fromEntries(
      normalized.flatMap((identity) => current[identity.cardId]
        ? [[identity.cardId, current[identity.cardId]]]
        : []),
    ));
    for (const [profile, cardIds] of cardsByProfile) {
      void subscribeHermesRuntime(profile, (snapshot) => {
        if (disposed) return;
        setSnapshots((current) => ({
          ...current,
          ...Object.fromEntries(cardIds.map((cardId) => [cardId, snapshot])),
        }));
      }).then((stop) => {
        if (disposed) stop();
        else stops.push(stop);
      });
    }
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, [identityKey]);

  return snapshots;
}
