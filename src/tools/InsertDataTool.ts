import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, requiresApproval } from "../SafetyConfig.js";
import { generateDryRunPreview, generateApprovalRequiredMessage, logOperation } from "../ApprovalHelper.js";

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
    },
    required: ["tableName", "data"],
  } as any;

  constructor(private safetyConfig: SafetyConfig) {}

  async run(params: any) {
    const startTime = new Date().toISOString();
    let query: string | undefined;
    try {
      const { tableName, data } = params;
      // Check if data is an array (multiple records) or single object
      const isMultipleRecords = Array.isArray(data);
      const records = isMultipleRecords ? data : [data];
      if (records.length === 0) {
        return {
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
          success: false,
          message,
          requiresApproval: true
        };
      }

      // Handle dry-run mode
      if (this.safetyConfig.enableDryRun) {
        const recordSummary = isMultipleRecords
          ? `${records.length} record(s)`
          : '1 record';
        const preview = generateDryRunPreview('INSERT', tableName, query,
          `This will insert ${recordSummary} into the table.`);

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
          success: true,
          message: preview,
          dryRun: true
        };
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
        success: false,
        message: `Failed to insert data: ${error}`,
      };
    }
  }
}