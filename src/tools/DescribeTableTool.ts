import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";


export class DescribeTableTool implements Tool {
  [key: string]: any;
  name = "describe_table";
  description = "Describes the schema (columns and types) of a specified MSSQL Database table. Accepts a bare table name or a schema-qualified one (e.g. 'sales.orders').";
  inputSchema = {
    type: "object",
    properties: {
      tableName: { type: "string", description: "Name of the table to describe. May be schema-qualified, e.g. 'sales.orders' or '[sales].[orders]'" },
      schema: { type: "string", description: "Schema name (optional). Takes precedence over a schema prefix in tableName." },
    },
    required: ["tableName"],
  } as any;

  /**
   * Splits an identifier such as `orders`, `sales.orders`, `db.sales.orders` or
   * `[sales].[orders]` into its schema and table parts. Bracketed segments may
   * themselves contain dots, so they are matched before splitting.
   */
  private parseTableName(input: string): { schema?: string; table: string } {
    const segments = input.match(/\[[^\]]*\]|[^.]+/g) ?? [input];
    const parts = segments
      .map((part) => part.replace(/^\[|\]$/g, "").trim())
      .filter((part) => part.length > 0);

    if (parts.length >= 2) {
      return { schema: parts[parts.length - 2], table: parts[parts.length - 1] };
    }
    return { table: parts[0] ?? input.trim() };
  }

  async run(params: { tableName: string; schema?: string }) {
    try {
      const { tableName, schema } = params;
      const parsed = this.parseTableName(tableName);
      // An explicit `schema` argument wins over a prefix embedded in `tableName`.
      const targetSchema = schema?.trim() || parsed.schema;
      const targetTable = parsed.table;

      const request = new sql.Request();
      const query = `SELECT TABLE_SCHEMA as [schema], COLUMN_NAME as name, DATA_TYPE as type
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @tableName
          AND (@schema IS NULL OR TABLE_SCHEMA = @schema)
        ORDER BY TABLE_SCHEMA, ORDINAL_POSITION`;
      request.input("tableName", sql.NVarChar, targetTable);
      request.input("schema", sql.NVarChar, targetSchema ?? null);
      const result = await request.query(query);

      const columns = result.recordset;
      const qualified = targetSchema ? `${targetSchema}.${targetTable}` : targetTable;

      // Previously an unmatched name returned `success: true` with an empty array,
      // which reads as "this table has no columns" rather than "no such table".
      if (columns.length === 0) {
        return {
          success: false,
          message: targetSchema
            ? `Table not found: ${qualified}`
            : `Table not found: ${targetTable} (searched every schema; use list_table to find the qualified name)`,
        };
      }

      // Without a schema filter the same table name can exist in several schemas,
      // and merging them silently would misrepresent a single table's shape.
      const matchedSchemas = [...new Set(columns.map((column: any) => column.schema))];
      if (matchedSchemas.length > 1) {
        return {
          success: true,
          message: `'${targetTable}' exists in ${matchedSchemas.length} schemas (${matchedSchemas.join(", ")}); columns from all of them are listed. Pass a schema-qualified name to describe just one.`,
          schemas: matchedSchemas,
          columns,
        };
      }

      return {
        success: true,
        schema: matchedSchemas[0],
        table: targetTable,
        columns,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to describe table: ${error}`,
      };
    }
  }
}
