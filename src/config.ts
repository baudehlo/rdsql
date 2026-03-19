import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ini from "ini";
import type { AppConfig, DatabaseConfig } from "./types";

export function getConfigPath(): string {
	const configDir = path.join(os.homedir(), ".rdsql");
	return path.join(configDir, "config.ini");
}

function ensureConfigDir(): void {
	const configDir = path.dirname(getConfigPath());
	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true });
	}
}

export function readConfig(): AppConfig {
	const configPath = getConfigPath();

	if (!fs.existsSync(configPath)) {
		return { databases: {} };
	}

	try {
		const content = fs.readFileSync(configPath, "utf-8");
		const parsed = ini.parse(content);

		const config: AppConfig = {
			databases: {},
			current: parsed.current,
		};

		Object.keys(parsed).forEach((key) => {
			if (key !== "current" && typeof parsed[key] === "object") {
				config.databases[key] = parsed[key] as DatabaseConfig;
			}
		});

		return config;
	} catch (error) {
		throw new Error(`Failed to read config: ${error}`);
	}
}

export function writeConfig(config: AppConfig): void {
	ensureConfigDir();
	const configPath = getConfigPath();

	const iniData: Record<string, unknown> = {};

	if (config.current) {
		iniData.current = config.current;
	}

	Object.keys(config.databases).forEach((dbName) => {
		iniData[dbName] = config.databases[dbName];
	});

	try {
		const content = ini.stringify(iniData);
		fs.writeFileSync(configPath, content, "utf-8");
	} catch (error) {
		throw new Error(`Failed to write config: ${error}`);
	}
}

export function getDatabase(name: string): DatabaseConfig | undefined {
	const config = readConfig();
	return config.databases[name];
}

export function listDatabases(): string[] {
	const config = readConfig();
	return Object.keys(config.databases);
}

export function getCurrentDatabase(): string | undefined {
	const config = readConfig();
	return config.current;
}

export function setCurrentDatabase(name: string): void {
	const config = readConfig();
	if (!config.databases[name]) {
		throw new Error(`Database '${name}' not found in config`);
	}
	config.current = name;
	writeConfig(config);
}
