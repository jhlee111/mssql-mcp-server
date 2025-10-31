# Testing Guide for MSSQL MCP Server

This guide covers different methods to test your MCP server tools.

## Method 1: MCP Inspector (Recommended)

The MCP Inspector is the official testing tool from Anthropic.

### Installation

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Or install globally:

```bash
npm install -g @modelcontextprotocol/inspector
mcp-inspector node dist/index.js
```

### Setup

1. **Set environment variables** before running:

```bash
# Windows (PowerShell)
$env:MSSQL_SERVER="your-server.database.windows.net"
$env:MSSQL_DATABASE="your-database"
$env:MSSQL_USER="your-username"
$env:MSSQL_PASSWORD="your-password"
$env:ALLOW_DANGEROUS_OPERATIONS="false"  # For safety during testing
$env:ENABLE_DRY_RUN="true"  # Preview operations

npx @modelcontextprotocol/inspector node dist/index.js
```

```bash
# macOS/Linux
export MSSQL_SERVER="your-server.database.windows.net"
export MSSQL_DATABASE="your-database"
export MSSQL_USER="your-username"
export MSSQL_PASSWORD="your-password"
export ALLOW_DANGEROUS_OPERATIONS="false"
export ENABLE_DRY_RUN="true"

npx @modelcontextprotocol/inspector node dist/index.js
```

2. **Open the Inspector** - Browser should open automatically at `http://localhost:5173`

3. **Test tools** using the Inspector UI:
   - See all available tools
   - View tool schemas
   - Call tools with custom parameters
   - See real-time responses

### Example Tests in Inspector

**Test 1: List Tables**
```json
{
  "name": "list_tables"
}
```

**Test 2: Create Table (Dry-Run)**
```json
{
  "name": "create_table",
  "arguments": {
    "tableName": "test_users",
    "columns": [
      {"name": "id", "type": "INT PRIMARY KEY"},
      {"name": "name", "type": "NVARCHAR(100)"},
      {"name": "email", "type": "NVARCHAR(255)"}
    ]
  }
}
```

**Test 3: Drop Table (Should be forbidden)**
```json
{
  "name": "drop_table",
  "arguments": {
    "tableName": "test_users"
  }
}
```
Expected: Forbidden message since `ALLOW_DANGEROUS_OPERATIONS=false`

**Test 4: Read Data**
```json
{
  "name": "read_data",
  "arguments": {
    "query": "SELECT TOP 5 * FROM your_table WHERE 1=1"
  }
}
```

## Method 2: Direct Testing with Node.js Script

Create a test script to call tools programmatically.

### Create Test Script

```bash
# Create test file
cat > test-mcp.js << 'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testMcpServer() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      MSSQL_SERVER: 'your-server.database.windows.net',
      MSSQL_DATABASE: 'your-database',
      MSSQL_USER: 'your-username',
      MSSQL_PASSWORD: 'your-password',
      ENABLE_DRY_RUN: 'true',
      ALLOW_DANGEROUS_OPERATIONS: 'false'
    }
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  });

  await client.connect(transport);

  console.log('Connected to MCP server');

  // Test 1: List tools
  console.log('\n=== Test 1: List Tools ===');
  const tools = await client.listTools();
  console.log('Available tools:', tools.tools.map(t => t.name));

  // Test 2: List tables
  console.log('\n=== Test 2: List Tables ===');
  const result = await client.callTool({
    name: 'list_tables',
    arguments: {}
  });
  console.log('Result:', result);

  // Test 3: Create table (dry-run)
  console.log('\n=== Test 3: Create Table (Dry-Run) ===');
  const createResult = await client.callTool({
    name: 'create_table',
    arguments: {
      tableName: 'test_table',
      columns: [
        { name: 'id', type: 'INT PRIMARY KEY' },
        { name: 'name', type: 'NVARCHAR(100)' }
      ]
    }
  });
  console.log('Result:', createResult);

  // Test 4: Try to drop table (should be forbidden)
  console.log('\n=== Test 4: Drop Table (Should be Forbidden) ===');
  try {
    const dropResult = await client.callTool({
      name: 'drop_table',
      arguments: { tableName: 'test_table' }
    });
    console.log('Result:', dropResult);
  } catch (error) {
    console.log('Error (expected):', error.message);
  }

  await client.close();
  console.log('\nTests completed!');
}

testMcpServer().catch(console.error);
EOF
```

### Install SDK and Run Test

```bash
npm install @modelcontextprotocol/sdk
node test-mcp.js
```

## Method 3: Test with Claude Desktop or VS Code

### Claude Desktop Testing

1. **Configure Claude Desktop** (see README.md for full config)

2. **Start a conversation** and test natural language:
   - "List all tables in my database"
   - "Create a test table with id and name columns"
   - "Show me the first 5 rows from the users table"
   - "Try to drop the test table" (should see forbidden message)

3. **Check the logs** at:
   - Windows: `%APPDATA%\Claude\logs\mcp-server-mssql.log`
   - macOS: `~/Library/Logs/Claude/mcp-server-mssql.log`

### VS Code Agent Testing

1. **Configure VS Code** (see README.md for full config)

2. **Open Command Palette** (Ctrl+Shift+P)

3. **Run "MCP: List Servers"** to verify server is configured

4. **Test through Agent**:
   - Open chat
   - Ask to interact with database
   - Monitor `.vscode/mcp.log` for debugging

## Method 4: Manual Integration Testing

### Test Safety Features

**Test Dry-Run Mode:**
```bash
# Set dry-run mode
export ENABLE_DRY_RUN="true"

# Run server and test - all operations should be previewed only
```

**Test Permission Levels:**
```bash
# Test 1: DROP forbidden (default)
export ALLOW_DANGEROUS_OPERATIONS="false"
# Try DROP operation - should see forbidden message

# Test 2: CREATE requires approval
export REQUIRE_APPROVAL_CREATE="true"
# Try CREATE operation - should see approval required message

# Test 3: Allow DROP with dry-run
export ALLOW_DANGEROUS_OPERATIONS="true"
export ENABLE_DRY_RUN="true"
# DROP should show preview
```

### Test Version Detection

**With SQL Server 2016+:**
```json
{
  "name": "drop_table",
  "arguments": {
    "tableName": "test",
    "ifExists": true
  }
}
```
Expected: Uses `DROP TABLE IF EXISTS`

**With SQL Server 2014:**
- Same test should fall back to standard `DROP TABLE`
- Should see warning about IF EXISTS not supported

**Test JSON Type Validation:**
```json
{
  "name": "create_table",
  "arguments": {
    "tableName": "test_json",
    "columns": [
      {"name": "id", "type": "INT PRIMARY KEY"},
      {"name": "data", "type": "JSON"}
    ]
  }
}
```
- SQL Server 2016+: Should work (maybe with dry-run preview)
- SQL Server 2014: Should warn about JSON type not supported

## Method 5: Check Operation Logs

After running operations, check the audit log:

```bash
cat logs/operations.log
```

Each line is a JSON object with operation details:
```json
{
  "timestamp": "2025-10-31T12:34:56.789Z",
  "operationType": "CREATE",
  "target": "test_table",
  "query": "CREATE TABLE [test_table] (id INT PRIMARY KEY)",
  "severity": "HIGH",
  "dryRun": true,
  "success": true
}
```

## Quick Test Checklist

- [ ] Server starts without errors
- [ ] Version detection works (check console output)
- [ ] List tables returns results
- [ ] Read data with SELECT query works
- [ ] Create table with dry-run shows preview
- [ ] Drop table is forbidden by default
- [ ] INSERT/UPDATE/DELETE work with dry-run
- [ ] Data type warnings appear for version-incompatible types
- [ ] Operations are logged to logs/operations.log
- [ ] IF EXISTS works on SQL Server 2016+ (or shows warning on older)

## Troubleshooting

**Server won't start:**
- Check environment variables are set correctly
- Verify MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD have MSSQL_ prefix
- Check database connection (can you connect with SQL Management Studio?)

**Tools not appearing:**
- Check if READONLY mode is enabled (limits available tools)
- Verify server compiled successfully (`npm run build`)

**Version detection not working:**
- Check database permissions (need SELECT permission on @@VERSION)
- Look for error messages in console
- Server falls back to SQL 2008 compatibility mode

**Operations not executing:**
- Check if ENABLE_DRY_RUN is set to true (operations are previewed only)
- Check if approval is required for the operation type
- For DROP, check if ALLOW_DANGEROUS_OPERATIONS is enabled

## Best Practices for Testing

1. **Always test with dry-run first**: `ENABLE_DRY_RUN=true`
2. **Use a test database**: Don't test on production data
3. **Keep DROP forbidden during testing**: `ALLOW_DANGEROUS_OPERATIONS=false`
4. **Review logs**: Check `logs/operations.log` after each test
5. **Test version-specific features**: Use IF EXISTS, JSON types, etc.
6. **Test safety blocks**: Verify approval requirements work as expected
