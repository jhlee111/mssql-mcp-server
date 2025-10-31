#!/bin/bash

# Quick test script for MSSQL MCP Server
# Usage: ./test-server.sh

echo "🧪 MSSQL MCP Server - Quick Test Script"
echo "========================================"
echo ""

# Check if environment variables are set
if [ -z "$MSSQL_SERVER" ] || [ -z "$MSSQL_DATABASE" ] || [ -z "$MSSQL_USER" ] || [ -z "$MSSQL_PASSWORD" ]; then
    echo "❌ Error: Required environment variables not set"
    echo ""
    echo "Please set the following environment variables:"
    echo "  export MSSQL_SERVER='your-server.database.windows.net'"
    echo "  export MSSQL_DATABASE='your-database'"
    echo "  export MSSQL_USER='your-username'"
    echo "  export MSSQL_PASSWORD='your-password'"
    echo ""
    echo "Optional (for safe testing):"
    echo "  export ENABLE_DRY_RUN='true'"
    echo "  export ALLOW_DANGEROUS_OPERATIONS='false'"
    exit 1
fi

# Check if dist folder exists
if [ ! -d "dist" ]; then
    echo "⚠️  dist folder not found. Building project..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "❌ Build failed"
        exit 1
    fi
fi

# Set safe defaults for testing
export ENABLE_DRY_RUN="${ENABLE_DRY_RUN:-true}"
export ALLOW_DANGEROUS_OPERATIONS="${ALLOW_DANGEROUS_OPERATIONS:-false}"

echo "Configuration:"
echo "  Server: $MSSQL_SERVER"
echo "  Database: $MSSQL_DATABASE"
echo "  Dry-Run: $ENABLE_DRY_RUN"
echo "  Allow Dangerous Ops: $ALLOW_DANGEROUS_OPERATIONS"
echo ""

# Check if MCP Inspector is available
if command -v mcp-inspector &> /dev/null; then
    echo "✅ MCP Inspector found"
    echo ""
    echo "Starting MCP Inspector..."
    echo "Browser will open automatically at http://localhost:5173"
    echo ""
    mcp-inspector node dist/index.js
elif npx --yes @modelcontextprotocol/inspector --version &> /dev/null; then
    echo "✅ MCP Inspector available via npx"
    echo ""
    echo "Starting MCP Inspector..."
    echo "Browser will open automatically at http://localhost:5173"
    echo ""
    npx @modelcontextprotocol/inspector node dist/index.js
else
    echo "ℹ️  MCP Inspector not found, but you can still test manually"
    echo ""
    echo "To install MCP Inspector:"
    echo "  npm install -g @modelcontextprotocol/inspector"
    echo ""
    echo "Or run with npx:"
    echo "  npx @modelcontextprotocol/inspector node dist/index.js"
    echo ""
    echo "Starting server in test mode..."
    node dist/index.js
fi
