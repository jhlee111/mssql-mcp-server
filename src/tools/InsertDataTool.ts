import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, requiresApproval, getOperationSeverity } from "../SafetyConfig.js";
import { generateDryRunPreview, generateApprovalRequiredMessage, logOperation } from "../ApprovalHelper.js";
import { confirmationStore } from "../ConfirmationStore.js";
import { ElicitFn, buildConfirmationElicitation } from "../ElicitationHelper.js";

export class InsertDataTool implements Tool {
  [key: string]: any;
  name = "insert_data";
  description = `Inserts data into an MSSQL Database table. Supports both single record insertion and multiple record insertion using standard SQL INSERT with VALUES clause.
FORMAT EXAMPLES:
Single Record Insert:
{
  "tableName": "Users",
  "data": {
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "isActive": true,
    "createdDate": "2023-01-15"
  }
}
Multiple Records Insert:
{
  "tableName": "Users", 
  "data": [
    {
      "name": "John Doe",
      "email": "john@example.com", 
      "age": 30,
      "isActive": true,
      "createdDate": "2023-01-15"
    },
    {
      "name": "Jane Smith",
      "email": "jane@example.com",
      "age": 25, 
      "isActive": false,
      "createdDate": "2023-01-16"
    }
  ]
}
GENERATED SQL FORMAT:
- Single: INSERT INTO table (col1, col2) VALUES (@param1, @param2)
- Multiple: INSERT INTO table (col1, col2) VALUES (@param1, @param2), (@param3, @param4), ...
IMPORTANT RULES:
- For single record: Use a single object for the 'data' field
- For multiple records: Use an array of objects for the 'data' field
- All objects in array must have identical column names
- Column names must match the actual database table columns exactly
- Values should match the expected data types (string, number, boolean, date)
- Use proper date format for date columns (YYYY-MM-DD or ISO format)`;
  inputSchema = {
    type: "object",
    properties: {
      tableName: { 
        type: "string", 
        description: "Name of the table to insert data into" 
      },
      data: {
        oneOf: [
          {
            type: "object",
            description: "Single record data object with column names as keys and values as the data to insert. Example: {\"name\": \"John\", \"age\": 30}"
          },
          {
            type: "array",
            items: { type: "object" },
            description: "Array of data objects for multiple record insertion. Each object must have identical column structure. Example: [{\"name\": \"John\", \"age\": 30}, {\"name\": \"Jane\", \"age\": 25}]"
          }
        ]
      },
      confirmToken: {
        type: "string",
        description: "Optional confirmation token from a dry-run preview. Provide this to execute a previously previewed operation."
      },
    },
    required: ["tableName", "data"],
  } as any;

  /** Optional MCP elicitation function — set after server connects if client supports it. */
  elicit?: ElicitFn;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    let query: string | undefined;
    try {
      const { tableName, data, confirmToken } = params;
      const originalParams = { tableName, data };

      // Check if data is an array (multiple records) or single object
      const isMultipleRecords = Array.isArray(data);
      const records = isMultipleRecords ? data : [data];
      if (records.length === 0) {
        return {
          mode: "error",
          success: false,
          message: "No data provided for insertion",
        };
      }
      // Validate that all records have the same columns
      const firstRecordColumns = Object.keys(records[0]).sort();
      for (let i = 1; i < records.length; i++) {
        const currentColumns = Object.keys(records[i]).sort();
        if (JSON.stringify(firstRecordColumns) !== JSON.stringify(currentColumns)) {
          return {
            mode: "error",
            success: false,
            message: `Column mismatch: Record ${i + 1} has different columns than the first record. Expected columns: [${firstRecordColumns.join(', ')}], but got: [${currentColumns.join(', ')}]`,
          };
        }
      }
      const columns = firstRecordColumns.join(", ");
      const request = new sql.Request();

      // Build the query (used for both dry-run and execution)
      let valueClauses: string[] = [];

      if (isMultipleRecords) {
        // Multiple records insert using VALUES clause - works for 1 or more records
        records.forEach((record, recordIndex) => {
          const valueParams = firstRecordColumns
            .map((column, columnIndex) => `@value${recordIndex}_${columnIndex}`)
            .join(", ");
          valueClauses.push(`(${valueParams})`);
          // Add parameters for this record
          firstRecordColumns.forEach((column, columnIndex) => {
            request.input(`value${recordIndex}_${columnIndex}`, record[column]);
          });
        });
        query = `INSERT INTO ${tableName} (${columns}) VALUES ${valueClauses.join(", ")}`;
      } else {
        // Single record insert (when data is passed as single object)
        const values = firstRecordColumns
          .map((column, index) => `@value${index}`)
          .join(", ");
        firstRecordColumns.forEach((column, index) => {
          request.input(`value${index}`, records[0][column]);
        });
        query = `INSERT INTO ${tableName} (${columns}) VALUES (${values})`;
      }

      // Check if approval is required
      if (requiresApproval('INSERT', this.safetyConfig)) {
        const message = generateApprovalRequiredMessage('INSERT', tableName, query);
        return {
          mode: "approval_required",
          success: false,
          message,
          requiresApproval: true
        };
      }

      // Handle dry-run mode
      if (this.safetyConfig.enableDryRun) {
        const recordSummary = isMultipleRecords ? `${records.length} record(s)` : '1 record';
        const impact = `This will insert ${recordSummary} into the table.`;

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
            const severity = getOperationSeverity('INSERT');
            const elicitParams = buildConfirmationElicitation('INSERT', tableName, query, severity, impact);
            const response = await this.elicit(elicitParams);
            if (response.action === 'accept' && response.content?.approve) {
              // User approved — fall through to execution below
            } else {
              return { mode: "preview", success: true, message: generateDryRunPreview('INSERT', tableName, query, impact) + '\nOperation declined by user.', dryRun: true };
            }
          } catch {
            // Elicitation failed — fall back to token flow
            console.error('Elicitation failed for INSERT, falling back to token flow.');
            const token = confirmationStore.create('INSERT', tableName, query, originalParams);
            const preview = generateDryRunPreview('INSERT', tableName, query, impact);
            logOperation({ timestamp: startTime, operationType: 'INSERT', target: tableName, query, severity: 'LOW' as any, dryRun: true, success: true });
            return { mode: "preview", success: true, message: preview, dryRun: true, confirmToken: token };
          }
        } else {
          // Priority 3: Token preview (fallback)
          const token = confirmationStore.create('INSERT', tableName, query, originalParams);
          const preview = generateDryRunPreview('INSERT', tableName, query, impact);

          logOperation({
            timestamp: startTime,
            operationType: 'INSERT',
            target: tableName,
            query,
            severity: 'LOW' as any,
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
      await request.query(query);

      // Log successful operation
      logOperation({
        timestamp: startTime,
        operationType: 'INSERT',
        target: tableName,
        query,
        severity: 'LOW' as any,
        dryRun: false,
        success: true
      });

      return {
        mode: "executed",
        success: true,
        message: `Successfully inserted ${records.length} record${records.length > 1 ? 's' : ''} into ${tableName}`,
        recordsInserted: records.length,
      };
    } catch (error) {
      console.error("Error inserting data:", error);

      // Log failed operation
      logOperation({
        timestamp: startTime,
        operationType: 'INSERT',
        target: params.tableName || 'unknown',
        query: query || `INSERT INTO ${params.tableName}`,
        severity: 'LOW' as any,
        dryRun: false,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        mode: "error",
        success: false,
        message: `Failed to insert data: ${error}`,
      };
    }
  }
}