import sql from "mssql";
import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { logOperation } from "../ApprovalHelper.js";

export class ExportToFileTool implements Tool {
  [key: string]: any;
  name = "export_to_file";
  description = `Executes a SELECT query or stored procedure and saves the results directly to an Excel (.xlsx) or CSV file.
Use this tool when the result set is too large to return through the MCP protocol, or when the user needs a file export.
USAGE:
{
  "source": "procedure",
  "procedureName": "dbo.MyStoredProcedure",
  "parameters": { "startDate": "2025-01-01", "category": "" },
  "filePath": "./exports/report.xlsx",
  "format": "xlsx"
}
OR for a query:
{
  "source": "query",
  "query": "SELECT * FROM dbo.MyTable",
  "filePath": "./exports/data.xlsx"
}
PARAMETERS:
- source: "query" or "procedure" (required)
- query: SQL SELECT statement (required when source=query)
- procedureName: Stored procedure name (required when source=procedure)
- parameters: SP parameters as key-value object (optional, for procedure)
- filePath: Output file path (required). Must end with .xlsx or .csv
- format: "xlsx" (default) or "csv"
- sheetName: Sheet name for xlsx (default: "Sheet1")
RETURNS: { success, filePath, recordCount, message }`;

  inputSchema = {
    type: "object",
    properties: {
      source: {
        type: "string",
        enum: ["query", "procedure"],
        description: "Data source type: 'query' for SELECT or 'procedure' for stored procedure"
      },
      query: {
        type: "string",
        description: "SQL SELECT query (when source=query)"
      },
      procedureName: {
        type: "string",
        description: "Stored procedure name (when source=procedure)"
      },
      parameters: {
        type: "object",
        description: "Key-value parameters for stored procedure"
      },
      filePath: {
        type: "string",
        description: "Output file path (must end with .xlsx or .csv)"
      },
      format: {
        type: "string",
        enum: ["xlsx", "csv"],
        description: "Output format: xlsx (default) or csv"
      },
      sheetName: {
        type: "string",
        description: "Sheet name for xlsx output (default: Sheet1)"
      }
    },
    required: ["source", "filePath"],
  } as any;

  private static readonly PROC_NAME_PATTERN = /^[\w]+\.[\w]+$|^[\w]+$/;

  async run(params: any) {
    const startTime = new Date().toISOString();
    const { source, query, procedureName, parameters, filePath, sheetName } = params;
    const format = params.format || (filePath?.endsWith('.csv') ? 'csv' : 'xlsx');

    try {
      // Validate inputs
      if (!source || !['query', 'procedure'].includes(source)) {
        return { success: false, message: "Parameter 'source' must be 'query' or 'procedure'" };
      }
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, message: "Parameter 'filePath' is required" };
      }
      if (source === 'query' && (!query || typeof query !== 'string')) {
        return { success: false, message: "Parameter 'query' is required when source=query" };
      }
      if (source === 'procedure' && (!procedureName || typeof procedureName !== 'string')) {
        return { success: false, message: "Parameter 'procedureName' is required when source=procedure" };
      }

      // Validate query safety (only SELECT allowed)
      if (source === 'query') {
        const trimmed = query.trim().toUpperCase();
        if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
          return { success: false, message: "Only SELECT queries are allowed for export" };
        }
      }

      // Validate procedure name
      if (source === 'procedure' && !ExportToFileTool.PROC_NAME_PATTERN.test(procedureName)) {
        return { success: false, message: "Invalid procedure name. Only word characters with optional schema prefix." };
      }

      // Ensure output directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Execute query or SP
      console.error(`[export_to_file] Executing ${source}: ${source === 'query' ? query.substring(0, 100) : procedureName}`);

      let data: any[];

      if (source === 'query') {
        const request = new sql.Request();
        (request as any).timeout = 300000; // 5 min timeout for large exports
        const result = await request.query(query);
        data = result.recordset;
      } else {
        const request = new sql.Request();
        (request as any).timeout = 300000;
        if (parameters && typeof parameters === 'object') {
          for (const [key, value] of Object.entries(parameters)) {
            request.input(key, value);
          }
        }
        const result = await request.execute(procedureName);
        // Use the last recordset (main result, skipping debug outputs)
        const recordsets = result.recordsets as sql.IRecordSet<any>[];
        data = recordsets.length > 0
          ? recordsets[recordsets.length - 1] as any[]
          : [];
      }

      if (!data || data.length === 0) {
        return { success: true, message: "Query returned no data. No file created.", recordCount: 0 };
      }

      // Get column names from first row
      const columns = Object.keys(data[0]);

      if (format === 'csv') {
        await this.writeCsv(filePath, columns, data);
      } else {
        await this.writeXlsx(filePath, columns, data, sheetName || 'Sheet1');
      }

      const fileSize = fs.statSync(filePath).size;
      const fileSizeStr = fileSize > 1048576
        ? `${(fileSize / 1048576).toFixed(1)} MB`
        : `${(fileSize / 1024).toFixed(1)} KB`;

      logOperation({
        timestamp: startTime,
        operationType: 'EXEC' as any,
        target: source === 'query' ? 'export_query' : procedureName,
        query: source === 'query' ? query : `EXEC ${procedureName}`,
        severity: 'LOW' as any,
        dryRun: false,
        success: true
      });

      return {
        success: true,
        filePath,
        format,
        recordCount: data.length,
        columnCount: columns.length,
        fileSize: fileSizeStr,
        message: `Exported ${data.length} rows (${columns.length} columns) to ${filePath} (${fileSizeStr})`
      };

    } catch (error) {
      console.error("[export_to_file] Error:", error);

      logOperation({
        timestamp: startTime,
        operationType: 'EXEC' as any,
        target: source === 'query' ? 'export_query' : (procedureName || 'unknown'),
        query: source === 'query' ? (query || '') : `EXEC ${procedureName || 'unknown'}`,
        severity: 'LOW' as any,
        dryRun: false,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        message: `Export failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async writeXlsx(filePath: string, columns: string[], data: any[], sheetName: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);

    // Add header row with styling
    sheet.columns = columns.map(col => ({
      header: col,
      key: col,
      width: Math.max(col.length + 2, 12)
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E1F2' }
    };

    // Add data rows
    for (const row of data) {
      const values: any = {};
      for (const col of columns) {
        values[col] = row[col];
      }
      sheet.addRow(values);
    }

    // Auto-filter
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length }
    };

    // Adjust column widths based on data (sample first 100 rows)
    for (let i = 0; i < columns.length; i++) {
      let maxLen = columns[i].length;
      const sampleSize = Math.min(data.length, 100);
      for (let j = 0; j < sampleSize; j++) {
        const val = data[j][columns[i]];
        if (val != null) {
          const len = String(val).length;
          if (len > maxLen) maxLen = len;
        }
      }
      sheet.getColumn(i + 1).width = Math.min(maxLen + 2, 50);
    }

    await workbook.xlsx.writeFile(filePath);
  }

  private async writeCsv(filePath: string, columns: string[], data: any[]): Promise<void> {
    const escapeCsv = (val: any): string => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const lines: string[] = [];
    lines.push(columns.map(escapeCsv).join(','));

    for (const row of data) {
      lines.push(columns.map(col => escapeCsv(row[col])).join(','));
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  }
}
