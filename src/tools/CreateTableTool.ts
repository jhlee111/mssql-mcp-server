import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, requiresApproval } from "../SafetyConfig.js";
import { generateDryRunPreview, generateApprovalRequiredMessage, logOperation } from "../ApprovalHelper.js";
import { getServerCapabilities } from "../index.js";

export class CreateTableTool implements Tool {
  [key: string]: any;
  name = "create_table";
  description = "Creates a new table in the MSSQL Database with the specified columns. Validates data types against SQL Server version. Supports: INT, BIGINT, VARCHAR, NVARCHAR, TEXT, DATETIME, DATETIME2 (2008+), DATE (2008+), JSON (2016+), and more.";
  inputSchema = {
    type: "object",
    properties: {
      tableName: { type: "string", description: "Name of the table to create" },
      columns: {
        type: "array",
        description: "Array of column definitions (e.g., [{ name: 'id', type: 'INT PRIMARY KEY' }, { name: 'data', type: 'NVARCHAR(MAX)' }])",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Column name" },
            type: { type: "string", description: "SQL type and constraints (e.g., 'INT PRIMARY KEY', 'NVARCHAR(255) NOT NULL', 'JSON' for SQL 2016+)" }
          },
          required: ["name", "type"]
        }
      }
    },
    required: ["tableName", "columns"],
  } as any;

  constructor(private safetyConfig: SafetyConfig) {}

  /**
   * Validate data types against server capabilities
   */
  private validateDataTypes(columns: any[]): string[] {
    const capabilities = getServerCapabilities();
    const warnings: string[] = [];

    if (!capabilities) {
      return warnings; // Can't validate without capabilities
    }

    for (const col of columns) {
      const typeUpper = col.type.toUpperCase();

      // Check for JSON type (SQL Server 2016+)
      if (typeUpper.includes('JSON') && !capabilities.supportsJson) {
        warnings.push(`Column '${col.name}': JSON type requires SQL Server 2016+. Current: ${capabilities.version.productName}. Consider using NVARCHAR(MAX) instead.`);
      }

      // Check for DATETIME2/DATE/TIME (SQL Server 2008+, but good to note)
      if ((typeUpper.includes('DATETIME2') || typeUpper.includes('DATE') || typeUpper.includes('TIME'))
          && capabilities.version.major < 10) {
        warnings.push(`Column '${col.name}': ${typeUpper} requires SQL Server 2008+. Consider using DATETIME for older versions.`);
      }
    }

    return warnings;
  }

  async run(params: any) {
    const startTime = new Date().toISOString();
    try {
      const { tableName, columns } = params;
      if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error("'columns' must be a non-empty array");
      }

      // Validate data types against server version
      const typeWarnings = this.validateDataTypes(columns);

      const columnDefs = columns.map((col: any) => `[${col.name}] ${col.type}`).join(", ");
      const query = `CREATE TABLE [${tableName}] (${columnDefs})`;

      // Check if approval is required
      if (requiresApproval('CREATE', this.safetyConfig)) {
        const message = generateApprovalRequiredMessage('CREATE', tableName, query);
        return {
          success: false,
          message,
          requiresApproval: true
        };
      }

      // Handle dry-run mode
      if (this.safetyConfig.enableDryRun) {
        const columnList = columns.map((col: any) => `  - ${col.name}: ${col.type}`).join('\n');
        const preview = generateDryRunPreview('CREATE', tableName, query,
          `This will create a new table with the following columns:\n${columnList}`);

        logOperation({
          timestamp: startTime,
          operationType: 'CREATE',
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
      await new sql.Request().query(query);

      // Log successful operation
      logOperation({
        timestamp: startTime,
        operationType: 'CREATE',
        target: tableName,
        query,
        severity: 'HIGH' as any,
        dryRun: false,
        success: true
      });

      let message = `Table '${tableName}' created successfully.`;
      if (typeWarnings.length > 0) {
        message += '\n\n⚠️  Data Type Warnings:\n' + typeWarnings.map(w => `  - ${w}`).join('\n');
      }

      return {
        success: true,
        message,
        warnings: typeWarnings.length > 0 ? typeWarnings : undefined
      };
    } catch (error) {
      console.error("Error creating table:", error);

      // Log failed operation
      logOperation({
        timestamp: startTime,
        operationType: 'CREATE',
        target: params.tableName || 'unknown',
        query: `CREATE TABLE [${params.tableName}]`,
        severity: 'HIGH' as any,
        dryRun: false,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        message: `Failed to create table: ${error}`
      };
    }
  }
}
