import {
	ExecuteStatementCommand,
	type Field,
	type RDSDataClient,
} from "@aws-sdk/client-rds-data";
import { createRdsDataClient } from "./aws";
import type { DatabaseConfig, QueryResult } from "./types";

function fieldToValue(field: Field): unknown {
	if (field.stringValue !== undefined) return field.stringValue;
	if (field.longValue !== undefined) return field.longValue;
	if (field.doubleValue !== undefined) return field.doubleValue;
	if (field.booleanValue !== undefined) return field.booleanValue;
	if (field.isNull) return null;
	if (field.blobValue !== undefined) return field.blobValue;
	return null;
}

export async function executeQuery(
	client: RDSDataClient,
	resourceArn: string,
	database: string,
	sql: string,
	secretArn?: string,
	username?: string,
	password?: string,
): Promise<QueryResult> {
	if (!secretArn && (!username || !password)) {
		throw new Error(
			"Either secretArn or both username and password must be provided. " +
				"Note: RDS Data API requires a Secrets Manager ARN for authentication.",
		);
	}

	if (!secretArn) {
		throw new Error(
			"RDS Data API requires a Secrets Manager secret ARN for authentication. " +
				"Please create a secret in AWS Secrets Manager with your database credentials.",
		);
	}

	const params = {
		resourceArn,
		secretArn,
		database,
		sql,
	};

	try {
		const command = new ExecuteStatementCommand(params);
		const response = await client.send(command);

		const columns: string[] = [];
		const rows: Array<Record<string, unknown>> = [];

		if (response.columnMetadata && response.records) {
			response.columnMetadata.forEach((col) => {
				if (col.name) {
					columns.push(col.name);
				}
			});

			response.records.forEach((record) => {
				const row: Record<string, unknown> = {};
				record.forEach((field, index) => {
					if (columns[index]) {
						row[columns[index]] = fieldToValue(field);
					}
				});
				rows.push(row);
			});
		}

		return {
			columns,
			rows,
			numberOfRecordsUpdated: response.numberOfRecordsUpdated,
		};
	} catch (error) {
		throw new Error(`Query execution failed: ${error}`);
	}
}

export async function testConnection(config: DatabaseConfig): Promise<boolean> {
	const client = createRdsDataClient(config);

	try {
		await executeQuery(
			client,
			config.resourceArn,
			config.database,
			"SELECT 1 as test",
			config.secretArn,
			config.username,
			config.password,
		);
		return true;
	} catch (error) {
		throw new Error(`Connection test failed: ${error}`);
	}
}
