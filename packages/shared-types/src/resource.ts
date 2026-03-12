/**
 * Resource types for PYRAMID OS
 * Defines materials tracked by the Resource Tracker
 */

/** All trackable material types in the civilization */
export type ResourceType =
  | 'sandstone'
  | 'limestone'
  | 'gold_block'
  | 'wood'
  | 'food'
  | 'tools'
  | 'stone'
  | 'iron';

/** A tracked resource inventory entry */
export interface Resource {
  id: string;
  type: ResourceType;
  quantity: number;
  civilizationId: string;
}

/** Minimum and critical thresholds for a resource type */
export interface ResourceThreshold {
  resourceType: ResourceType;
  minimum: number;
  critical: number;
}

/** Alert raised when a resource falls below its threshold */
export interface ResourceAlert {
  resourceType: ResourceType;
  currentLevel: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

/** A recorded change to a resource's quantity */
export interface ResourceTransaction {
  id: string;
  resourceType: ResourceType;
  delta: number;
  beforeQuantity: number;
  afterQuantity: number;
  reason: string;
  civilizationId: string;
  timestamp: string;
}

/** Filter options for querying resource transactions */
export interface TransactionFilter {
  resourceType?: ResourceType;
  civilizationId?: string;
  since?: string;
  until?: string;
}

/** Predicted resource needs for upcoming build phases */
export interface ResourcePrediction {
  resourceType: ResourceType;
  currentLevel: number;
  predictedConsumption: number;
  shortfall: number;
  phasesAnalyzed: number;
}

/** A required resource quantity for a blueprint or phase */
export interface ResourceRequirement {
  type: string;
  count: number;
}
