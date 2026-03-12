/**
 * BlueprintSerializer — JSON serialization and deserialization for Blueprint objects.
 *
 * Implements stable key ordering so that serialize(deserialize(serialize(bp))) is
 * always identical to serialize(bp) (round-trip property, Requirement 4.10).
 */

import type {
  Blueprint,
  BlockPlacement,
  BlueprintMetadata,
  BlueprintProgress,
  Dimensions,
  Vec3,
} from '@pyramid-os/shared-types';

/** Valid blueprint structure types */
const VALID_TYPES = new Set(['pyramid', 'housing', 'farm', 'temple', 'custom']);

/**
 * Replacer function for JSON.stringify that sorts object keys alphabetically
 * at every level, producing deterministic output regardless of insertion order.
 */
function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/** Throw a descriptive error when a required field is missing or invalid. */
function assertField(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Blueprint deserialization failed: ${message}`);
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function isPositiveNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0;
}

function validateVec3(v: unknown, path: string): asserts v is Vec3 {
  assertField(
    v !== null && typeof v === 'object' && !Array.isArray(v),
    `${path} must be an object`,
  );
  const obj = v as Record<string, unknown>;
  assertField(isFiniteNumber(obj['x']), `${path}.x must be a finite number`);
  assertField(isFiniteNumber(obj['y']), `${path}.y must be a finite number`);
  assertField(isFiniteNumber(obj['z']), `${path}.z must be a finite number`);
}

function validateDimensions(v: unknown, path: string): asserts v is Dimensions {
  assertField(
    v !== null && typeof v === 'object' && !Array.isArray(v),
    `${path} must be an object`,
  );
  const obj = v as Record<string, unknown>;
  assertField(isFiniteNumber(obj['width']), `${path}.width must be a finite number`);
  assertField(isFiniteNumber(obj['height']), `${path}.height must be a finite number`);
  assertField(isFiniteNumber(obj['depth']), `${path}.depth must be a finite number`);
}

function validateMetadata(v: unknown): asserts v is BlueprintMetadata {
  assertField(
    v !== null && typeof v === 'object' && !Array.isArray(v),
    'metadata must be an object',
  );
  const obj = v as Record<string, unknown>;
  assertField(isNonEmptyString(obj['structureName']), 'metadata.structureName must be a non-empty string');
  validateDimensions(obj['dimensions'], 'metadata.dimensions');
  assertField(Array.isArray(obj['requiredResources']), 'metadata.requiredResources must be an array');
  assertField(isFiniteNumber(obj['estimatedTimeMinutes']), 'metadata.estimatedTimeMinutes must be a finite number');
  assertField(isNonEmptyString(obj['createdAt']), 'metadata.createdAt must be a non-empty string');
  assertField(isNonEmptyString(obj['createdBy']), 'metadata.createdBy must be a non-empty string');
}

function validateProgress(v: unknown): asserts v is BlueprintProgress {
  assertField(
    v !== null && typeof v === 'object' && !Array.isArray(v),
    'progress must be an object',
  );
  const obj = v as Record<string, unknown>;
  assertField(isFiniteNumber(obj['totalBlocks']), 'progress.totalBlocks must be a finite number');
  assertField(isFiniteNumber(obj['placedBlocks']), 'progress.placedBlocks must be a finite number');
  assertField(isFiniteNumber(obj['percentComplete']), 'progress.percentComplete must be a finite number');
  assertField(isNonEmptyString(obj['currentPhase']), 'progress.currentPhase must be a non-empty string');
}

function validatePlacement(v: unknown, idx: number): asserts v is BlockPlacement {
  assertField(
    v !== null && typeof v === 'object' && !Array.isArray(v),
    `placements[${idx}] must be an object`,
  );
  const obj = v as Record<string, unknown>;
  assertField(isFiniteNumber(obj['index']), `placements[${idx}].index must be a finite number`);
  validateVec3(obj['position'], `placements[${idx}].position`);
  assertField(isNonEmptyString(obj['blockType']), `placements[${idx}].blockType must be a non-empty string`);
  assertField(typeof obj['placed'] === 'boolean', `placements[${idx}].placed must be a boolean`);
}

/**
 * Validates the structural shape of a parsed Blueprint object.
 * Throws a descriptive error if any field is missing or has the wrong type.
 */
function validateBlueprint(obj: Record<string, unknown>): Blueprint {
  assertField(isNonEmptyString(obj['id']), 'id must be a non-empty string');
  assertField(isNonEmptyString(obj['name']), 'name must be a non-empty string');
  assertField(isPositiveNumber(obj['version']), 'version must be a positive number');
  assertField(
    isNonEmptyString(obj['type']) && VALID_TYPES.has(obj['type'] as string),
    `type must be one of: ${[...VALID_TYPES].join(', ')}`,
  );
  validateDimensions(obj['dimensions'], 'dimensions');
  validateMetadata(obj['metadata']);
  assertField(Array.isArray(obj['placements']), 'placements must be an array');
  (obj['placements'] as unknown[]).forEach((p, i) => validatePlacement(p, i));
  validateProgress(obj['progress']);
  // All assertions passed — safe to cast
  return obj as unknown as Blueprint;
}

/**
 * Serializes and deserializes Blueprint objects to/from JSON.
 *
 * Key guarantee: `deserialize(serialize(blueprint))` produces a structurally
 * equivalent Blueprint for any valid blueprint (round-trip property).
 */
export class BlueprintSerializer {
  /**
   * Serialize a Blueprint to a JSON string with stable (alphabetically sorted)
   * key ordering at every level. This ensures that two blueprints with the same
   * data always produce identical strings regardless of object key insertion order.
   */
  serialize(blueprint: Blueprint): string {
    return JSON.stringify(blueprint, stableReplacer);
  }

  /**
   * Deserialize a JSON string to a Blueprint.
   * Throws if the JSON is syntactically invalid or the structure does not match
   * the Blueprint shape.
   */
  deserialize(json: string): Blueprint {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new Error(`Blueprint deserialization failed: invalid JSON — ${(err as Error).message}`);
    }

    assertField(
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      'root value must be an object',
    );

    const obj = parsed as Record<string, unknown>;
    return validateBlueprint(obj);
  }

  /**
   * Returns true if the given JSON string is syntactically valid and structurally
   * matches the Blueprint shape; false otherwise.
   */
  validateJson(json: string): boolean {
    try {
      this.deserialize(json);
      return true;
    } catch {
      return false;
    }
  }
}
