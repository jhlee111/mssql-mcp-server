/**
 * SQL Server version detection and capability management
 *
 * This module detects the SQL Server version and provides information
 * about which features are supported in that version.
 */

import sql from "mssql";

export interface ServerVersion {
  major: number;
  minor: number;
  build: number;
  revision: number;
  fullVersion: string;
  productName: string;
}

export interface ServerCapabilities {
  version: ServerVersion;

  // SQL Server 2008 R2 (10.50) features
  supportsBasicFeatures: boolean;

  // SQL Server 2012 (11.x) features
  supportsSequences: boolean;
  supportsWindowFunctions: boolean;
  supportsColumnstoreIndexes: boolean;
  supportsOffset: boolean; // OFFSET/FETCH

  // SQL Server 2014 (12.x) features
  supportsInMemoryOLTP: boolean;

  // SQL Server 2016 (13.x) features
  supportsDropIfExists: boolean;
  supportsJson: boolean;
  supportsStringAgg: boolean; // Actually SQL Server 2017
  supportsTemporal: boolean; // System-versioned temporal tables
  supportsAlwaysEncrypted: boolean;

  // SQL Server 2017 (14.x) features
  supportsGraphDb: boolean;
  supportsStringAggActual: boolean; // STRING_AGG function

  // SQL Server 2019 (15.x) features
  supportsUtf8: boolean;

  // SQL Server 2022 (16.x) features
  supportsJsonExtensions: boolean;
}

/**
 * Parse SQL Server version string
 * Format: "Microsoft SQL Server 2019 (RTM) - 15.0.2000.5..."
 */
export function parseVersion(versionString: string): ServerVersion {
  // Try to extract version numbers from various formats
  const versionMatch = versionString.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);

  if (versionMatch) {
    return {
      major: parseInt(versionMatch[1], 10),
      minor: parseInt(versionMatch[2], 10),
      build: parseInt(versionMatch[3], 10),
      revision: parseInt(versionMatch[4], 10),
      fullVersion: versionMatch[0],
      productName: extractProductName(versionString)
    };
  }

  // Fallback to safe defaults (SQL Server 2008)
  console.warn('Could not parse SQL Server version, assuming SQL Server 2008');
  return {
    major: 10,
    minor: 0,
    build: 0,
    revision: 0,
    fullVersion: '10.0.0.0',
    productName: 'SQL Server 2008 (assumed)'
  };
}

function extractProductName(versionString: string): string {
  // Extract product name like "SQL Server 2019"
  const nameMatch = versionString.match(/Microsoft SQL Server (\d{4})/);
  if (nameMatch) {
    return `SQL Server ${nameMatch[1]}`;
  }

  // Try to infer from major version
  const versionMatch = versionString.match(/(\d+)\.\d+\.\d+\.\d+/);
  if (versionMatch) {
    const major = parseInt(versionMatch[1], 10);
    const yearMap: { [key: number]: string } = {
      16: 'SQL Server 2022',
      15: 'SQL Server 2019',
      14: 'SQL Server 2017',
      13: 'SQL Server 2016',
      12: 'SQL Server 2014',
      11: 'SQL Server 2012',
      10: 'SQL Server 2008/2008 R2',
      9: 'SQL Server 2005',
    };
    return yearMap[major] || `SQL Server (version ${major}.x)`;
  }

  return 'SQL Server (unknown version)';
}

/**
 * Determine server capabilities based on version
 */
export function determineCapabilities(version: ServerVersion): ServerCapabilities {
  const major = version.major;
  const minor = version.minor;

  return {
    version,

    // SQL Server 2008 R2 (10.50) and later
    supportsBasicFeatures: major >= 10,

    // SQL Server 2012 (11.x) and later
    supportsSequences: major >= 11,
    supportsWindowFunctions: major >= 11,
    supportsColumnstoreIndexes: major >= 11,
    supportsOffset: major >= 11,

    // SQL Server 2014 (12.x) and later
    supportsInMemoryOLTP: major >= 12,

    // SQL Server 2016 (13.x) and later
    supportsDropIfExists: major >= 13,
    supportsJson: major >= 13,
    supportsTemporal: major >= 13,
    supportsAlwaysEncrypted: major >= 13,
    supportsStringAgg: major >= 14, // Actually 2017

    // SQL Server 2017 (14.x) and later
    supportsGraphDb: major >= 14,
    supportsStringAggActual: major >= 14,

    // SQL Server 2019 (15.x) and later
    supportsUtf8: major >= 15,

    // SQL Server 2022 (16.x) and later
    supportsJsonExtensions: major >= 16,
  };
}

/**
 * Detect SQL Server version and capabilities
 */
export async function detectServerCapabilities(): Promise<ServerCapabilities> {
  try {
    const request = new sql.Request();
    const result = await request.query('SELECT @@VERSION AS version');

    if (result.recordset && result.recordset.length > 0) {
      const versionString = result.recordset[0].version;
      console.error('Detected SQL Server version:', versionString);

      const version = parseVersion(versionString);
      const capabilities = determineCapabilities(version);

      console.error('Server capabilities:', {
        productName: version.productName,
        version: version.fullVersion,
        supportsDropIfExists: capabilities.supportsDropIfExists,
        supportsJson: capabilities.supportsJson,
        supportsStringAgg: capabilities.supportsStringAggActual
      });

      return capabilities;
    }
  } catch (error) {
    console.error('Error detecting SQL Server version:', error);
  }

  // Return safe defaults for SQL Server 2008
  console.warn('Using default capabilities for SQL Server 2008');
  return determineCapabilities({
    major: 10,
    minor: 0,
    build: 0,
    revision: 0,
    fullVersion: '10.0.0.0',
    productName: 'SQL Server 2008 (default)'
  });
}

/**
 * Generate a capability warning message for unsupported features
 */
export function generateCapabilityWarning(
  featureName: string,
  requiredVersion: string,
  currentVersion: string
): string {
  return `⚠️  Feature '${featureName}' requires ${requiredVersion} or later.\n` +
         `Current server: ${currentVersion}\n` +
         `This operation may fail or produce unexpected results.`;
}
