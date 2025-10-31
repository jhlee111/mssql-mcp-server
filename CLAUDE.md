# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that enables LLM assistants to interact with MSSQL databases through natural language. It provides a secure, tool-based interface for database operations.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Build the project (compiles TypeScript and makes dist/index.js executable)
npm run build

# Watch mode for development (auto-rebuild on changes)
npm run watch

# Start the server (run after building)
npm start
```

## Architecture

### Core Components

**Entry Point (`src/index.ts`)**
- Initializes the MCP server using `@modelcontextprotocol/sdk`
- Manages SQL connection pooling via global `globalSqlPool`
- Implements read-only mode via `READONLY` environment variable
- Wraps all tool runs with `wrapToolRun()` to ensure SQL connection before execution
- Uses StdioServerTransport for communication with MCP clients

**Environment Variable System**
- All MSSQL-related variables MUST use `MSSQL_` prefix
- Required variables: `MSSQL_SERVER`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD`
- Optional: `MSSQL_TRUST_SERVER_CERTIFICATE`, `MSSQL_CONNECTION_TIMEOUT`
- Validation happens on startup via `validateEnvVariables()` in src/index.ts:38-70

**Tool Architecture**
- All tools in `src/tools/` implement the MCP `Tool` interface
- Each tool has: `name`, `description`, `inputSchema`, and `run()` method
- Tools are registered in two arrays in src/index.ts:127-128:
  - Read-only mode: `[listTableTool, readDataTool, describeTableTool]`
  - Full mode: All tools including write operations
- Tool dispatch happens in CallToolRequestSchema handler (src/index.ts:131-181)

### Database Operations

**Connection Management**
- Connection config created by `createSqlConfig()` (src/index.ts:76-97)
- Uses SQL Server authentication (username/password), not Azure AD
- Connection ensured before each tool execution via `ensureSqlConnection()` (src/index.ts:201-220)
- Pool settings: max 10 connections, 30s idle timeout

**Security Model**
- ReadDataTool has extensive SQL injection protection (src/tools/ReadDataTool.ts:20-75)
  - Validates queries must start with SELECT
  - Blocks dangerous keywords and patterns
  - Prevents multiple statements, stored procedure calls
  - Limits query length to 10,000 characters
  - Returns max 10,000 records
- UpdateDataTool requires WHERE clause (cannot update all rows)
- All write operations use parameterized queries to prevent injection

### Adding New Tools

1. Create tool class in `src/tools/NewTool.ts` implementing the Tool interface
2. Import in `src/index.ts`
3. Instantiate the tool (around line 99-106)
4. Add to appropriate tool array in ListToolsRequestSchema handler (line 127-128)
5. Add case in CallToolRequestSchema switch statement (line 135-170)
6. Add to wrapToolRun call at bottom (line 231)

## Configuration for MCP Clients

**VS Code Agent**: Create `.vscode/mcp.json` or add to user settings
**Claude Desktop**: Edit `claude_desktop_config.json`

Both require absolute path to `dist/index.js` and environment variables with `MSSQL_` prefix.

Sample configurations available in `src/samples/` directory.

## Safety Features

The server includes a comprehensive safety system with multiple protection layers:

### Permission Levels

**DROP Operations (FORBIDDEN by default):**
- `ALLOW_DANGEROUS_OPERATIONS` - Must be set to `true` to enable DROP operations (default: `false`)
- DROP operations are treated specially and are FORBIDDEN unless explicitly enabled
- Even when enabled, DROP operations always show in dry-run mode if `ENABLE_DRY_RUN=true`
- This prevents accidental permanent deletion of tables/indexes

**Other Operations (Configurable approval):**
- `REQUIRE_APPROVAL_CREATE` - Set to `true` to require approval for CREATE operations (default: `false`)
- `REQUIRE_APPROVAL_UPDATE` - Set to `true` to require approval for UPDATE operations (default: `false`)
- `REQUIRE_APPROVAL_DELETE` - Set to `true` to require approval for DELETE operations (default: `false`)
- `REQUIRE_APPROVAL_INSERT` - Set to `true` to require approval for INSERT operations (default: `false`)

**Note the distinction:**
- `DROP` = removes entire table/index (schema change) - FORBIDDEN by default
- `DELETE` = removes rows from a table (data operation) - configurable approval

### Dry-Run Mode

Set `ENABLE_DRY_RUN=true` to preview all operations without executing them:
- Shows what SQL would be executed
- Displays estimated impact
- Logs the dry-run operation
- No database changes occur
- Works for all operations: DROP, CREATE, UPDATE, DELETE, INSERT

### Operation Logging

All destructive operations (DROP, CREATE, UPDATE, DELETE, INSERT) are automatically logged to `./logs/operations.log` (or custom path via `OPERATION_LOG_DIR`). Each log entry includes:
- Timestamp
- Operation type and severity level (CRITICAL, HIGH, MEDIUM, LOW)
- Target (table name)
- Full SQL query
- Success/failure status
- Error message (if failed)
- Whether it was a dry-run

### Safety Configuration in Tools

All destructive tools now implement safety checks:
- **DropTableTool** - Checks `isDropAllowed()` (src/SafetyConfig.ts:76-78), FORBIDDEN by default
- **CreateTableTool** - Checks approval via `requiresApproval('CREATE')`
- **UpdateDataTool** - Checks approval via `requiresApproval('UPDATE')`
- **DeleteDataTool** - Checks approval via `requiresApproval('DELETE')` (NEW!)
- **InsertDataTool** - Checks approval via `requiresApproval('INSERT')`

When adding new destructive tools:
1. Import `SafetyConfig` and relevant functions from `SafetyConfig.ts`
2. Accept `SafetyConfig` in constructor
3. For DROP operations, call `isDropAllowed()` first
4. For other operations, call `requiresApproval(type, config)`
5. Support dry-run mode by checking `config.enableDryRun`
6. Log all operations using `logOperation()` from `ApprovalHelper.ts`

## SQL Server Version Compatibility

The server automatically detects the SQL Server version on first connection and adapts syntax accordingly.

### Supported Versions

- **SQL Server 2008/2008 R2** (10.x) - Basic features
- **SQL Server 2012** (11.x) - Sequences, window functions, columnstore indexes, OFFSET/FETCH
- **SQL Server 2014** (12.x) - In-Memory OLTP
- **SQL Server 2016** (13.x) - DROP IF EXISTS, JSON, temporal tables, Always Encrypted
- **SQL Server 2017** (14.x) - STRING_AGG, graph database
- **SQL Server 2019** (15.x) - UTF-8 support
- **SQL Server 2022** (16.x) - JSON extensions

### Version Detection

Version detection happens automatically in `ensureSqlConnection()` (src/index.ts:247-260):
1. Connects to database
2. Executes `SELECT @@VERSION`
3. Parses version and determines capabilities
4. Stores in global `serverCapabilities`

Access capabilities via `getServerCapabilities()` from `index.ts`.

### Version-Aware Features

**DropTableTool:**
- Supports `DROP TABLE IF EXISTS` on SQL Server 2016+
- Falls back to standard `DROP TABLE` on older versions
- Warns user when IF EXISTS syntax is requested but not supported

**CreateTableTool:**
- Validates data types against server version
- Warns about JSON type on pre-2016 servers
- Warns about DATETIME2/DATE on pre-2008 servers
- Suggests alternative types for compatibility

### Adding Version Checks to New Tools

```typescript
import { getServerCapabilities } from "../index.js";

// In your tool's run method:
const capabilities = getServerCapabilities();

if (capabilities?.supportsJson) {
  // Use JSON type
} else {
  // Fall back to NVARCHAR(MAX)
}
```

See `ServerCapabilities.ts` for all available capability flags.

## Important Implementation Notes

- This is an ES module project (`"type": "module"` in package.json)
- All imports must use `.js` extension even for `.ts` files (TypeScript requirement for ES modules)
- The `shx chmod +x` step in build is critical for executable permissions
- Tool validation must happen before SQL execution to prevent security issues
- Error messages are sanitized to avoid information leakage (see ReadDataTool.ts:244-247)
- Safety configuration is loaded once on startup (src/index.ts:74-81)
- Each tool receives the safety config via constructor injection
- Server capabilities are detected on first database connection (src/index.ts:247-260)

### CRITICAL: Stdout vs Stderr for Logging

**NEVER use `console.log()` in this codebase - ALWAYS use `console.error()`**

MCP servers communicate via stdio using JSON-RPC protocol. The protocol works as follows:
- **stdout** = Reserved for JSON-RPC messages between MCP server and client
- **stderr** = For logging, debugging output, and human-readable messages

If you use `console.log()`, the output will:
1. Be written to stdout
2. Interfere with JSON-RPC messages
3. Break MCP Inspector and other MCP clients
4. Cause "SyntaxError: Unexpected token" errors when clients try to parse non-JSON output

**Always use:**
- `console.error()` for logging information
- `console.error()` for debugging output
- `console.error()` for version detection logs
- `console.error()` for any human-readable messages

This applies to:
- All files in `src/tools/`
- `src/index.ts`
- `src/ServerCapabilities.ts`
- Any new files you create

**Verification:** Run `grep -r "console\.log" src/` to ensure no console.log statements exist.
