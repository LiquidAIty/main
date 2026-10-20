// Entity: Building Navigation
// Relationship: This compact display tree follows the active OpenStudio object's existing parent handles; it never changes model relationships.
import { useEffect, useMemo, useRef } from 'react';
import { objectLabel, type ModelObject } from './contracts';

type Entry = {
  key: string;
  label: string;
  object?: ModelObject;
  children: Entry[];
};

export function buildObjectTree(objects: readonly ModelObject[]): Entry[] {
  const geometry = objects.filter((object) =>
    ['Building', 'BuildingStory', 'Space', 'Surface', 'SubSurface'].includes(object.type));
  const nodes = new Map(geometry.map((object) => [object.handle, {
    key: object.handle,
    label: object.type === 'Building' ? 'Building' : object.name || objectLabel[object.type] || object.type,
    object,
    children: [] as Entry[],
  }]));
  const building = geometry.find((object) => object.type === 'Building');
  const roots: Entry[] = [];
  const parent = (handle: string | null | undefined, type: string) => {
    const entry = handle ? nodes.get(handle) : undefined;
    return entry?.object.type === type ? entry : undefined;
  };
  for (const object of geometry) {
    const entry = nodes.get(object.handle)!;
    let owner: Entry | undefined;
    switch (object.type) {
      case 'Building':
        roots.push(entry);
        continue;
      case 'BuildingStory':
        break;
      case 'Space':
        owner = parent(object.buildingStory, 'BuildingStory');
        break;
      case 'Surface':
        owner = parent(object.space, 'Space');
        break;
      case 'SubSurface':
        owner = parent(object.surface, 'Surface');
        break;
      default:
        continue;
    }
    owner ||= building ? nodes.get(building.handle) : undefined;
    if (owner?.object && object.type !== 'Space' && object.type !== 'BuildingStory') {
      const prefix = owner.object.name + ' ';
      if (entry.label.startsWith(prefix)) entry.label = entry.label.slice(prefix.length);
    }
    (owner?.children || roots).push(entry);
  }
  const sort = (entries: Entry[]) => {
    entries.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    entries.forEach((entry) => sort(entry.children));
  };
  sort(roots);
  return roots;
}

export default function ObjectTree({ objects, selection, onSelect, busy = false }: {
  objects: readonly ModelObject[];
  selection: string | null;
  onSelect: (handle: string) => void;
  busy?: boolean;
}) {
  const tree = useRef<HTMLElement>(null);
  const entries = useMemo(() => buildObjectTree(objects), [objects]);
  useEffect(() => {
    const selected = tree.current?.querySelector('[aria-current="true"]');
    let ancestor = selected?.parentElement;
    while (ancestor && ancestor !== tree.current) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
  }, [selection, entries]);

  const renderEntry = (entry: Entry): React.ReactNode => {
    const label = entry.object ? <button type="button" disabled={busy}
      aria-current={entry.key === selection ? 'true' : undefined}
      title={entry.object.name || entry.label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(entry.object!.handle);
      }}>{entry.label}</button> : <span>{entry.label}</span>;
    return <li key={entry.key}>
      {entry.children.length ? <details
        open={entry.object?.type === 'Building' || entry.object?.type === 'BuildingStory'}>
        <summary>{label}</summary>
        <ul>{entry.children.map(renderEntry)}</ul>
      </details> : <div className="nrgsim-tree-leaf">{label}</div>}
    </li>;
  };
  return <nav className="nrgsim-tree" aria-label="Building hierarchy" ref={tree}>
    <ul>{entries.map(renderEntry)}</ul>
  </nav>;
}
