#!/usr/bin/env node

// External imports
import * as dotenv from "dotenv";
import sql from "mssql";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Internal imports
import { UpdateDataTool } from "./tools/UpdateDataTool.js";
import { InsertDataTool } from "./tools/InsertDataTool.js";
import { ReadDataTool } from "./tools/ReadDataTool.js";
import { CreateTableTool } from "./tools/CreateTableTool.js";
import { CreateIndexTool } from "./tools/CreateIndexTool.js";
import { ListTableTool } from "./tools/ListTableTool.js";
import { DropTableTool } from "./tools/DropTableTool.js";
import { DescribeTableTool } from "./tools/DescribeTableTool.js";

// MSSQL Database connection configuration

// Environment variable configuration
const ENV_PREFIX = "MSSQL_"; // Required prefix for all database-related env variables
const REQUIRED_ENV_VARS = [
  "MSSQL_SERVER",
  "MSSQL_DATABASE",
  "MSSQL_USER",
  "MSSQL_PASSWORD"
];

// Load and validate environment variables
dotenv.config();

// Function to validate environment variables have proper prefix
function validateEnvVariables(): void {
  const errors: string[] = [];

  // Check for required variables
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }

  // Check that all MSSQL-related env variables use the correct prefix
  const dbRelatedVars = [
    "SERVER_NAME", "DATABASE_NAME", "SQL_USER", "SQL_PASSWORD",
    "TRUST_SERVER_CERTIFICATE", "CONNECTION_TIMEOUT"
  ];

  for (const oldVar of dbRelatedVars) {
    if (process.env[oldVar]) {
      errors.push(`Environment variable '${oldVar}' should be prefixed as 'MSSQL_${oldVar}'`);
    }
  }

  if (errors.length > 0) {
    console.error("Environment variable validation errors:");
    errors.forEach(err => console.error(`  - ${err}`));
    console.error("\nPlease update your .env file to use the MSSQL_ prefix for all database-related variables.");
    console.error("Example: MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD");
    process.exit(1);
  }
}

// Validate environment variables on startup
validateEnvVariables();

// Globals for connection reuse
let globalSqlPool: sql.ConnectionPool | null = null;

// Function to create SQL config with SQL authentication
export async function createSqlConfig(): Promise<sql.config> {
  const trustServerCertificate = process.env.MSSQL_TRUST_SERVER_CERTIFICATE?.toLowerCase() === 'true';
  const connectionTimeout = process.env.MSSQL_CONNECTION_TIMEOUT ? parseInt(process.env.MSSQL_CONNECTION_TIMEOUT, 10) : 30;

  // All required env vars are already validated in validateEnvVariables()
  return {
    server: process.env.MSSQL_SERVER!,
    database: process.env.MSSQL_DATABASE!,
    user: process.env.MSSQL_USER!,
    password: process.env.MSSQL_PASSWORD!,
    options: {
      encrypt: false,
      trustServerCertificate
    },
    connectionTimeout: connectionTimeout * 1000, // convert seconds to milliseconds
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}

const updateDataTool = new UpdateDataTool();
const insertDataTool = new InsertDataTool();
const readDataTool = new ReadDataTool();
const createTableTool = new CreateTableTool();
const createIndexTool = new CreateIndexTool();
const listTableTool = new ListTableTool();
const dropTableTool = new DropTableTool();
const describeTableTool = new DescribeTableTool();

const server = new Server(
  {
    name: "mssql-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Read READONLY env variable
const isReadOnly = process.env.READONLY === "true";

// Request handlers

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: isReadOnly
    ? [listTableTool, readDataTool, describeTableTool] // todo: add searchDataTool to the list of tools available in readonly mode once implemented
    : [insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool], // add all new tools here
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case insertDataTool.name:
        result = await insertDataTool.run(args);
        break;
      case readDataTool.name:
        result = await readDataTool.run(args);
        break;
      case updateDataTool.name:
        result = await updateDataTool.run(args);
        break;
      case createTableTool.name:
        result = await createTableTool.run(args);
        break;
      case createIndexTool.name:
        result = await createIndexTool.run(args);
        break;
      case listTableTool.name:
        result = await listTableTool.run(args);
        break;
      case dropTableTool.name:
        result = await dropTableTool.run(args);
        break;
      case describeTableTool.name:
        if (!args || typeof args.tableName !== "string") {
          return {
            content: [{ type: "text", text: `Missing or invalid 'tableName' argument for describe_table tool.` }],
            isError: true,
          };
        }
        result = await describeTableTool.run(args as { tableName: string });
        break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error occurred: ${error}` }],
      isError: true,
    };
  }
});

// Server startup
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Fatal error running server:", error);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});

// Connect to SQL only when handling a request

async function ensureSqlConnection() {
  // If we have a pool and it's connected, reuse it
  if (globalSqlPool && globalSqlPool.connected) {
    return;
  }

  // Otherwise, create a new connection
  const config = await createSqlConfig();

  // Close old pool if exists
  if (globalSqlPool) {
    try {
      await globalSqlPool.close();
    } catch (err) {
      // Ignore close errors
    }
  }

  globalSqlPool = await sql.connect(config);
}

// Patch all tool handlers to ensure SQL connection before running
function wrapToolRun(tool: { run: (...args: any[]) => Promise<any> }) {
  const originalRun = tool.run.bind(tool);
  tool.run = async function (...args: any[]) {
    await ensureSqlConnection();
    return originalRun(...args);
  };
}

[insertDataTool, readDataTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool, describeTableTool].forEach(wrapToolRun);