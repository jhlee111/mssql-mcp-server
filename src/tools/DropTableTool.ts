import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, isDropAllowed, getOperationSeverity } from "../SafetyConfig.js";
import { generateDryRunPreview, generateDropForbiddenMessage, logOperation } from "../ApprovalHelper.js";
import { getServerCapabilities } from "../index.js";
import { confirmationStore } from "../ConfirmationStore.js";
import { ElicitFn, buildConfirmationElicitation } from "../ElicitationHelper.js";

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
      },
      confirmToken: {
        type: "string",
        description: "Optional confirmation token from a dry-run preview. Provide this to execute a previously previewed operation."
      }
    },
    required: ["tableName"],
  } as any;

  /** Optional MCP elicitation function — set after server connects if client supports it. */
  elicit?: ElicitFn;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    try {
      const { tableName, ifExists, confirmToken } = params;
      const originalParams = { tableName };

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
          mode: "forbidden",
          success: false,
          message,
          forbidden: true
        };
      }

      // Even with dangerous mode enabled, always show dry-run preview for DROP
      // or respect the global dry-run setting
      if (this.safetyConfig.enableDryRun) {
        const impact = 'This will permanently delete the table and all its data.';

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
            const severity = getOperationSeverity('DROP');
            const elicitParams = buildConfirmationElicitation('DROP', tableName, query, severity, impact);
            const response = await this.elicit(elicitParams);
            if (response.action === 'accept' && response.content?.approve) {
              // User approved — fall through to execution below
            } else {
              return { mode: "preview", success: true, message: generateDryRunPreview('DROP', tableName, query, impact) + '\nOperation declined by user.', dryRun: true };
            }
          } catch {
            console.error('Elicitation failed for DROP, falling back to token flow.');
            const token = confirmationStore.create('DROP', tableName, query, originalParams);
            const preview = generateDryRunPreview('DROP', tableName, query, impact);
            logOperation({ timestamp: startTime, operationType: 'DROP', target: tableName, query, severity: 'CRITICAL' as any, dryRun: true, success: true });
            return { mode: "preview", success: true, message: preview, dryRun: true, confirmToken: token };
          }
        } else {
          // Priority 3: Token preview (fallback)
          const token = confirmationStore.create('DROP', tableName, query, originalParams);
          const preview = generateDryRunPreview('DROP', tableName, query, impact);

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
            mode: "preview",
            success: true,
            message: preview,
            dryRun: true,
            confirmToken: token
          };
        }
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
        mode: "executed",
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
        mode: "error",
        success: false,
        message: `Failed to drop table: ${error}`
      };
    }
  }
}