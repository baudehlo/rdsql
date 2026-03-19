#!/usr/bin/env node

import { Command } from "commander";
import { createRdsDataClient } from "./aws";
import {
	getCurrentDatabase,
	getDatabase,
	listDatabases,
	setCurrentDatabase,
} from "./config";
import { runConfigurator } from "./configurator";
import { executeQuery } from "./db";
import { format } from "./formatter";
import { startRepl } from "./repl";
import type { OutputFormat } from "./types";

const VALID_FORMATS: OutputFormat[] = ["csv", "html", "json", "text"];

function parseOutputFormat(value: string): OutputFormat {
	if (VALID_FORMATS.includes(value as OutputFormat)) {
		return value as OutputFormat;
	}
	console.warn(`Invalid format "${value}", defaulting to "text"`);
	return "text";
}

const program = new Command();

program
	.name("rdsql")
	.description("A psql-like query tool for AWS RDS Data API")
	.version("1.0.0");

program
	.command("configure")
	.description("Run interactive configurator to set up database connections")
	.action(async () => {
		try {
			await runConfigurator();
		} catch (error) {
			console.error("Configuration error:", error);
			process.exit(1);
		}
	});

program
	.command("list")
	.description("List all configured databases")
	.action(() => {
		try {
			const databases = listDatabases();
			const current = getCurrentDatabase();

			if (databases.length === 0) {
				console.log(
					'No databases configured. Run "rdsql configure" to set up a connection.',
				);
				return;
			}

			console.log("\nConfigured databases:");
			databases.forEach((db) => {
				const marker = db === current ? " (current)" : "";
				console.log(`  - ${db}${marker}`);
			});
			console.log("");
		} catch (error) {
			console.error("Error listing databases:", error);
			process.exit(1);
		}
	});

program
	.command("use <name>")
	.description("Set the current database")
	.action((name: string) => {
		try {
			setCurrentDatabase(name);
			console.log(`Current database set to: ${name}`);
		} catch (error) {
			console.error("Error setting current database:", error);
			process.exit(1);
		}
	});

program
	.command("query <sql>")
	.description("Execute a SQL query")
	.option("--db <name>", "Database to use (defaults to current)")
	.option("--format <format>", "Output format: text, csv, json, html", "text")
	.option("--debug", "Dump raw API response to stderr for debugging")
	.action(
		async (
			sql: string,
			options: { db?: string; format: string; debug?: boolean },
		) => {
			try {
				const dbName = options.db || getCurrentDatabase();

				if (!dbName) {
					console.error("No database specified and no current database set.");
					console.error('Use --db <name> or run "rdsql use <name>" first.');
					process.exit(1);
				}

				const dbConfig = getDatabase(dbName);
				if (!dbConfig) {
					console.error(`Database "${dbName}" not found in configuration.`);
					process.exit(1);
				}

				const client = createRdsDataClient(dbConfig);
				const result = await executeQuery(
					client,
					dbConfig.resourceArn,
					dbConfig.database,
					sql,
					dbConfig.secretArn,
					dbConfig.username,
					dbConfig.password,
					options.debug,
				);

				const formatted = format(result, parseOutputFormat(options.format));
				console.log(formatted);
			} catch (error) {
				console.error("Query error:", error);
				process.exit(1);
			}
		},
	);

program.action(async (options: { db?: string; debug?: boolean }) => {
	try {
		const dbName = options.db || getCurrentDatabase();

		if (!dbName) {
			console.error("No database specified and no current database set.");
			console.error(
				'Run "rdsql configure" to set up a connection, or use "rdsql --db <name>".',
			);
			process.exit(1);
		}

		const dbConfig = getDatabase(dbName);
		if (!dbConfig) {
			console.error(`Database "${dbName}" not found in configuration.`);
			process.exit(1);
		}

		await startRepl(dbConfig, dbName, options.debug);
	} catch (error) {
		console.error("Error:", error);
		process.exit(1);
	}
});

program.option("--db <name>", "Database to use for REPL");
program.option("--debug", "Dump raw API response to stderr for debugging");

program.parse();
