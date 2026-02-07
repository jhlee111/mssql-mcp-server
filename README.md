# MSSQL Database MCP  Server

<div align="center">
  <img src="./src/img/logo.png" alt="MSSQL Database MCP server logo" width="400"/>
</div>

## What is this? 🤔

This is a server that lets your LLMs (like Claude) talk directly to your MSSQL Database data! Think of it as a friendly translator that sits between your AI assistant and your database, making sure they can chat securely and efficiently.

### Quick Example
```text
You: "Show me all customers from New York"
Claude: *queries your MSSQL Database database and gives you the answer in plain English*
```

## How Does It Work? 🛠️

This server leverages the Model Context Protocol (MCP), a versatile framework that acts as a universal translator between AI models and databases. It supports multiple AI assistants including Claude Desktop and VS Code Agent.

### What Can It Do? 📊

- Run MSSQL Database queries by just asking questions in plain English
- Create, read, update, and delete data
- **Execute stored procedures** with parameterized inputs
- Manage database schema (tables, indexes)
- **Dry-run confirmation flow** — preview operations before executing, then confirm with a token
- **MCP Elicitation support** — interactive human approval when the client supports it
- Secure connection handling
- Real-time data interaction

## Quick Start 🚀

### Prerequisites
- Node.js 14 or higher
- Claude Desktop or VS Code with Agent extension
- GitHub account with Personal Access Token for package access

### Installation

#### Option 1: Install from GitHub Packages

1. **Create a GitHub Personal Access Token**
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Create a token with `read:packages` scope
   - Save the token securely

2. **Configure npm for GitHub Packages**
   ```bash
   echo "@jhlee111:registry=https://npm.pkg.github.com" >> ~/.npmrc
   echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> ~/.npmrc
   ```

3. **Install the package**
   ```bash
   npm install @jhlee111/mssql-mcp-server
   ```

#### Option 2: Install from Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/jhlee111/mssql-mcp-server.git
   cd mssql-mcp-server
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build the Project**
   ```bash
   npm run build
   ```

## Configuration Setup

### Option 1: VS Code Agent Setup

1. **Install VS Code Agent Extension**
   - Open VS Code
   - Go to Extensions (Ctrl+Shift+X)
   - Search for "Agent" and install the official Agent extension

2. **Create MCP Configuration File**
   - Create a `.vscode/mcp.json` file in your workspace
   - Add the following configuration:

   ```json
   {
     "servers": {
       "mssql-nodejs": {
          "type": "stdio",
          "command": "node",
          "args": ["q:\\Repos\\SQL-AI-samples\\MssqlMcp\\Node\\dist\\index.js"],
          "env": {
            "SERVER_NAME": "your-server-name.database.windows.net",
            "DATABASE_NAME": "your-database-name",
            "SQL_USER": "your-sql-username",
            "SQL_PASSWORD": "your-sql-password",
            "READONLY": "false"
          }
        }
      }
   }
   ```

3. **Alternative: User Settings Configuration**
   - Open VS Code Settings (Ctrl+,)
   - Search for "mcp"
   - Click "Edit in settings.json"
   - Add the following configuration:

  ```json
   {
    "mcp": {
        "servers": {
            "mssql": {
                "command": "node",
                "args": ["C:/path/to/your/Node/dist/index.js"],
                "env": {
                "SERVER_NAME": "your-server-name.database.windows.net",
                "DATABASE_NAME": "your-database-name",
                "SQL_USER": "your-sql-username",
                "SQL_PASSWORD": "your-sql-password",
                "READONLY": "false"
                }
            }
        }
    }
  }
  ```

4. **Restart VS Code**
   - Close and reopen VS Code for the changes to take effect

5. **Verify MCP Server**
   - Open Command Palette (Ctrl+Shift+P)
   - Run "MCP: List Servers" to verify your server is configured
   - You should see "mssql" in the list of available servers

### Option 2: Claude Desktop Setup

1. **Open Claude Desktop Settings**
   - Navigate to File → Settings → Developer → Edit Config
   - Open the `claude_desktop_config` file

2. **Add MCP Server Configuration**
   Replace the content with the configuration below, updating the path and credentials:

   ```json
   {
     "mcpServers": {
       "mssql": {
         "command": "node",
         "args": ["C:/path/to/your/Node/dist/index.js"],
         "env": {
           "SERVER_NAME": "your-server-name.database.windows.net",
           "DATABASE_NAME": "your-database-name",
           "SQL_USER": "your-sql-username",
           "SQL_PASSWORD": "your-sql-password",
           "READONLY": "false"
         }
       }
     }
   }
   ```

3. **Restart Claude Desktop**
   - Close and reopen Claude Desktop for the changes to take effect

### Configuration Parameters

#### Required Database Connection Parameters

- **MSSQL_SERVER**: Your MSSQL server name (e.g., `my-server.database.windows.net` for Azure SQL, or `localhost` for local SQL Server)
- **MSSQL_DATABASE**: Your database name
- **MSSQL_USER**: SQL Server username for authentication
- **MSSQL_PASSWORD**: SQL Server password for authentication

#### Optional Connection Parameters

- **READONLY**: Set to `"true"` to restrict to read-only operations, `"false"` for full access
- **MSSQL_CONNECTION_TIMEOUT**: Connection timeout in seconds. Defaults to `30` if not set
- **MSSQL_TRUST_SERVER_CERTIFICATE**: Set to `"true"` to trust self-signed server certificates (useful for development). Defaults to `"false"`

#### Safety Configuration Parameters (New!)

These parameters control approval requirements and operational safety:

**STORED PROCEDURE EXECUTION:**

- **ALLOW_EXEC_PROCEDURE**: Allow stored procedure execution via the `exec_procedure` tool (default: `false` - DISABLED)
  - Stored procedures can read and modify data, so this requires explicit opt-in
  - Set to `true` to enable the `exec_procedure` tool

**DANGEROUS OPERATIONS (DROP):**

- **ALLOW_DANGEROUS_OPERATIONS**: Allow DROP operations (default: `false` - FORBIDDEN)
  - DROP operations are **FORBIDDEN by default** for maximum safety
  - Must explicitly set to `true` to enable DROP TABLE/INDEX operations
  - **⚠️ CRITICAL WARNING**: DROP operations permanently delete tables/indexes and all their data
  - Even when enabled, use with `ENABLE_DRY_RUN=true` to preview before executing

**REGULAR OPERATIONS APPROVAL:**

- **REQUIRE_APPROVAL_CREATE**: Require approval for CREATE operations (default: `false`)
  - When `true`, CREATE TABLE operations are blocked until explicitly enabled
  - Set to `false` to allow CREATE operations

- **REQUIRE_APPROVAL_UPDATE**: Require approval for UPDATE operations (default: `false`)
  - When `true`, UPDATE operations are blocked until explicitly enabled
  - Set to `false` to allow UPDATE operations

- **REQUIRE_APPROVAL_DELETE**: Require approval for DELETE operations (default: `false`)
  - When `true`, DELETE (row removal) operations are blocked until explicitly enabled
  - Set to `false` to allow DELETE operations
  - **Note**: DELETE removes rows, DROP removes entire tables (different operations!)

- **REQUIRE_APPROVAL_INSERT**: Require approval for INSERT operations (default: `false`)
  - When `true`, INSERT operations are blocked until explicitly enabled
  - Set to `false` to allow INSERT operations

**DRY-RUN AND LOGGING:**

- **ENABLE_DRY_RUN**: Enable dry-run mode for all destructive operations (default: `false`)
  - When `true`, all CREATE, DROP, UPDATE, DELETE, INSERT, and EXEC operations return a preview with a **confirmation token**
  - The caller can re-invoke the same tool with the same parameters plus `confirmToken` to execute
  - Shows the exact SQL query, estimated impact, and row count estimates (for UPDATE/DELETE)
  - Essential for testing and understanding what the LLM intends to do before execution
  - **Recommended**: Always enable for DROP operations even when `ALLOW_DANGEROUS_OPERATIONS=true`

- **DRY_RUN_TTL_SECONDS**: TTL for confirmation tokens in seconds (default: `300` = 5 minutes)
  - Tokens are single-use and expire after this duration
  - Set to a shorter value for tighter security

- **OPERATION_LOG_DIR**: Directory for operation logs (default: `./logs`)
  - All destructive operations are automatically logged to `operations.log` in this directory
  - Logs include timestamp, operation type, severity, SQL query, and success/failure status
  - Provides audit trail for compliance and debugging

#### Path Configuration

- **Path**: Update the path in `args` to point to your actual project location (absolute path to `dist/index.js`)

### Authentication Methods

This MCP server has been modified to support SQL Server authentication (username/password). 

**Original Source**: The original implementation from [Microsoft SQL-AI-samples repository](https://github.com/microsoft/SQL-AI-samples) uses Azure Active Directory (AAD) authentication with `InteractiveBrowserCredential`.

**Current Modification**: This version has been modified to use SQL Server authentication for broader compatibility:
- Removed Azure AD dependency (`@azure/identity`)
- Changed from token-based authentication to username/password authentication
- Added `SQL_USER` and `SQL_PASSWORD` environment variables
- Simplified connection pooling without token refresh logic

To revert to Azure AD authentication, you would need to:
1. Re-add the `@azure/identity` package
2. Restore the `InteractiveBrowserCredential` or `DefaultAzureCredential` in `index.ts`
3. Remove `SQL_USER` and `SQL_PASSWORD` from configuration
4. Restore the token-based authentication configuration

## Sample Configurations

You can find sample configuration files in the `src/samples/` folder:
- `claude_desktop_config.json` - For Claude Desktop
- `vscode_agent_config.json` - For VS Code Agent

## SQL Server Version Support

The MCP server **automatically detects** your SQL Server version and adapts its syntax accordingly. It supports:

- **SQL Server 2008/2008 R2** (10.x) and later
- **SQL Server 2012** (11.x) - Adds sequences, window functions, OFFSET/FETCH
- **SQL Server 2014** (12.x) - Adds In-Memory OLTP
- **SQL Server 2016** (13.x) - Adds DROP IF EXISTS, JSON type, temporal tables
- **SQL Server 2017** (14.x) - Adds STRING_AGG, graph database
- **SQL Server 2019** (15.x) - Adds UTF-8 support
- **SQL Server 2022** (16.x) - Adds JSON extensions

### Version-Aware Features

**Automatic Syntax Adaptation:**
- `DROP TABLE IF EXISTS` on SQL Server 2016+ (falls back to standard DROP on older versions)
- Data type validation (warns if JSON type used on pre-2016)
- Feature availability warnings

**On First Connection:**
```
Detected SQL Server version: Microsoft SQL Server 2019 (RTM) - 15.0.2000.5
Server capabilities detected: {
  version: 'SQL Server 2019',
  dropIfExists: true,
  json: true,
  stringAgg: true
}
```

### Compatibility Notes

The LLM will automatically:
- Use version-appropriate syntax
- Warn about unsupported features
- Suggest alternatives for older versions

For example, if you ask to create a table with JSON column on SQL Server 2014:
```
⚠️  Data Type Warnings:
  - Column 'data': JSON type requires SQL Server 2016+.
    Current: SQL Server 2014. Consider using NVARCHAR(MAX) instead.
```

## Usage Examples

Once configured, you can interact with your database using natural language:

- "Show me all users from New York"
- "Create a new table called products with columns for id, name, and price"
- "Update all pending orders to completed status"
- "List all tables in the database"
- "Drop the temp_data table if it exists" (uses IF EXISTS on SQL Server 2016+)

## Stored Procedure Execution

The `exec_procedure` tool allows executing stored procedures with parameterized inputs. It requires explicit opt-in via `ALLOW_EXEC_PROCEDURE=true`.

### Usage

```text
You: "Run the annual income report for 2025"
Claude: *calls exec_procedure with the appropriate SP and parameters*
```

### Parameters

- **procedureName** (required): The stored procedure name, optionally with schema prefix (e.g., `qb.up_QbAnuualIncome_since2018_forSTI` or `up_SomeProcedure`)
- **parameters** (optional): Key-value pairs of input parameters (e.g., `{ "year": "2025", "orgCd": "N20110" }`)

### Security

- Procedure names are validated against strict patterns (word characters only, optional schema prefix)
- Parameters are passed via parameterized inputs (SQL injection safe)
- Gated by `ALLOW_EXEC_PROCEDURE` environment variable (default: disabled)

## Dry-Run Confirmation Flow

When `ENABLE_DRY_RUN=true`, destructive operations use a **two-phase confirmation flow** instead of simply blocking execution:

### Phase 1: Preview

All destructive operations (INSERT, UPDATE, DELETE, CREATE, DROP, EXEC) return a preview with a **confirmation token**:

```json
{
  "mode": "preview",
  "success": true,
  "message": "DRY RUN PREVIEW - MEDIUM OPERATION\n...\nTo execute, call the same tool again with confirmToken",
  "dryRun": true,
  "confirmToken": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### Phase 2: Confirm

Re-invoke the same tool with the same parameters plus the `confirmToken` to execute:

```json
{
  "mode": "executed",
  "success": true,
  "message": "Stored procedure executed successfully. 1 result set(s), 901 total record(s).",
  "data": [ ... ],
  "rowsAffected": [0]
}
```

### Token Security

- Tokens are **single-use** — consumed on first successful validation
- Tokens **expire** after 5 minutes (configurable via `DRY_RUN_TTL_SECONDS`)
- Tokens are **bound to exact parameters** — SHA-256 hash of query and params must match
- Maximum **100 pending tokens** in memory with oldest-first eviction
- Server restart invalidates all pending tokens

### MCP Elicitation (Interactive Approval)

When the MCP client supports elicitation (e.g., future Claude Code versions), the server automatically upgrades to **interactive human approval**:

1. The tool pauses mid-execution and presents the SQL to the human user directly
2. The user approves or declines in their terminal
3. The LLM is structurally excluded from the approval path

This activates automatically when the client advertises elicitation support. Falls back to token-based confirmation otherwise. No configuration needed.

### Response Mode Field

All destructive tool responses include a `mode` field for programmatic handling:

| Mode | Meaning |
|---|---|
| `preview` | Dry-run preview with confirmation token |
| `executed` | Operation was executed successfully |
| `confirmation_failed` | Token validation failed (expired, used, params changed) |
| `error` | Execution error |
| `approval_required` | Blocked by approval config |
| `forbidden` | Operation forbidden (e.g., DROP without ALLOW_DANGEROUS_OPERATIONS) |

## Safety and Security Features

### Built-in Security

- The server requires a WHERE clause for read operations to prevent accidental full table scans
- Update operations require explicit WHERE clauses for security
- Set `READONLY: "true"` in production environments if you only need read access
- Extensive SQL injection protection in ReadDataTool with keyword blocking and pattern detection

### Safety System (New!)

The MCP server includes a comprehensive safety system with special protection for destructive operations:

#### 1. DROP Operations - FORBIDDEN by Default

DROP operations are **FORBIDDEN** unless explicitly enabled:
```json
{
  "env": {
    "ALLOW_DANGEROUS_OPERATIONS": "false"  // Default - DROP is FORBIDDEN
  }
}
```

When attempted, the LLM receives:
```
🔴 DANGEROUS OPERATION FORBIDDEN
============================================================

DROP operations are FORBIDDEN by default for safety.

Operation Type: DROP
Target: users_table

⛔ WARNING: Enabling dangerous operations can lead to permanent data loss!
```

**To enable DROP (use with extreme caution):**
```json
{
  "env": {
    "ALLOW_DANGEROUS_OPERATIONS": "true",  // Enable DROP operations
    "ENABLE_DRY_RUN": "true"               // ALWAYS preview DROP first!
  }
}
```

#### 2. DELETE vs DROP - Important Distinction

- **DELETE** = Removes rows from a table (data operation) - configurable approval
- **DROP** = Removes entire table/index (schema change) - FORBIDDEN by default

```json
{
  "env": {
    "REQUIRE_APPROVAL_DELETE": "true",  // Control row deletion
    "ALLOW_DANGEROUS_OPERATIONS": "false"  // DROP still forbidden
  }
}
```

#### 3. Dry-Run Mode

Test what the LLM wants to do without making any changes:
```json
{
  "env": {
    "ENABLE_DRY_RUN": "true"  // Preview all operations without executing
  }
}
```

Example dry-run output:
```
🔴 DRY RUN PREVIEW - CRITICAL OPERATION
============================================================

Operation Type: DROP
Target: users_table

SQL Query:
DROP TABLE [users_table]

Estimated Impact:
This will permanently delete the table and all its data.

============================================================
⚠️  This is a DRY RUN. No changes have been made to the database.
To execute this operation, call the same tool again with "confirmToken": "a1b2c3d4-..."
```

#### 4. Operation Logging

All destructive operations are automatically logged to `./logs/operations.log`:
```json
{
  "timestamp": "2025-10-31T12:34:56.789Z",
  "operationType": "DROP",
  "target": "users_table",
  "query": "DROP TABLE [users_table]",
  "severity": "CRITICAL",
  "dryRun": false,
  "success": true
}
```

### Recommended Safety Configurations

**Development/Testing:**
```json
{
  "env": {
    "ENABLE_DRY_RUN": "true",                  // Preview everything first
    "ALLOW_DANGEROUS_OPERATIONS": "false",     // Keep DROP forbidden
    "REQUIRE_APPROVAL_CREATE": "false",        // Allow CREATE for testing
    "REQUIRE_APPROVAL_DELETE": "false",        // Allow DELETE for testing
    "REQUIRE_APPROVAL_UPDATE": "false",        // Allow UPDATE for testing
    "OPERATION_LOG_DIR": "./logs"              // Local logging
  }
}
```

**Production (Safest):**
```json
{
  "env": {
    "READONLY": "true"  // Only allow read operations
  }
}
```

**Production (With Write Access, Maximum Safety):**
```json
{
  "env": {
    "READONLY": "false",
    "ALLOW_DANGEROUS_OPERATIONS": "false",     // DROP forbidden
    "REQUIRE_APPROVAL_CREATE": "true",         // Block CREATE
    "REQUIRE_APPROVAL_DELETE": "true",         // Block DELETE
    "REQUIRE_APPROVAL_UPDATE": "false",        // Allow UPDATE (has WHERE requirement)
    "REQUIRE_APPROVAL_INSERT": "false",        // Allow INSERT
    "OPERATION_LOG_DIR": "/var/log/mcp"        // Centralized logging
  }
}
```

**Production (Allow DROP with extreme caution):**
```json
{
  "env": {
    "READONLY": "false",
    "ALLOW_DANGEROUS_OPERATIONS": "true",      // ⚠️ Enable DROP
    "ENABLE_DRY_RUN": "true",                  // ⚠️ ALWAYS preview first!
    "REQUIRE_APPROVAL_CREATE": "false",
    "REQUIRE_APPROVAL_DELETE": "false",
    "OPERATION_LOG_DIR": "/var/log/mcp"
  }
}
```

You should now have successfully configured the MCP server for MSSQL Database with your preferred AI assistant. This setup allows you to seamlessly interact with MSSQL Database through natural language queries with robust safety protections!

## Testing Your MCP Server

Before using the server in production, it's recommended to test it thoroughly.

### Quick Test with MCP Inspector

The easiest way to test is using the official MCP Inspector:

```bash
# Set environment variables first
export MSSQL_SERVER="your-server.database.windows.net"
export MSSQL_DATABASE="your-database"
export MSSQL_USER="your-username"
export MSSQL_PASSWORD="your-password"
export ENABLE_DRY_RUN="true"  # Safe testing mode

# Run inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

The Inspector will open in your browser where you can:
- See all available tools
- Test tools with custom parameters
- View real-time responses
- Debug issues

### Testing Checklist

- [ ] Server starts without errors
- [ ] Version detection works (check console output)
- [ ] List tables returns results
- [ ] DROP operations are forbidden by default
- [ ] Dry-run mode shows operation previews with confirmation tokens
- [ ] Confirmation tokens allow execution when replayed with same params
- [ ] Expired/reused tokens are rejected
- [ ] `exec_procedure` tool works with stored procedures
- [ ] Operations are logged to `logs/operations.log`

For detailed testing procedures, see **[TESTING.md](TESTING.md)** which covers:
- MCP Inspector usage
- Manual testing with Node.js scripts
- Testing with Claude Desktop/VS Code
- Safety feature testing
- Version compatibility testing
- Troubleshooting common issues
