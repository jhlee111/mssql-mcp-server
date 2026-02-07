/**
 * Safety configuration for destructive database operations
 *
 * This module defines which operations require user approval
 * and provides dry-run functionality for previewing changes.
 *
 * Permission Levels:
 * 1. DROP operations are FORBIDDEN by default (require ALLOW_DANGEROUS_OPERATIONS=true)
 * 2. Even with dangerous mode, DROP operations always require confirmation/dry-run preview
 * 3. Other operations (CREATE, UPDATE, INSERT, DELETE) can optionally require approval
 */

export interface SafetyConfig {
  /** Allow dangerous operations like DROP (default: false - FORBIDDEN) */
  allowDangerousOperations: boolean;

  /** Require approval for CREATE operations (tables, indexes) */
  requireApprovalForCreate: boolean;

  /** Require approval for UPDATE operations */
  requireApprovalForUpdate: boolean;

  /** Require approval for DELETE operations (removing rows) */
  requireApprovalForDelete: boolean;

  /** Require approval for INSERT operations */
  requireApprovalForInsert: boolean;

  /** Allow stored procedure execution (default: false - DISABLED) */
  allowExecProcedure: boolean;

  /** Enable dry-run mode to preview operations without executing */
  enableDryRun: boolean;

  /** TTL in seconds for dry-run confirmation tokens (default: 300 = 5 minutes) */
  dryRunTtlSeconds?: number;
}

/**
 * Parse safety configuration from environment variables
 */
export function loadSafetyConfig(): SafetyConfig {
  return {
    // DROP operations require explicit dangerous mode flag
    allowDangerousOperations: process.env.ALLOW_DANGEROUS_OPERATIONS === 'true', // Default: false (FORBIDDEN)

    // Other operations default to allowed but can be restricted
    requireApprovalForCreate: process.env.REQUIRE_APPROVAL_CREATE === 'true', // Default: false
    requireApprovalForUpdate: process.env.REQUIRE_APPROVAL_UPDATE === 'true', // Default: false
    requireApprovalForDelete: process.env.REQUIRE_APPROVAL_DELETE === 'true', // Default: false
    requireApprovalForInsert: process.env.REQUIRE_APPROVAL_INSERT === 'true', // Default: false

    // Stored procedure execution requires explicit opt-in
    allowExecProcedure: process.env.ALLOW_EXEC_PROCEDURE === 'true', // Default: false

    // Dry-run mode for previewing operations
    enableDryRun: process.env.ENABLE_DRY_RUN === 'true', // Default: false

    // TTL for dry-run confirmation tokens (seconds)
    dryRunTtlSeconds: process.env.DRY_RUN_TTL_SECONDS
      ? parseInt(process.env.DRY_RUN_TTL_SECONDS, 10)
      : undefined,
  };
}

/**
 * Operation severity levels for categorizing database operations
 */
export enum OperationSeverity {
  /** Operations that destroy data (DROP) */
  CRITICAL = 'CRITICAL',

  /** Operations that modify schema (CREATE, ALTER) */
  HIGH = 'HIGH',

  /** Operations that modify data (UPDATE, DELETE) */
  MEDIUM = 'MEDIUM',

  /** Operations that add data (INSERT) */
  LOW = 'LOW',

  /** Operations that only read data (SELECT) */
  SAFE = 'SAFE',
}

/**
 * Check if a DROP operation is allowed
 * DROP operations are special - they're forbidden unless explicitly enabled
 */
export function isDropAllowed(config: SafetyConfig): boolean {
  return config.allowDangerousOperations;
}

/**
 * Determine if an operation requires approval based on its type
 * Note: DROP operations are handled separately by isDropAllowed()
 */
export function requiresApproval(
  operationType: 'CREATE' | 'UPDATE' | 'DELETE' | 'INSERT' | 'READ' | 'EXEC',
  config: SafetyConfig
): boolean {
  switch (operationType) {
    case 'CREATE':
      return config.requireApprovalForCreate;
    case 'UPDATE':
      return config.requireApprovalForUpdate;
    case 'DELETE':
      return config.requireApprovalForDelete;
    case 'INSERT':
      return config.requireApprovalForInsert;
    case 'READ':
      return false;
    case 'EXEC':
      return false; // Exec is gated by allowExecProcedure; no separate approval needed
    default:
      return true; // Default to requiring approval for unknown operations
  }
}

/**
 * Get the severity level for an operation type
 */
export function getOperationSeverity(
  operationType: 'DROP' | 'CREATE' | 'UPDATE' | 'DELETE' | 'INSERT' | 'READ' | 'EXEC'
): OperationSeverity {
  switch (operationType) {
    case 'DROP':
      return OperationSeverity.CRITICAL;
    case 'DELETE':
      return OperationSeverity.HIGH;
    case 'CREATE':
      return OperationSeverity.HIGH;
    case 'UPDATE':
      return OperationSeverity.MEDIUM;
    case 'EXEC':
      return OperationSeverity.MEDIUM;
    case 'INSERT':
      return OperationSeverity.LOW;
    case 'READ':
      return OperationSeverity.SAFE;
    default:
      return OperationSeverity.CRITICAL; // Unknown operations are treated as critical
  }
}
