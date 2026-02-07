/**
 * MCP Elicitation helper for interactive user confirmation of destructive operations.
 *
 * Uses the MCP elicitation protocol (elicitation/create) to ask the user
 * for approval before executing destructive database operations.
 * Falls back gracefully to token-based confirmation when elicitation is
 * not supported by the client.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationSeverity, getOperationSeverity } from "./SafetyConfig.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The response shape tools will work with. */
export interface ElicitationResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

/** Function signature for the elicitation wrapper passed to tools. */
export type ElicitFn = (params: ElicitRequest["params"]) => Promise<ElicitationResponse>;

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

function getSeverityIcon(severity: OperationSeverity): string {
  switch (severity) {
    case OperationSeverity.CRITICAL: return "\u{1F534}"; // red circle
    case OperationSeverity.HIGH:     return "\u{1F7E0}"; // orange circle
    case OperationSeverity.MEDIUM:   return "\u{1F7E1}"; // yellow circle
    case OperationSeverity.LOW:      return "\u{1F7E2}"; // green circle
    default:                         return "\u26A0\uFE0F";  // warning
  }
}

function getSeverityLabel(severity: OperationSeverity): string {
  switch (severity) {
    case OperationSeverity.CRITICAL: return "CRITICAL";
    case OperationSeverity.HIGH:     return "HIGH";
    case OperationSeverity.MEDIUM:   return "MEDIUM";
    case OperationSeverity.LOW:      return "LOW";
    default:                         return "UNKNOWN";
  }
}

// ---------------------------------------------------------------------------
// Elicitation request builder
// ---------------------------------------------------------------------------

/**
 * Build an elicitation request for confirming a destructive database operation.
 *
 * The request presents the operation details and asks the user to approve
 * via a boolean checkbox.
 */
export function buildConfirmationElicitation(
  operationType: string,
  target: string,
  query: string,
  severity: OperationSeverity,
  estimatedImpact?: string
): ElicitRequest["params"] {
  const icon = getSeverityIcon(severity);
  const label = getSeverityLabel(severity);

  let message = `${icon} ${label} DATABASE OPERATION — Approval Required\n`;
  message += `${"=".repeat(55)}\n\n`;
  message += `Operation: ${operationType}\n`;
  message += `Target:    ${target}\n\n`;
  message += `SQL:\n${query}\n`;

  if (estimatedImpact) {
    message += `\nEstimated Impact:\n${estimatedImpact}\n`;
  }

  message += `\n${"=".repeat(55)}\n`;
  message += `Check "approve" to execute this operation, or decline to cancel.`;

  return {
    message,
    requestedSchema: {
      type: "object" as const,
      properties: {
        approve: {
          type: "boolean" as const,
          title: `Approve ${operationType} on ${target}`,
          description: `Check to confirm execution of this ${label.toLowerCase()}-severity operation.`,
          default: false,
        },
      },
      required: ["approve"],
    } as ElicitRequest["params"]["requestedSchema"],
  };
}

// ---------------------------------------------------------------------------
// Elicit function factory
// ---------------------------------------------------------------------------

/**
 * Create an `ElicitFn` wrapper around the MCP Server's `elicitInput` method.
 *
 * Returns `undefined` if the connected client does not advertise
 * elicitation support, allowing callers to fall through to token flow.
 */
export function createElicitFn(server: Server): ElicitFn | undefined {
  const caps = server.getClientCapabilities();

  if (!caps?.elicitation) {
    console.error("MCP client does not support elicitation — using token fallback.");
    return undefined;
  }

  console.error("MCP client supports elicitation — interactive confirmation enabled.");

  return async (params: ElicitRequest["params"]): Promise<ElicitationResponse> => {
    const result: ElicitResult = await server.elicitInput(params);

    return {
      action: result.action as ElicitationResponse["action"],
      content: result.content as Record<string, unknown> | undefined,
    };
  };
}
