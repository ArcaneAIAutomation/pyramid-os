/**
 * BlueprintValidator — validates Blueprint objects for completeness and feasibility.
 *
 * Implements:
 *   - Block type format validation (Minecraft ID format: namespace:block)
 *   - Coordinate bounds validation (±30,000,000 Minecraft world border)
 *   - Duplicate position detection
 *   - Dimensions / bounding-box consistency check
 *   - Resource requirement calculation
 *
 * Requirements: 4.3, 35.1, 35.2, 35.3, 35.4, 35.8
 */

import type {
  Blueprint,
  BlockPlacement,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ResourceRequirement,
} from '@pyramid-os/shared-types';

/** Minecraft world border limit (±30 000 000 blocks). */
const WORLD_BORDER = 30_000_000;

/**
 * Minecraft block ID format: `namespace:block`
 * Both namespace and block are lowercase alphanumeric with underscores,
 * periods, and hyphens (e.g. `minecraft:stone`, `minecraft:oak_planks`).
 */
const BLOCK_ID_RE = /^[a-z0-9_.-]+:[a-z0-9_.-]+$/;

export class BlueprintValidator {
  /**
   * Validate a complete blueprint for correctness and feasibility.
   * Returns a {@link ValidationResult} with typed errors and warnings.
   */
  validate(blueprint: Blueprint): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate block types
    errors.push(...this.validateBlockTypes(blueprint.placements));

    // Validate coordinates
    errors.push(...this.validateCoordinates(blueprint.placements));

    // Validate no duplicate positions
    errors.push(...this.validateDuplicatePositions(blueprint.placements));

    // Validate dimensions match bounding box
    errors.push(...this.validateDimensions(blueprint));

    // Warn on empty placements
    if (blueprint.placements.length === 0) {
      warnings.push({
        code: 'EMPTY_PLACEMENTS',
        message: 'Blueprint has no block placements',
      });
    }

    const resourceRequirements = this.calculateResources(blueprint.placements);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      resourceRequirements,
    };
  }

  /**
   * Validate that every block type string is non-empty and follows the
   * Minecraft ID format (`namespace:block`).
   */
  validateBlockTypes(placements: BlockPlacement[]): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const p of placements) {
      if (!p.blockType || typeof p.blockType !== 'string' || p.blockType.length === 0) {
        errors.push({
          code: 'INVALID_BLOCK_TYPE',
          message: `Placement at index ${p.index} has an empty or missing block type`,
          placementIndex: p.index,
        });
      } else if (!BLOCK_ID_RE.test(p.blockType)) {
        errors.push({
          code: 'INVALID_BLOCK_TYPE',
          message: `Placement at index ${p.index} has invalid block type "${p.blockType}" — expected format "namespace:block" (lowercase alphanumeric, underscores, periods, hyphens)`,
          placementIndex: p.index,
        });
      }
    }
    return errors;
  }

  /**
   * Validate that all coordinates are finite numbers within the Minecraft
   * world border (±30,000,000).
   */
  validateCoordinates(placements: BlockPlacement[]): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const p of placements) {
      const { x, y, z } = p.position;
      if (!isFiniteCoord(x) || !isFiniteCoord(y) || !isFiniteCoord(z)) {
        errors.push({
          code: 'INVALID_COORDINATES',
          message: `Placement at index ${p.index} has non-finite coordinates (${x}, ${y}, ${z})`,
          placementIndex: p.index,
        });
      } else if (
        Math.abs(x) > WORLD_BORDER ||
        Math.abs(y) > WORLD_BORDER ||
        Math.abs(z) > WORLD_BORDER
      ) {
        errors.push({
          code: 'COORDINATES_OUT_OF_BOUNDS',
          message: `Placement at index ${p.index} has coordinates (${x}, ${y}, ${z}) outside world border (±${WORLD_BORDER})`,
          placementIndex: p.index,
        });
      }
    }
    return errors;
  }

  /**
   * Detect duplicate `(x, y, z)` positions in placements.
   */
  validateDuplicatePositions(placements: BlockPlacement[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const seen = new Set<string>();
    for (const p of placements) {
      const key = `${p.position.x},${p.position.y},${p.position.z}`;
      if (seen.has(key)) {
        errors.push({
          code: 'DUPLICATE_POSITION',
          message: `Placement at index ${p.index} has duplicate position (${p.position.x}, ${p.position.y}, ${p.position.z})`,
          placementIndex: p.index,
        });
      } else {
        seen.add(key);
      }
    }
    return errors;
  }

  /**
   * Validate that the blueprint's `dimensions` field matches the actual
   * bounding box computed from its placements.
   */
  validateDimensions(blueprint: Blueprint): ValidationError[] {
    const errors: ValidationError[] = [];
    const { placements, dimensions } = blueprint;

    if (placements.length === 0) {
      return errors;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const { position: p } of placements) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const actualWidth = maxX - minX + 1;
    const actualHeight = maxY - minY + 1;
    const actualDepth = maxZ - minZ + 1;

    if (dimensions.width !== actualWidth) {
      errors.push({
        code: 'DIMENSIONS_MISMATCH',
        message: `dimensions.width is ${dimensions.width} but actual bounding box width is ${actualWidth}`,
      });
    }
    if (dimensions.height !== actualHeight) {
      errors.push({
        code: 'DIMENSIONS_MISMATCH',
        message: `dimensions.height is ${dimensions.height} but actual bounding box height is ${actualHeight}`,
      });
    }
    if (dimensions.depth !== actualDepth) {
      errors.push({
        code: 'DIMENSIONS_MISMATCH',
        message: `dimensions.depth is ${dimensions.depth} but actual bounding box depth is ${actualDepth}`,
      });
    }

    return errors;
  }

  /**
   * Calculate total resource requirements from placements by counting
   * each distinct block type.
   */
  calculateResources(placements: BlockPlacement[]): ResourceRequirement[] {
    const counts = new Map<string, number>();
    for (const p of placements) {
      counts.set(p.blockType, (counts.get(p.blockType) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFiniteCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
