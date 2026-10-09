import { useCallback, useState } from 'react';

import type {
  WorldSignalsInspectorBridge,
  WorldSignalsInspectorSection,
  WorldSignalsLayerState,
} from '../../../components/worldsignals/WorldSignalsSurface';
import type { WorldSignalsDrawerSection } from '../../../components/worldsignals/WorldSignalsInspectorPanel';
import type { GodsEyeBridge } from '../../../components/worldsignals/GodsEyeSurface';

export default function useAgentBuilderInspectorBridges() {
  const [worldViewInspectorHost, setWorldViewInspectorHost] = useState<HTMLDivElement | null>(null);
  const [worldViewInspectorOpen, setWorldViewInspectorOpen] = useState(true);
  const [worldSignalsInspectorSection, setWorldSignalsInspectorSection] = useState<
    WorldSignalsDrawerSection | null
  >(null);
  const [worldSignalsInspectorOpen, setWorldSignalsInspectorOpen] = useState(false);
  const [worldSignalsLayerState, setWorldSignalsLayerState] =
    useState<WorldSignalsLayerState | null>(null);
  const [worldSignalsBridge, setWorldSignalsBridge] =
    useState<WorldSignalsInspectorBridge | null>(null);
  const [worldViewBridge, setWorldViewBridge] = useState<GodsEyeBridge | null>(null);

  const handleWorldSignalsInspectorRequest = useCallback(
    (section: WorldSignalsInspectorSection) => {
      if (section === 'markets' || section === 'layers') {
        setWorldSignalsInspectorSection(section);
        setWorldSignalsInspectorOpen(true);
      }
    },
    [],
  );
  const closeWorldSignalsInspector = useCallback(() => {
    setWorldSignalsInspectorOpen(false);
  }, []);

  return {
    closeWorldSignalsInspector,
    handleWorldSignalsInspectorRequest,
    setWorldSignalsBridge,
    setWorldSignalsInspectorOpen,
    setWorldSignalsInspectorSection,
    setWorldSignalsLayerState,
    setWorldViewBridge,
    setWorldViewInspectorHost,
    setWorldViewInspectorOpen,
    worldSignalsBridge,
    worldSignalsInspectorOpen,
    worldSignalsInspectorSection,
    worldSignalsLayerState,
    worldViewBridge,
    worldViewInspectorHost,
    worldViewInspectorOpen,
  };
}
