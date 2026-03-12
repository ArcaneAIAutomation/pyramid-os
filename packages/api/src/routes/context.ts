/**
 * Service context type injected into route handlers.
 * All fields are optional — routes return stubs when services are not wired.
 */

import type { OpenClaw } from '@pyramid-os/orchestration';
import type { SocietyEngine } from '@pyramid-os/society-engine';
import type {
  SnapshotManager,
  CivilizationManager,
  AgentRepository,
  TaskRepository,
  ResourceRepository,
  BlueprintRepository,
} from '@pyramid-os/data-layer';

export interface ServiceContext {
  openclaw?: OpenClaw;
  societyEngine?: SocietyEngine;
  snapshotManager?: SnapshotManager;
  civilizationManager?: CivilizationManager;
  agentRepository?: AgentRepository;
  taskRepository?: TaskRepository;
  resourceRepository?: ResourceRepository;
  blueprintRepository?: BlueprintRepository;
}
