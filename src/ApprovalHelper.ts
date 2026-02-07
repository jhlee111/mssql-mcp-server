/**
 * Safety helper for database operations with dry-run and logging
 */

import { SafetyConfig, getOperationSeverity, OperationSeverity } from './SafetyConfig.js';
import * as fs from 'fs';
import * as path from 'path';

export interface OperationLog {
  timestamp: string;
  operationType: 'DROP' | 'CREATE' | 'UPDATE' | 'DELETE' | 'INSERT' | 'EXEC';
  target: string;
  query: string;
  severity: OperationSeverity;
  dryRun: boolean;
  success: boolean;
  error?: string;
}

/**
 * Log a database operation to the audit log
 */
export function logOperation(log: OperationLog): void {
  const logDir = process.env.OPERATION_LOG_DIR || './logs';
  const logFile = path.join(logDir, 'operations.log');

  try {
    // Create log directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logEntry = JSON.stringify(log) + '\n';
    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error('Failed to write operation log:', error);
  }
}

/**
 * Get an icon representing the severity level
 */
function getSeverityIcon(severity: OperationSeverity): string {
  switch (severity) {
    case OperationSeverity.CRITICAL:
      return '🔴';
    case OperationSeverity.HIGH:
      return '🟠';
    case OperationSeverity.MEDIUM:
      return '🟡';
    case OperationSeverity.LOW:
      return '🟢';
    case OperationSeverity.SAFE:
      return '✅';
    default:
      return '⚠️';
  }
}

/**
 * Generate a dry-run preview for an operation.
 *
 * When `confirmToken` is provided the preview tells the caller to re-invoke
 * the same tool with that token instead of suggesting an env-var change.
 */
export function generateDryRunPreview(
  operationType: 'DROP' | 'CREATE' | 'UPDATE' | 'DELETE' | 'INSERT' | 'EXEC',
  target: string,
  query: string,
  estimatedImpact?: string,
  confirmToken?: string
): string {
  const severity = getOperationSeverity(operationType);
  const icon = getSeverityIcon(severity);

  let preview = `${icon} DRY RUN PREVIEW - ${severity} OPERATION\n`;
  preview += `${'='.repeat(60)}\n\n`;
  preview += `Operation Type: ${operationType}\n`;
  preview += `Target: ${target}\n\n`;
  preview += `SQL Query:\n${query}\n\n`;

  if (estimatedImpact) {
    preview += `Estimated Impact:\n${estimatedImpact}\n\n`;
  }

  preview += `${'='.repeat(60)}\n`;
  preview += `⚠️  This is a DRY RUN. No changes have been made to the database.\n`;

  if (confirmToken) {
    preview += `To execute this operation, call the same tool again with "confirmToken": "${confirmToken}"\n`;
  } else {
    preview += `To execute this operation, set ENABLE_DRY_RUN=false\n`;
  }

  return preview;
}

/**
 * Generate a message for forbidden DROP operations
 */
export function generateDropForbiddenMessage(
  target: string,
  query: string
): string {
  const icon = '🔴';

  let message = `${icon} DANGEROUS OPERATION FORBIDDEN\n`;
  message += `${'='.repeat(60)}\n\n`;
  message += `DROP operations are FORBIDDEN by default for safety.\n\n`;
  message += `Operation Type: DROP\n`;
  message += `Target: ${target}\n\n`;
  message += `SQL Query:\n${query}\n\n`;
  message += `${'='.repeat(60)}\n`;
  message += `⚠️  DROP operations permanently delete tables/indexes.\n\n`;
  message += `To enable DROP operations:\n`;
  message += `1. Set ALLOW_DANGEROUS_OPERATIONS=true in your configuration\n`;
  message += `2. Use ENABLE_DRY_RUN=true to preview DROP operations before executing\n\n`;
  message += `⛔ WARNING: Enabling dangerous operations can lead to permanent data loss!\n`;

  return message;
}

/**
 * Generate an approval requirement message for blocked operations
 */
export function generateApprovalRequiredMessage(
  operationType: 'CREATE' | 'UPDATE' | 'DELETE' | 'INSERT' | 'EXEC',
  target: string,
  query: string
): string {
  const severity = getOperationSeverity(operationType);
  const icon = getSeverityIcon(severity);

  let message = `${icon} APPROVAL REQUIRED - ${severity} OPERATION\n`;
  message += `${'='.repeat(60)}\n\n`;
  message += `This ${operationType} operation requires explicit approval.\n\n`;
  message += `Operation Type: ${operationType}\n`;
  message += `Target: ${target}\n\n`;
  message += `SQL Query:\n${query}\n\n`;
  message += `${'='.repeat(60)}\n`;
  message += `To allow this operation, update your environment variables:\n\n`;

  switch (operationType) {
    case 'CREATE':
      message += `Set REQUIRE_APPROVAL_CREATE=false (currently set to true)\n`;
      break;
    case 'UPDATE':
      message += `Set REQUIRE_APPROVAL_UPDATE=false (currently set to true)\n`;
      break;
    case 'DELETE':
      message += `Set REQUIRE_APPROVAL_DELETE=false (currently set to true)\n`;
      break;
    case 'INSERT':
      message += `Set REQUIRE_APPROVAL_INSERT=false (currently set to true)\n`;
      break;
    case 'EXEC':
      message += `Set ALLOW_EXEC_PROCEDURE=true to enable stored procedure execution\n`;
      break;
  }

  message += `\n⚠️  WARNING: Disabling approval checks may lead to unintended data loss.\n`;

  return message;
}
