import {
  getUaAgentDefinitionBySurface,
  type UaAgentSurfaceId,
} from '../../../runtime/uaAgentDefinitions';
import UaDashboardCanvas from './real-dashboard/UaDashboardCanvas';

export default function UaAgentPanelHost({
  surfaceId,
}: {
  surfaceId: UaAgentSurfaceId;
}) {
  const agent = getUaAgentDefinitionBySurface(surfaceId);
  if (!agent) return null;

  return (
    <UaDashboardCanvas
      lens={agent.uiLens}
      title={agent.name}
    />
  );
}
