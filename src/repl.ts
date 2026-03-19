import * as readline from "node:readline";
import { createRdsDataClient } from "./aws";
import { executeQuery } from "./db";
import { format } from "./formatter";
import type { DatabaseConfig, OutputFormat } from "./types";

export class ReplSession {
	private rl: readline.Interface;
	private currentSql: string = "";
	private outputFormat: OutputFormat = "text";
	private dbConfig: DatabaseConfig;
	private dbName: string;
	private debug: boolean;

	constructor(dbConfig: DatabaseConfig, dbName: string, debug = false) {
		this.dbConfig = dbConfig;
		this.dbName = dbName;
		this.debug = debug;

		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: this.getPrompt(),
		});
	}

	private getPrompt(): string {
		return `rdsql [${this.dbName}]> `;
	}

	private showHelp(): void {
		console.log("\nAvailable commands:");
		console.log("  /format <csv|html|json|text>  - Set output format");
		console.log(
			"  /debug                         - Toggle raw API response debug output",
		);
		console.log("  /?, /h                         - Show this help");
		console.log("  /q                             - Quit");
		console.log("  Ctrl-C                         - Quit");
		console.log(
			"\nEnter SQL statements ending with semicolon (;) to execute.\n",
		);
	}

	private handleSlashCommand(command: string): boolean {
		const trimmed = command.trim();

		if (trimmed === "/q") {
			return true;
		}

		if (trimmed === "/?" || trimmed === "/h") {
			this.showHelp();
			return false;
		}

		if (trimmed === "/debug") {
			this.debug = !this.debug;
			console.log(`Debug output ${this.debug ? "enabled" : "disabled"}`);
			return false;
		}

		if (trimmed.startsWith("/format ")) {
			const format = trimmed.substring(8).trim() as OutputFormat;
			if (["csv", "html", "json", "text"].includes(format)) {
				this.outputFormat = format;
				console.log(`Output format set to: ${format}`);
			} else {
				console.log("Invalid format. Use: csv, html, json, or text");
			}
			return false;
		}

		console.log(`Unknown command: ${trimmed}`);
		console.log("Type /? or /h for help");
		return false;
	}

	private async executeSql(sql: string): Promise<void> {
		const client = createRdsDataClient(this.dbConfig);

		try {
			const result = await executeQuery(
				client,
				this.dbConfig.resourceArn,
				this.dbConfig.database,
				sql,
				this.dbConfig.secretArn,
				this.dbConfig.username,
				this.dbConfig.password,
				this.debug,
			);

			const formatted = format(result, this.outputFormat);
			console.log(formatted);
		} catch (error) {
			console.error(
				"Error:",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	public async start(): Promise<void> {
		console.log(`\n🚀 Connected to database: ${this.dbName}`);
		console.log("Type /? or /h for help, /q or Ctrl-C to quit\n");

		this.rl.prompt();

		this.rl.on("line", async (line: string) => {
			const trimmed = line.trim();

			if (trimmed.startsWith("/")) {
				const shouldQuit = this.handleSlashCommand(trimmed);
				if (shouldQuit) {
					this.rl.close();
					return;
				}
				this.rl.prompt();
				return;
			}

			this.currentSql += (this.currentSql ? " " : "") + line;

			if (trimmed.endsWith(";")) {
				const sqlToExecute = this.currentSql.trim();
				this.currentSql = "";

				if (sqlToExecute) {
					await this.executeSql(sqlToExecute);
				}

				this.rl.prompt();
			} else {
				this.rl.setPrompt("    -> ");
				this.rl.prompt();
			}
		});

		this.rl.on("close", () => {
			console.log("\nGoodbye!");
			process.exit(0);
		});

		this.rl.on("SIGINT", () => {
			if (this.currentSql) {
				console.log("\nQuery cancelled.");
				this.currentSql = "";
				this.rl.setPrompt(this.getPrompt());
				this.rl.prompt();
			} else {
				this.rl.close();
			}
		});
	}
}

export async function startRepl(
	dbConfig: DatabaseConfig,
	dbName: string,
	debug = false,
): Promise<void> {
	const session = new ReplSession(dbConfig, dbName, debug);
	await session.start();
}
