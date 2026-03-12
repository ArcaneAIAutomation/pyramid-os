/**
 * Blueprint types for PYRAMID OS
 * Defines construction plans for structures
 */

import type { ResourceRequirement } from './resource.js';

/** A 3D coordinate in Minecraft world space */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A single block to be placed at a specific position */
export interface BlockPlacement {
  /** Execution order index — blocks are placed in ascending index order */
  index: number;
  /** World coordinates for the block */
  position: Vec3;
  /** Minecraft block ID (e.g. 'minecraft:sandstone') */
  blockType: string;
  /** Whether this block has been placed in-game */
  placed: boolean;
}

/** Physical dimensions of a structure */
export interface Dimensions {
  width: number;
  height: number;
  depth: number;
}

/** Metadata describing a blueprint's properties and requirements */
export interface BlueprintMetadata {
  structureName: string;
  dimensions: Dimensions;
  requiredResources: ResourceRequirement[];
  estimatedTimeMinutes: number;
  createdAt: string;
  /** ID of the Architect agent that created this blueprint */
  createdBy: string;
}

/** Tracks construction progress for a blueprint */
export interface BlueprintProgress {
  totalBlocks: number;
  placedBlocks: number;
  percentComplete: number;
  currentPhase: string;
}

/** A complete machine-readable construction plan */
export interface Blueprint {
  id: string;
  name: string;
  version: number;
  type: 'pyramid' | 'housing' | 'farm' | 'temple' | 'custom';
  dimensions: Dimensions;
  metadata: BlueprintMetadata;
  placements: BlockPlacement[];
  progress: BlueprintProgress;
}

/** Parameters for generating a pyramid blueprint */
export interface PyramidParams {
  /** Base edge length in blocks */
  baseSize: number;
  /** Pyramid height in blocks */
  height: number;
  /** Primary block type (e.g. 'minecraft:sandstone') */
  material: string;
  /** Capstone block type (e.g. 'minecraft:gold_block') */
  capMaterial: string;
  /** World origin position */
  origin: Vec3;
}

/** Parameters for generating a housing district blueprint */
export interface HousingParams {
  units: number;
  unitWidth: number;
  unitDepth: number;
  unitHeight: number;
  material: string;
  origin: Vec3;
}

/** Parameters for generating a farm blueprint */
export interface FarmParams {
  rows: number;
  columns: number;
  cropType: string;
  origin: Vec3;
}

/** Parameters for generating a temple blueprint */
export interface TempleParams {
  width: number;
  depth: number;
  height: number;
  material: string;
  origin: Vec3;
}

/** Result of blueprint validation */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  resourceRequirements: ResourceRequirement[];
}

/** A validation error found in a blueprint */
export interface ValidationError {
  code: string;
  message: string;
  placementIndex?: number;
}

/** A non-fatal validation warning for a blueprint */
export interface ValidationWarning {
  code: string;
  message: string;
  placementIndex?: number;
}

/** Report of conflicts between blueprints */
export interface ConflictReport {
  conflictingBlueprintId: string;
  overlappingPositions: Vec3[];
}
