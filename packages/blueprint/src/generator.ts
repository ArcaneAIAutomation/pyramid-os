/**
 * BlueprintGenerator — generates Blueprint objects for pyramids and districts.
 *
 * Implements:
 *   - generatePyramid  (Requirements 4.4, 4.5, 20.1)
 *   - generateHousing  (Requirements 4.6, 23.1)
 *   - generateFarm     (Requirements 4.6, 23.2)
 *   - generateTemple   (Requirements 4.6, 23.3)
 */

import { randomUUID } from 'node:crypto';
import type {
  Blueprint,
  BlockPlacement,
  Dimensions,
  FarmParams,
  HousingParams,
  PyramidParams,
  ResourceRequirement,
  TempleParams,
  Vec3,
} from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count block types and return ResourceRequirement array. */
function countResources(placements: BlockPlacement[]): ResourceRequirement[] {
  const counts = new Map<string, number>();
  for (const p of placements) {
    counts.set(p.blockType, (counts.get(p.blockType) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
}

/** Compute the bounding-box Dimensions from a list of placements. */
function computeDimensions(placements: BlockPlacement[], origin: Vec3): Dimensions {
  if (placements.length === 0) {
    return { width: 0, height: 0, depth: 0 };
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
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    depth: maxZ - minZ + 1,
  };
}

/** Build the common Blueprint shell from placements and params. */
function buildBlueprint(
  name: string,
  type: Blueprint['type'],
  placements: BlockPlacement[],
  origin: Vec3,
): Blueprint {
  const dimensions = computeDimensions(placements, origin);
  const requiredResources = countResources(placements);
  const estimatedTimeMinutes = Math.ceil(placements.length / 60);
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    name,
    version: 1,
    type,
    dimensions,
    metadata: {
      structureName: name,
      dimensions,
      requiredResources,
      estimatedTimeMinutes,
      createdAt: now,
      createdBy: 'system',
    },
    placements,
    progress: {
      totalBlocks: placements.length,
      placedBlocks: 0,
      percentComplete: 0,
      currentPhase: 'not_started',
    },
  };
}

// ---------------------------------------------------------------------------
// BlueprintGenerator
// ---------------------------------------------------------------------------

export class BlueprintGenerator {
  /**
   * Generate a pyramid blueprint using the layer-inset algorithm.
   *
   * For each layer y from 0 to height-1:
   *   inset = floor(y * baseSize / (2 * height))
   *   For x from inset to (baseSize - inset - 1):
   *     For z from inset to (baseSize - inset - 1):
   *       if y == height - 1: place capMaterial
   *       else: place material
   */
  generatePyramid(params: PyramidParams): Blueprint {
    const { baseSize, height, material, capMaterial, origin } = params;
    const placements: BlockPlacement[] = [];
    let index = 0;

    for (let y = 0; y < height; y++) {
      const inset = Math.floor((y * baseSize) / (2 * height));
      const blockType = y === height - 1 ? capMaterial : material;

      for (let x = inset; x <= baseSize - inset - 1; x++) {
        for (let z = inset; z <= baseSize - inset - 1; z++) {
          placements.push({
            index: index++,
            position: { x: origin.x + x, y: origin.y + y, z: origin.z + z },
            blockType,
            placed: false,
          });
        }
      }
    }

    return buildBlueprint(
      `Pyramid ${baseSize}x${height}`,
      'pyramid',
      placements,
      origin,
    );
  }

  /**
   * Generate a housing district blueprint.
   *
   * Lays out `units` houses in a row, each `unitWidth x unitHeight x unitDepth`,
   * with a 1-block gap between units. Each unit has a floor, four walls, and a
   * flat roof.
   */
  generateHousing(params: HousingParams): Blueprint {
    const { units, unitWidth, unitDepth, unitHeight, material, origin } = params;
    const placements: BlockPlacement[] = [];
    let index = 0;

    for (let u = 0; u < units; u++) {
      // Each unit is offset by (unitWidth + 1) blocks along X
      const ox = origin.x + u * (unitWidth + 1);
      const oy = origin.y;
      const oz = origin.z;

      for (let x = 0; x < unitWidth; x++) {
        for (let z = 0; z < unitDepth; z++) {
          for (let y = 0; y < unitHeight; y++) {
            const isFloor = y === 0;
            const isRoof = y === unitHeight - 1;
            const isWall =
              x === 0 || x === unitWidth - 1 || z === 0 || z === unitDepth - 1;

            if (isFloor || isRoof || isWall) {
              placements.push({
                index: index++,
                position: { x: ox + x, y: oy + y, z: oz + z },
                blockType: material,
                placed: false,
              });
            }
          }
        }
      }
    }

    return buildBlueprint(
      `Housing District (${units} units)`,
      'housing',
      placements,
      origin,
    );
  }

  /**
   * Generate a farm blueprint.
   *
   * Creates a `rows x columns` grid of farmland blocks with water channels
   * every 4 blocks along the X axis. Alternates between farmland and water.
   */
  generateFarm(params: FarmParams): Blueprint {
    const { rows, columns, origin } = params;
    const placements: BlockPlacement[] = [];
    let index = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        // Water channel every 4 blocks (col index 4, 9, 14, …)
        const isWaterChannel = (col + 1) % 5 === 0;
        const blockType = isWaterChannel
          ? 'minecraft:water'
          : 'minecraft:farmland';

        placements.push({
          index: index++,
          position: { x: origin.x + col, y: origin.y, z: origin.z + row },
          blockType,
          placed: false,
        });
      }
    }

    return buildBlueprint(
      `Farm (${rows}x${columns})`,
      'farm',
      placements,
      origin,
    );
  }

  /**
   * Generate a temple blueprint.
   *
   * Rectangular structure `width x depth x height` with:
   *   - Hollow walls (only perimeter blocks per layer)
   *   - Columns at the four corners (solid through all layers)
   *   - A flat roof on the top layer
   */
  generateTemple(params: TempleParams): Blueprint {
    const { width, depth, height, material, origin } = params;
    const placements: BlockPlacement[] = [];
    let index = 0;

    for (let y = 0; y < height; y++) {
      const isRoof = y === height - 1;

      for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
          const isCorner =
            (x === 0 || x === width - 1) && (z === 0 || z === depth - 1);
          const isWall =
            x === 0 || x === width - 1 || z === 0 || z === depth - 1;

          if (isRoof || isCorner || isWall) {
            placements.push({
              index: index++,
              position: { x: origin.x + x, y: origin.y + y, z: origin.z + z },
              blockType: material,
              placed: false,
            });
          }
        }
      }
    }

    return buildBlueprint(
      `Temple ${width}x${depth}x${height}`,
      'temple',
      placements,
      origin,
    );
  }
}
