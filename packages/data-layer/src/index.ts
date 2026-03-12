export { DatabaseManager } from './database.js';
export type { IntegrityReport } from './database.js';
export { migration001 } from './migrations/001_initial_schema.js';
export type { Migration } from './migrations/001_initial_schema.js';

// Retry utility
export { withRetry } from './retry.js';

// Repositories
export { AgentRepository } from './repositories/AgentRepository.js';
export { TaskRepository } from './repositories/TaskRepository.js';
export { ResourceRepository } from './repositories/ResourceRepository.js';
export { ZoneRepository } from './repositories/ZoneRepository.js';
export type { Zone } from './repositories/ZoneRepository.js';
export { BlueprintRepository } from './repositories/BlueprintRepository.js';
export { BotRepository } from './repositories/BotRepository.js';
export type { BotRecord } from './repositories/BotRepository.js';

// Civilization
export { CivilizationManager } from './civilization.js';
export type { Civilization } from './civilization.js';

// Snapshot
export { SnapshotManager } from './snapshot.js';
export type { SnapshotValidationResult } from './snapshot.js';

// Connection Pool
export { ConnectionPool, POOL_CONFIGS } from './pool.js';
export type { PoolConfig, ConnectionFactory, PoolStats } from './pool.js';

// Seeds
export type {
  SeedScenario,
  CivilizationSeed,
  AgentSeed,
  BlueprintSeed,
  ResourceSeed,
  ZoneSeed,
  TaskSeed,
} from './seeds/index.js';

export {
  SEED_SCENARIOS,
  emptyScenario,
  basicScenario,
  midBuildScenario,
  lowResourcesScenario,
  fullSocietyScenario,
  failureModeScenario,
  loadSeed,
  getScenario,
  listScenarios,
} from './seeds/index.js';
