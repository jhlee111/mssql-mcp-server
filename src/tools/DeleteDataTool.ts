import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, requiresApproval, getOperationSeverity } from "../SafetyConfig.js";
import { generateDryRunPreview, generateApprovalRequiredMessage, logOperation } from "../ApprovalHelper.js";
import { confirmationStore } from "../ConfirmationStore.js";
import { ElicitFn, buildConfirmationElicitation } from "../ElicitationHelper.js";

export class DeleteDataTool implements Tool {
  [key: string]: any;
  name = "delete_data";
  description = "Deletes data from an MSSQL Database table using a WHERE clause. The WHERE clause must be provided for security.";
  inputSchema = {
    type: "object",
    properties: {
      tableName: {
        type: "string",
        description: "Name of the table to delete data from"
      },
      whereClause: {
        type: "string",
        description: "WHERE clause to identify which records to delete. Example: \"status = 'inactive' AND created_date < '2020-01-01'\""
      },
      confirmToken: {
        type: "string",
        description: "Optional confirmation token from a dry-run preview. Provide this to execute a previously previewed operation."
      },
    },
    required: ["tableName", "whereClause"],
  } as any;

  /** Optional MCP elicitation function — set after server connects if client supports it. */
  elicit?: ElicitFn;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    try {
      const { tableName, whereClause, confirmToken } = params;
      const originalParams = { tableName, whereClause };

      // Basic validation: ensure whereClause is not empty
      if (!whereClause || whereClause.trim() === '') {
        throw new Error("WHERE clause is required for security reasons");
      }

      const query = `DELETE FROM ${tableName} WHERE ${whereClause}`;

      // Check if approval is required
      if (requiresApproval('DELETE', this.safetyConfig)) {
        const message = generateApprovalRequiredMessage('DELETE', tableName, query);
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
        const impact = `This will permanently delete rows matching:\nWHERE ${whereClause}\n\n${rowEstimate}`;

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
            const severity = getOperationSeverity('DELETE');
            const elicitParams = buildConfirmationElicitation('DELETE', tableName, query, severity, impact);
            const response = await this.elicit(elicitParams);
            if (response.action === 'accept' && response.content?.approve) {
              // User approved — fall through to execution below
            } else {
              return { mode: "preview", success: true, message: generateDryRunPreview('DELETE', tableName, query, impact) + '\nOperation declined by user.', dryRun: true };
            }
          } catch {
            console.error('Elicitation failed for DELETE, falling back to token flow.');
            const token = confirmationStore.create('DELETE', tableName, query, originalParams);
            const preview = generateDryRunPreview('DELETE', tableName, query, impact);
            logOperation({ timestamp: startTime, operationType: 'DELETE', target: tableName, query, severity: 'HIGH' as any, dryRun: true, success: true });
            return { mode: "preview", success: true, message: preview, dryRun: true, confirmToken: token };
          }
        } else {
          // Priority 3: Token preview (fallback)
          const token = confirmationStore.create('DELETE', tableName, query, originalParams);
          const preview = generateDryRunPreview('DELETE', tableName, query, impact);

          logOperation({
            timestamp: startTime,
            operationType: 'DELETE',
            target: tableName,
            query,
            severity: 'HIGH' as any,
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
      const request = new sql.Request();
      const result = await request.query(query);

      // Log successful operation
      logOperation({
        timestamp: startTime,
        operationType: 'DELETE',
        target: tableName,
        query,
        severity: 'HIGH' as any,
        dryRun: false,
        success: true
      });

      return {
        mode: "executed",
        success: true,
        message: `Delete completed successfully. ${result.rowsAffected[0]} row(s) deleted`,
        rowsAffected: result.rowsAffected[0],
      };
    } catch (error) {
      console.error("Error deleting data:", error);

      // Log failed operation
      logOperation({
        timestamp: startTime,
        operationType: 'DELETE',
        target: params.tableName || 'unknown',
        query: `DELETE FROM ${params.tableName}`,
        severity: 'HIGH' as any,
        dryRun: false,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        mode: "error",
        success: false,
        message: `Failed to delete data: ${error}`,
      };
    }
  }
}
