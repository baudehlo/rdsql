export interface DatabaseConfig {
  profile?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region: string;
  resourceArn: string;
  secretArn?: string;
  database: string;
  username?: string;
  password?: string;
}

export interface AppConfig {
  databases: Record<string, DatabaseConfig>;
  current?: string;
}

export type OutputFormat = 'csv' | 'html' | 'json' | 'text';

export interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  numberOfRecordsUpdated?: number;
}
