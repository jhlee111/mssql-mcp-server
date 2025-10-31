import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, requiresApproval } from "../SafetyConfig.js";
import { generateDryRunPreview, generateApprovalRequiredMessage, logOperation } from "../ApprovalHelper.js";

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
    },
    required: ["tableName", "updates", "whereClause"],
  } as any;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    let query: string | undefined;
    try {
      const { tableName, updates, whereClause } = params;

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
          success: false,
          message,
          requiresApproval: true
        };
      }

      // Handle dry-run mode
      if (this.safetyConfig.enableDryRun) {
        const updatesList = Object.entries(updates).map(([key, val]) => `  - ${key} = ${val}`).join('\n');
        const preview = generateDryRunPreview('UPDATE', tableName, query,
          `This will update the following columns:\n${updatesList}\n\nWHERE: ${whereClause}`);

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
          success: true,
          message: preview,
          dryRun: true
        };
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
        success: false,
        message: `Failed to update data ${query ? ` with '${query}'` : ''}: ${error}`,
      };
    }
  }
}
