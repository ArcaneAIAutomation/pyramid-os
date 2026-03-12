/**
 * @pyramid-os/blueprint
 * Blueprint system — data model, serialization, and re-exports from shared-types.
 */

// Re-export Blueprint types from shared-types
export type {
  Blueprint,
  BlockPlacement,
  BlueprintMetadata,
  BlueprintProgress,
  Dimensions,
  Vec3,
  PyramidParams,
  HousingParams,
  FarmParams,
  TempleParams,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ConflictReport,
} from '@pyramid-os/shared-types';

// Serializer
export { BlueprintSerializer } from './serializer.js';

// Generator
export { BlueprintGenerator } from './generator.js';

// Validator
export { BlueprintValidator } from './validator.js';

// Progress Tracker
export { ProgressTracker } from './progress-tracker.js';
