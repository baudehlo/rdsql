import {
	ExecuteStatementCommand,
	RDSDataClient,
} from "@aws-sdk/client-rds-data";
import type { Mock, Mocked, MockedClass, MockedFunction } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRdsDataClient } from "../src/aws";
import { executeQuery, testConnection } from "../src/db";
import type { DatabaseConfig } from "../src/types";

vi.mock("@aws-sdk/client-rds-data");
vi.mock("../src/aws");

const _mockRDSDataClient = RDSDataClient as MockedClass<typeof RDSDataClient>;
const mockCreateRdsDataClient = createRdsDataClient as MockedFunction<
	typeof createRdsDataClient
>;

describe("db", () => {
	let mockClient: Mocked<RDSDataClient>;
	let mockSend: Mock;

	beforeEach(() => {
		vi.clearAllMocks();
		mockSend = vi.fn();
		mockClient = {
			send: mockSend,
		} as unknown as Mocked<RDSDataClient>;
		mockCreateRdsDataClient.mockReturnValue(mockClient);
	});

	describe("executeQuery", () => {
		it("should execute query and return results", async () => {
			const mockResponse = {
				columnMetadata: [{ name: "id" }, { name: "name" }],
				records: [
					[{ longValue: 1 }, { stringValue: "Alice" }],
					[{ longValue: 2 }, { stringValue: "Bob" }],
				],
				numberOfRecordsUpdated: undefined,
			};

			mockSend.mockResolvedValue(mockResponse);

			const result = await executeQuery(
				mockClient,
				"arn:aws:rds:us-east-1:123456789012:cluster:test",
				"testdb",
				"SELECT * FROM users",
				"arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
			);

			expect(result.columns).toEqual(["id", "name"]);
			expect(result.rows).toEqual([
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
			]);
			expect(mockSend).toHaveBeenCalledWith(
				expect.any(ExecuteStatementCommand),
			);
		});

		it("should handle different field types", async () => {
			const mockResponse = {
				columnMetadata: [
					{ name: "stringCol" },
					{ name: "longCol" },
					{ name: "doubleCol" },
					{ name: "boolCol" },
					{ name: "nullCol" },
				],
				records: [
					[
						{ stringValue: "test" },
						{ longValue: 42 },
						{ doubleValue: 3.14 },
						{ booleanValue: true },
						{ isNull: true },
					],
				],
			};

			mockSend.mockResolvedValue(mockResponse);

			const result = await executeQuery(
				mockClient,
				"arn:aws:rds:us-east-1:123456789012:cluster:test",
				"testdb",
				"SELECT * FROM test",
				"arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
			);

			expect(result.rows[0]).toEqual({
				stringCol: "test",
				longCol: 42,
				doubleCol: 3.14,
				boolCol: true,
				nullCol: null,
			});
		});

		it("should handle UPDATE queries with numberOfRecordsUpdated", async () => {
			const mockResponse = {
				columnMetadata: undefined,
				records: undefined,
				numberOfRecordsUpdated: 5,
			};

			mockSend.mockResolvedValue(mockResponse);

			const result = await executeQuery(
				mockClient,
				"arn:aws:rds:us-east-1:123456789012:cluster:test",
				"testdb",
				'UPDATE users SET status = "active"',
				"arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
			);

			expect(result.numberOfRecordsUpdated).toBe(5);
			expect(result.columns).toEqual([]);
			expect(result.rows).toEqual([]);
		});

		it("should ignore numberOfRecordsUpdated from API when SELECT returns rows", async () => {
			// The RDS Data API always returns numberOfRecordsUpdated: 0 for SELECT
			// statements. It must not be propagated when column/record data is present.
			const mockResponse = {
				columnMetadata: [{ name: "id" }],
				records: [[{ longValue: 1 }]],
				numberOfRecordsUpdated: 0,
			};

			mockSend.mockResolvedValue(mockResponse);

			const result = await executeQuery(
				mockClient,
				"arn:aws:rds:us-east-1:123456789012:cluster:test",
				"testdb",
				"SELECT * FROM users",
				"arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
			);

			expect(result.numberOfRecordsUpdated).toBeUndefined();
			expect(result.columns).toEqual(["id"]);
			expect(result.rows).toEqual([{ id: 1 }]);
		});

		it("should throw error when neither secretArn nor username/password provided", async () => {
			await expect(
				executeQuery(
					mockClient,
					"arn:aws:rds:us-east-1:123456789012:cluster:test",
					"testdb",
					"SELECT 1",
				),
			).rejects.toThrow(
				"Either secretArn or both username and password must be provided",
			);
		});

		it("should throw error when secretArn not provided even with username/password", async () => {
			await expect(
				executeQuery(
					mockClient,
					"arn:aws:rds:us-east-1:123456789012:cluster:test",
					"testdb",
					"SELECT 1",
					undefined,
					"user",
					"pass",
				),
			).rejects.toThrow("RDS Data API requires a Secrets Manager secret ARN");
		});

		it("should handle query execution errors", async () => {
			mockSend.mockRejectedValue(new Error("Query failed"));

			await expect(
				executeQuery(
					mockClient,
					"arn:aws:rds:us-east-1:123456789012:cluster:test",
					"testdb",
					"SELECT * FROM nonexistent",
					"arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
				),
			).rejects.toThrow("Query execution failed");
		});
	});

	describe("testConnection", () => {
		it("should test connection successfully", async () => {
			const mockResponse = {
				columnMetadata: [{ name: "test" }],
				records: [[{ longValue: 1 }]],
			};

			mockSend.mockResolvedValue(mockResponse);

			const config: DatabaseConfig = {
				region: "us-east-1",
				resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:test",
				database: "testdb",
				secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
			};

			const result = await testConnection(config);

			expect(result).toBe(true);
			expect(mockSend).toHaveBeenCalled();
		});

		it("should throw error on connection failure", async () => {
			mockSend.mockRejectedValue(new Error("Connection refused"));

			const config: DatabaseConfig = {
				region: "us-east-1",
				resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:test",
				database: "testdb",
				secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
			};

			await expect(testConnection(config)).rejects.toThrow(
				"Connection test failed",
			);
		});

		it("should fail when no secretArn provided", async () => {
			const config: DatabaseConfig = {
				region: "us-east-1",
				resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:test",
				database: "testdb",
				username: "user",
				password: "pass",
			};

			await expect(testConnection(config)).rejects.toThrow(
				"RDS Data API requires a Secrets Manager secret ARN",
			);
		});
	});
});
