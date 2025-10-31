import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, requiresApproval } from "../SafetyConfig.js";
import { generateDryRunPreview, generateApprovalRequiredMessage, logOperation } from "../ApprovalHelper.js";

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
    },
    required: ["tableName", "whereClause"],
  } as any;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    try {
      const { tableName, whereClause } = params;

      // Basic validation: ensure whereClause is not empty
      if (!whereClause || whereClause.trim() === '') {
        throw new Error("WHERE clause is required for security reasons");
      }

      const query = `DELETE FROM ${tableName} WHERE ${whereClause}`;

      // Check if approval is required
      if (requiresApproval('DELETE', this.safetyConfig)) {
        const message = generateApprovalRequiredMessage('DELETE', tableName, query);
        return {
          success: false,
          message,
          requiresApproval: true
        };
      }

      // Handle dry-run mode
      if (this.safetyConfig.enableDryRun) {
        const preview = generateDryRunPreview('DELETE', tableName, query,
          `This will permanently delete rows matching:\nWHERE ${whereClause}`);

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
          success: true,
          message: preview,
          dryRun: true
        };
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
        success: false,
        message: `Failed to delete data: ${error}`,
      };
    }
  }
}
