import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, requiresApproval, getOperationSeverity } from "../SafetyConfig.js";
import { generateDryRunPreview, generateApprovalRequiredMessage, logOperation } from "../ApprovalHelper.js";
import { confirmationStore } from "../ConfirmationStore.js";
import { ElicitFn, buildConfirmationElicitation } from "../ElicitationHelper.js";

export class UpdateDataTool implements Tool {
  [key: string]: any;
  name = "update_data";
  description = "Updates data in an MSSQL Database table using a WHERE clause. The WHERE clause must be provided for security.";
  inputSchema = {
    type: "object",
    properties: {
      tableName: {
        type: "string",
        description: "Name of the table to update"
      },
      updates: {
        type: "object",
        description: "Key-value pairs of columns to update. Example: { 'status': 'active', 'last_updated': '2025-01-01' }",
      },
      whereClause: {
        type: "string",
        description: "WHERE clause to identify which records to update. Example: \"genre = 'comedy' AND created_date <= '2025-07-05'\""
      },
      confirmToken: {
        type: "string",
        description: "Optional confirmation token from a dry-run preview. Provide this to execute a previously previewed operation."
      },
    },
    required: ["tableName", "updates", "whereClause"],
  } as any;

  /** Optional MCP elicitation function — set after server connects if client supports it. */
  elicit?: ElicitFn;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    let query: string | undefined;
    try {
      const { tableName, updates, whereClause, confirmToken } = params;
      const originalParams = { tableName, updates, whereClause };

      // Basic validation: ensure whereClause is not empty
      if (!whereClause || whereClause.trim() === '') {
        throw new Error("WHERE clause is required for security reasons");
      }

      const request = new sql.Request();

      // Build SET clause with parameterized queries for security
      const setClause = Object.keys(updates)
        .map((key, index) => {
          const paramName = `update_${index}`;
          request.input(paramName, updates[key]);
          return `[${key}] = @${paramName}`;
        })
        .join(", ");

      query = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;

      // Check if approval is required
      if (requiresApproval('UPDATE', this.safetyConfig)) {
        const message = generateApprovalRequiredMessage('UPDATE', tableName, query);
        return {
          mode: "approval_required",
          success: false,
          message,
          requiresApproval: true
        };
      }

      // Handle dry-run mode
      if (this.safetyConfig.enableDryRun) {
        // Estimate row count for impact message
        let rowEstimate: string;
        try {
          const countResult = await new sql.Request().query(`SELECT COUNT(*) as cnt FROM ${tableName} WHERE ${whereClause}`);
          rowEstimate = `Estimated rows affected: ${countResult.recordset[0].cnt}`;
        } catch { rowEstimate = 'Could not estimate row count'; }
        const updatesList = Object.entries(updates).map(([key, val]) => `  - ${key} = ${val}`).join('\n');
        const impact = `This will update the following columns:\n${updatesList}\n\nWHERE: ${whereClause}\n\n${rowEstimate}`;

        if (confirmToken) {
          // Priority 1: Token-based confirmation (Phase 1)
          const validation = confirmationStore.validate(confirmToken, query, originalParams);
          if (!validation.valid) {
            return { mode: "confirmation_failed", success: false, message: `Confirmation failed: ${validation.reason}` };
          }
          // Token valid — fall through to execution below
        } else if (this.elicit) {
          // Priority 2: Elicitation-based confirmation (Phase 2)
          try {
            const severity = getOperationSeverity('UPDATE');
            const elicitParams = buildConfirmationElicitation('UPDATE', tableName, query, severity, impact);
            const response = await this.elicit(elicitParams);
            if (response.action === 'accept' && response.content?.approve) {
              // User approved — fall through to execution below
            } else {
              return { mode: "preview", success: true, message: generateDryRunPreview('UPDATE', tableName, query, impact) + '\nOperation declined by user.', dryRun: true };
            }
          } catch {
            console.error('Elicitation failed for UPDATE, falling back to token flow.');
            const token = confirmationStore.create('UPDATE', tableName, query, originalParams);
            const preview = generateDryRunPreview('UPDATE', tableName, query, impact);
            logOperation({ timestamp: startTime, operationType: 'UPDATE', target: tableName, query, severity: 'MEDIUM' as any, dryRun: true, success: true });
            return { mode: "preview", success: true, message: preview, dryRun: true, confirmToken: token };
          }
        } else {
          // Priority 3: Token preview (fallback)
          const token = confirmationStore.create('UPDATE', tableName, query, originalParams);
          const preview = generateDryRunPreview('UPDATE', tableName, query, impact);

          logOperation({
            timestamp: startTime,
            operationType: 'UPDATE',
            target: tableName,
            query,
            severity: 'MEDIUM' as any,
            dryRun: true,
            success: true
          });

          return {
            mode: "preview",
            success: true,
            message: preview,
            dryRun: true,
            confirmToken: token
          };
        }
      }

      // Execute the operation
      const result = await request.query(query);

      // Log successful operation
      logOperation({
        timestamp: startTime,
        operationType: 'UPDATE',
        target: tableName,
        query,
        severity: 'MEDIUM' as any,
        dryRun: false,
        success: true
      });

      return {
        mode: "executed",
        success: true,
        message: `Update completed successfully. ${result.rowsAffected[0]} row(s) affected`,
        rowsAffected: result.rowsAffected[0],
      };
    } catch (error) {
      console.error("Error updating data:", error);

      // Log failed operation
      logOperation({
        timestamp: startTime,
        operationType: 'UPDATE',
        target: params.tableName || 'unknown',
        query: query || `UPDATE ${params.tableName}`,
        severity: 'MEDIUM' as any,
        dryRun: false,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        mode: "error",
        success: false,
        message: `Failed to update data ${query ? ` with '${query}'` : ''}: ${error}`,
      };
    }
  }
}
