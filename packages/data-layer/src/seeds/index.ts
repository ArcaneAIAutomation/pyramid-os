/**
 * Seed data system — barrel export.
 * Requirements: 44.2, 44.5
 */

export type {
  SeedScenario,
  CivilizationSeed,
  AgentSeed,
  BlueprintSeed,
  ResourceSeed,
  ZoneSeed,
  TaskSeed,
} from './scenarios.js';

export {
  SEED_SCENARIOS,
  emptyScenario,
  basicScenario,
  midBuildScenario,
  lowResourcesScenario,
  fullSocietyScenario,
  failureModeScenario,
} from './scenarios.js';

export { loadSeed, getScenario, listScenarios } from './loader.js';
