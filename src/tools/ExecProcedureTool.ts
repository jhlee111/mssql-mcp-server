import sql from "mssql";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SafetyConfig, getOperationSeverity } from "../SafetyConfig.js";
import { generateDryRunPreview, logOperation } from "../ApprovalHelper.js";
import { confirmationStore } from "../ConfirmationStore.js";
import { ElicitFn, buildConfirmationElicitation } from "../ElicitationHelper.js";

export class ExecProcedureTool implements Tool {
  [key: string]: any;
  name = "exec_procedure";
  description = `Executes a stored procedure on the MSSQL Database. Supports parameterized procedure calls with optional input parameters.
USAGE:
{
  "procedureName": "schema.procedureName",
  "parameters": { "param1": "value1", "param2": 123 }
}
EXAMPLES:
- With schema: { "procedureName": "qb.up_QbAnuualIncome_since2018_forSTI", "parameters": { "year": "2025", "userId": "speak7", "orgCd": "N20110" } }
- Without schema (defaults to dbo): { "procedureName": "up_SomeProcedure", "parameters": { "id": 1 } }
- No parameters: { "procedureName": "dbo.up_GetAllRecords" }
IMPORTANT:
- Procedure name must match pattern: word characters only (letters, digits, underscores), with optional schema prefix
- Parameters are passed via parameterized inputs (SQL injection safe)
- Requires ALLOW_EXEC_PROCEDURE=true in environment configuration
- Returns all result sets and rowsAffected count`;

  inputSchema = {
    type: "object",
    properties: {
      procedureName: {
        type: "string",
        description: "Stored procedure name, optionally with schema prefix (e.g. 'qb.up_QbAnuualIncome_since2018_forSTI' or 'up_SomeProcedure')"
      },
      parameters: {
        type: "object",
        description: "Optional key-value pairs of input parameters for the stored procedure (e.g. { \"year\": \"2025\", \"orgCd\": \"N20110\" })"
      },
      confirmToken: {
        type: "string",
        description: "Optional confirmation token from a dry-run preview. Provide this to execute a previously previewed operation."
      },
    },
    required: ["procedureName"],
  } as any;

  // Pattern: schema.name or just name (word characters only)
  private static readonly PROC_NAME_WITH_SCHEMA = /^[\w]+\.[\w]+$/;
  private static readonly PROC_NAME_WITHOUT_SCHEMA = /^[\w]+$/;

  /** Optional MCP elicitation function — set after server connects if client supports it. */
  elicit?: ElicitFn;

  constructor(private safetyConfig: SafetyConfig) {}

  /**
   * Validates the procedure name for security
   */
  private validateProcedureName(name: string): { isValid: boolean; error?: string } {
    if (!name || typeof name !== 'string') {
      return { isValid: false, error: 'Procedure name must be a non-empty string' };
    }

    if (name.length > 256) {
      return { isValid: false, error: 'Procedure name is too long. Maximum 256 characters.' };
    }

    // Must match schema.name or just name pattern
    if (!ExecProcedureTool.PROC_NAME_WITH_SCHEMA.test(name) &&
        !ExecProcedureTool.PROC_NAME_WITHOUT_SCHEMA.test(name)) {
      return {
        isValid: false,
        error: 'Invalid procedure name. Only word characters (letters, digits, underscores) are allowed, with optional schema prefix (e.g. "dbo.up_MyProc" or "up_MyProc").'
      };
    }

    return { isValid: true };
  }

  /**
   * Sanitizes result recordsets
   */
  private sanitizeRecordsets(recordsets: sql.IRecordSet<any>[]): any[][] {
    const maxRecords = 10000;

    return recordsets.map(recordset => {
      const data = Array.isArray(recordset) ? recordset : [];
      const limited = data.length > maxRecords ? data.slice(0, maxRecords) : data;

      return limited.map(record => {
        if (typeof record === 'object' && record !== null) {
          const sanitized: any = {};
          for (const [key, value] of Object.entries(record)) {
            const sanitizedKey = key.replace(/[^\w\s\-_.]/g, '');
            sanitized[sanitizedKey] = value;
          }
          return sanitized;
        }
        return record;
      });
    });
  }

  async run(params: any) {
    const startTime = new Date().toISOString();
    const { procedureName, parameters, confirmToken } = params;
    const originalParams = { procedureName, parameters };

    try {
      // Check if exec procedure is allowed
      if (!this.safetyConfig.allowExecProcedure) {
        return {
          mode: "forbidden",
          success: false,
          message: `⚠️ STORED PROCEDURE EXECUTION DISABLED\n${'='.repeat(60)}\n\nStored procedure execution is disabled by default for safety.\n\nProcedure: ${procedureName}\n\nTo enable stored procedure execution:\nSet ALLOW_EXEC_PROCEDURE=true in your environment configuration.\n\n⚠️ WARNING: Stored procedures can modify data. Enable with caution.`,
          error: 'EXEC_PROCEDURE_DISABLED'
        };
      }

      // Validate procedure name
      const validation = this.validateProcedureName(procedureName);
      if (!validation.isValid) {
        return {
          mode: "error",
          success: false,
          message: `Security validation failed: ${validation.error}`,
          error: 'SECURITY_VALIDATION_FAILED'
        };
      }

      // Build description for logging/preview
      const paramDesc = parameters
        ? Object.entries(parameters).map(([k, v]) => `@${k} = ${JSON.stringify(v)}`).join(', ')
        : '(none)';
      const queryDesc = `EXEC ${procedureName} ${paramDesc}`;

      // Handle dry-run mode
      if (this.safetyConfig.enableDryRun) {
        const impact = `This will execute stored procedure ${procedureName} with ${parameters ? Object.keys(parameters).length : 0} parameter(s).`;

        if (confirmToken) {
          // Priority 1: Token-based confirmation (Phase 1)
          const tokenValidation = confirmationStore.validate(confirmToken, queryDesc, originalParams);
          if (!tokenValidation.valid) {
            return { mode: "confirmation_failed", success: false, message: `Confirmation failed: ${tokenValidation.reason}` };
          }
          // Token valid — fall through to execution below
        } else if (this.elicit) {
          // Priority 2: Elicitation-based confirmation (Phase 2)
          try {
            const severity = getOperationSeverity('EXEC');
            const elicitParams = buildConfirmationElicitation('EXEC', procedureName, queryDesc, severity, impact);
            const response = await this.elicit(elicitParams);
            if (response.action === 'accept' && response.content?.approve) {
              // User approved — fall through to execution below
            } else {
              return { mode: "preview", success: true, message: generateDryRunPreview('EXEC', procedureName, queryDesc, impact) + '\nOperation declined by user.', dryRun: true };
            }
          } catch {
            console.error('Elicitation failed for EXEC, falling back to token flow.');
            const token = confirmationStore.create('EXEC', procedureName, queryDesc, originalParams);
            const preview = generateDryRunPreview('EXEC', procedureName, queryDesc, impact);
            logOperation({ timestamp: startTime, operationType: 'EXEC', target: procedureName, query: queryDesc, severity: 'MEDIUM' as any, dryRun: true, success: true });
            return { mode: "preview", success: true, message: preview, dryRun: true, confirmToken: token };
          }
        } else {
          // Priority 3: Token preview (fallback)
          const token = confirmationStore.create('EXEC', procedureName, queryDesc, originalParams);
          const preview = generateDryRunPreview('EXEC', procedureName, queryDesc, impact);

          logOperation({
            timestamp: startTime,
            operationType: 'EXEC',
            target: procedureName,
            query: queryDesc,
            severity: 'MEDIUM' as any,
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

      // Execute the stored procedure
      console.error(`Executing stored procedure: ${procedureName}`);

      const request = new sql.Request();

      // Add parameters if provided
      if (parameters && typeof parameters === 'object') {
        for (const [key, value] of Object.entries(parameters)) {
          request.input(key, value);
        }
      }

      const result = await request.execute(procedureName);

      // Sanitize results
      const sanitizedRecordsets = this.sanitizeRecordsets(result.recordsets as sql.IRecordSet<any>[]);
      const totalRecords = sanitizedRecordsets.reduce((sum, rs) => sum + rs.length, 0);

      // Log successful operation
      logOperation({
        timestamp: startTime,
        operationType: 'EXEC',
        target: procedureName,
        query: queryDesc,
        severity: 'MEDIUM' as any,
        dryRun: false,
        success: true
      });

      return {
        mode: "executed",
        success: true,
        message: `Stored procedure ${procedureName} executed successfully. ${sanitizedRecordsets.length} result set(s), ${totalRecords} total record(s).`,
        data: sanitizedRecordsets.length === 1 ? sanitizedRecordsets[0] : sanitizedRecordsets,
        recordSetCount: sanitizedRecordsets.length,
        totalRecords,
        rowsAffected: result.rowsAffected,
      };

    } catch (error) {
      console.error("Error executing stored procedure:", error);

      // Log failed operation
      logOperation({
        timestamp: startTime,
        operationType: 'EXEC',
        target: procedureName || 'unknown',
        query: `EXEC ${procedureName || 'unknown'}`,
        severity: 'MEDIUM' as any,
        dryRun: false,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const safeErrorMessage = errorMessage.includes('Could not find stored procedure')
        ? errorMessage
        : `Stored procedure execution failed: ${errorMessage}`;

      return {
        mode: "error",
        success: false,
        message: safeErrorMessage,
        error: 'EXEC_PROCEDURE_FAILED'
      };
    }
  }
}
