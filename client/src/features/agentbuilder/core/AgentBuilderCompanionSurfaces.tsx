import type { ComponentProps } from 'react';

import KnowledgeGraphFramework from '../../../components/knowledge/KnowledgeGraphFramework';
import WorldSignalsSurface from '../../../components/worldsignals/WorldSignalsSurface';
import WorldViewSurface from '../../worldview/WorldViewSurface';
import TradingUI from '../../../pages/tradingui';
import CompanionSurfaceHost from './CompanionSurfaceHost';

export default function AgentBuilderCompanionSurfaces({
  workspaceView,
  knowledgeGraphProps,
  tradingProps,
  worldSignalsProps,
  worldViewProps,
}: {
  workspaceView: string;
  knowledgeGraphProps: ComponentProps<typeof KnowledgeGraphFramework>;
  tradingProps: ComponentProps<typeof TradingUI>;
  worldSignalsProps: ComponentProps<typeof WorldSignalsSurface>;
  worldViewProps: ComponentProps<typeof WorldViewSurface>;
}) {
  const knowledgeGraphSurface = (
    <div style={{ height: '100%' }}>
      <KnowledgeGraphFramework {...knowledgeGraphProps} />
    </div>
  );

  return (
    <CompanionSurfaceHost
      workspaceView={workspaceView}
      knowledgeSurface={knowledgeGraphSurface}
      tradingSurface={<TradingUI {...tradingProps} />}
      worldSignalsSurface={<WorldSignalsSurface {...worldSignalsProps} />}
      worldViewSurface={<WorldViewSurface {...worldViewProps} />}
    />
  );
}
