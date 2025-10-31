import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, isDropAllowed } from "../SafetyConfig.js";
import { generateDryRunPreview, generateDropForbiddenMessage, logOperation } from "../ApprovalHelper.js";
import { getServerCapabilities } from "../index.js";

export class DropTableTool implements Tool {
  [key: string]: any;
  name = "drop_table";
  description = "Drops a table from the MSSQL Database. WARNING: This is a destructive operation that will permanently delete the table and all its data. Supports 'IF EXISTS' syntax on SQL Server 2016+ to gracefully handle non-existent tables.";
  inputSchema = {
    type: "object",
    properties: {
      tableName: { type: "string", description: "Name of the table to drop" },
      ifExists: {
        type: "boolean",
        description: "If true, use DROP TABLE IF EXISTS (SQL Server 2016+). Ignored on older versions.",
        default: false
      }
    },
    required: ["tableName"],
  } as any;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    try {
      const { tableName, ifExists } = params;

      // Basic validation to prevent SQL injection
      // Allow: letters, numbers, underscores, dots (for schema), brackets (for quoted identifiers)
      // Example valid names: "MyTable", "dbo.MyTable", "[My Table]", "schema.table"
      if (!/^[\w\d_.\[\]]+$/.test(tableName)) {
        throw new Error("Invalid table name. Table names can only contain letters, numbers, underscores, dots, and brackets.");
      }

      // Check server capabilities for IF EXISTS support
      const capabilities = getServerCapabilities();
      const useIfExists = ifExists && capabilities?.supportsDropIfExists;

      // Build query based on server version
      let query: string;
      let versionWarning: string | undefined;

      if (useIfExists) {
        query = `DROP TABLE IF EXISTS [${tableName}]`;
      } else {
        query = `DROP TABLE [${tableName}]`;
        if (ifExists && !capabilities?.supportsDropIfExists) {
          versionWarning = `Note: IF EXISTS syntax requested but not supported on ${capabilities?.version.productName || 'this SQL Server version'}. Using standard DROP TABLE instead.`;
        }
      }

      // Check if DROP operations are allowed at all
      if (!isDropAllowed(this.safetyConfig)) {
        const message = generateDropForbiddenMessage(tableName, query);
        return {
          success: false,
          message,
          forbidden: true
        };
      }

      // Even with dangerous mode enabled, always show dry-run preview for DROP
      // or respect the global dry-run setting
      if (this.safetyConfig.enableDryRun) {
        const preview = generateDryRunPreview('DROP', tableName, query,
          'This will permanently delete the table and all its data.');

        logOperation({
          timestamp: startTime,
          operationType: 'DROP',
          target: tableName,
          query,
          severity: 'CRITICAL' as any,
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
      await new sql.Request().query(query);

      // Log successful operation
      logOperation({
        timestamp: startTime,
        operationType: 'DROP',
        target: tableName,
        query,
        severity: 'CRITICAL' as any,
        dryRun: false,
        success: true
      });

      return {
        success: true,
        message: `Table '${tableName}' dropped successfully.${versionWarning ? '\n' + versionWarning : ''}`
      };
    } catch (error) {
      console.error("Error dropping table:", error);

      // Log failed operation
      logOperation({
        timestamp: startTime,
        operationType: 'DROP',
        target: params.tableName || 'unknown',
        query: `DROP TABLE [${params.tableName}]`,
        severity: 'CRITICAL' as any,
        dryRun: false,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        message: `Failed to drop table: ${error}`
      };
    }
  }
}