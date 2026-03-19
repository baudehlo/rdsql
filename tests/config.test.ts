import * as fs from "node:fs";
import * as os from "node:os";
import {
	getConfigPath,
	getCurrentDatabase,
	getDatabase,
	listDatabases,
	readConfig,
	setCurrentDatabase,
	writeConfig,
} from "../src/config";
import type { AppConfig } from "../src/types";

jest.mock("node:fs");
jest.mock("node:os");

const mockFs = fs as jest.Mocked<typeof fs>;
const mockOs = os as jest.Mocked<typeof os>;

describe("config", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockOs.homedir.mockReturnValue("/home/testuser");
	});

	describe("getConfigPath", () => {
		it("should return the correct config path", () => {
			const configPath = getConfigPath();
			expect(configPath).toBe("/home/testuser/.rdsql/config.ini");
		});
	});

	describe("readConfig", () => {
		it("should return empty config when file does not exist", () => {
			mockFs.existsSync.mockReturnValue(false);

			const config = readConfig();

			expect(config).toEqual({ databases: {} });
		});

		it("should read and parse config file", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(`
current = mydb

[mydb]
region = us-east-1
resourceArn = arn:aws:rds:us-east-1:123456789012:cluster:test-cluster
secretArn = arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret
database = testdb
      `);

			const config = readConfig();

			expect(config.current).toBe("mydb");
			expect(config.databases.mydb).toBeDefined();
			expect(config.databases.mydb.region).toBe("us-east-1");
			expect(config.databases.mydb.database).toBe("testdb");
		});

		it("should handle read errors", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockImplementation(() => {
				throw new Error("Read error");
			});

			expect(() => readConfig()).toThrow("Failed to read config");
		});
	});

	describe("writeConfig", () => {
		it("should write config to file", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.mkdirSync.mockImplementation();
			mockFs.writeFileSync.mockImplementation();

			const config: AppConfig = {
				current: "mydb",
				databases: {
					mydb: {
						region: "us-east-1",
						resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:test",
						database: "testdb",
						secretArn:
							"arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
					},
				},
			};

			writeConfig(config);

			expect(mockFs.writeFileSync).toHaveBeenCalled();
			const writtenContent = mockFs.writeFileSync.mock.calls[0][1] as string;
			expect(writtenContent).toContain("current");
			expect(writtenContent).toContain("mydb");
		});

		it("should create config directory if it does not exist", () => {
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation();
			mockFs.writeFileSync.mockImplementation();

			const config: AppConfig = {
				databases: {
					mydb: {
						region: "us-east-1",
						resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:test",
						database: "testdb",
					},
				},
			};

			writeConfig(config);

			expect(mockFs.mkdirSync).toHaveBeenCalledWith("/home/testuser/.rdsql", {
				recursive: true,
			});
		});

		it("should handle write errors", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.writeFileSync.mockImplementation(() => {
				throw new Error("Write error");
			});

			const config: AppConfig = { databases: {} };

			expect(() => writeConfig(config)).toThrow("Failed to write config");
		});
	});

	describe("getDatabase", () => {
		it("should return database config", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(`
[mydb]
region = us-east-1
resourceArn = arn:aws:rds:us-east-1:123456789012:cluster:test
database = testdb
      `);

			const dbConfig = getDatabase("mydb");

			expect(dbConfig).toBeDefined();
			expect(dbConfig?.region).toBe("us-east-1");
			expect(dbConfig?.database).toBe("testdb");
		});

		it("should return undefined for non-existent database", () => {
			mockFs.existsSync.mockReturnValue(false);

			const dbConfig = getDatabase("nonexistent");

			expect(dbConfig).toBeUndefined();
		});
	});

	describe("listDatabases", () => {
		it("should return list of database names", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(`
[db1]
region = us-east-1
resourceArn = arn1
database = test1

[db2]
region = us-west-2
resourceArn = arn2
database = test2
      `);

			const databases = listDatabases();

			expect(databases).toEqual(["db1", "db2"]);
		});

		it("should return empty array when no databases configured", () => {
			mockFs.existsSync.mockReturnValue(false);

			const databases = listDatabases();

			expect(databases).toEqual([]);
		});
	});

	describe("getCurrentDatabase", () => {
		it("should return current database name", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(
				"current = mydb\n[mydb]\nregion = us-east-1",
			);

			const current = getCurrentDatabase();

			expect(current).toBe("mydb");
		});

		it("should return undefined when no current database set", () => {
			mockFs.existsSync.mockReturnValue(false);

			const current = getCurrentDatabase();

			expect(current).toBeUndefined();
		});
	});

	describe("setCurrentDatabase", () => {
		it("should set current database", () => {
			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(
				"[mydb]\nregion = us-east-1\nresourceArn = arn\ndatabase = test",
			);
			mockFs.writeFileSync.mockImplementation();

			setCurrentDatabase("mydb");

			expect(mockFs.writeFileSync).toHaveBeenCalled();
			const writtenContent = mockFs.writeFileSync.mock.calls[0][1] as string;
			expect(writtenContent).toContain("current");
			expect(writtenContent).toContain("mydb");
		});

		it("should throw error for non-existent database", () => {
			mockFs.existsSync.mockReturnValue(false);

			expect(() => setCurrentDatabase("nonexistent")).toThrow(
				"Database 'nonexistent' not found",
			);
		});
	});
});
