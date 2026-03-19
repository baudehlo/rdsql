import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import type { Mocked } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReplSession } from "../src/repl";
import type { DatabaseConfig } from "../src/types";

vi.mock("node:readline");
vi.mock("../src/aws");
vi.mock("../src/db");

const mockReadline = readline as Mocked<typeof readline>;

class MockInterface extends EventEmitter {
	prompt = vi.fn();
	setPrompt = vi.fn();
	close = vi.fn();
	on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
		super.on(event, listener);
		return this;
	});
}

describe("repl", () => {
	let mockRlInterface: MockInterface;
	let dbConfig: DatabaseConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRlInterface = new MockInterface();
		mockReadline.createInterface.mockReturnValue(
			mockRlInterface as unknown as readline.Interface,
		);

		dbConfig = {
			region: "us-east-1",
			resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:test",
			database: "testdb",
			secretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
		};
	});

	describe("ReplSession", () => {
		it("should initialize with correct prompt", () => {
			const _session = new ReplSession(dbConfig, "testdb");
			expect(mockReadline.createInterface).toHaveBeenCalled();
		});

		it("should handle /q command to quit", async () => {
			const session = new ReplSession(dbConfig, "testdb");

			const _startPromise = session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			expect(lineListener).toBeDefined();

			if (lineListener) {
				await lineListener("/q");
			}

			expect(mockRlInterface.close).toHaveBeenCalled();
		});

		it("should handle /? help command", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation();

			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			if (lineListener) {
				await lineListener("/?");
			}

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Available commands"),
			);

			consoleSpy.mockRestore();
		});

		it("should handle /h help command", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation();

			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			if (lineListener) {
				await lineListener("/h");
			}

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Available commands"),
			);

			consoleSpy.mockRestore();
		});

		it("should handle /format command", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation();

			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			if (lineListener) {
				await lineListener("/format json");
			}

			expect(consoleSpy).toHaveBeenCalledWith("Output format set to: json");

			consoleSpy.mockRestore();
		});

		it("should handle invalid format", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation();

			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			if (lineListener) {
				await lineListener("/format invalid");
			}

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Invalid format"),
			);

			consoleSpy.mockRestore();
		});

		it("should handle unknown slash command", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation();

			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			if (lineListener) {
				await lineListener("/unknown");
			}

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Unknown command"),
			);

			consoleSpy.mockRestore();
		});

		it("should accumulate multi-line SQL", async () => {
			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			if (lineListener) {
				await lineListener("SELECT *");
				expect(mockRlInterface.setPrompt).toHaveBeenCalledWith("    -> ");

				await lineListener("FROM users;");
				expect(mockRlInterface.prompt).toHaveBeenCalled();
			}
		});

		it("should handle SIGINT when SQL is accumulated", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation();

			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const lineListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "line",
			)?.[1];

			const sigintListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "SIGINT",
			)?.[1];

			if (lineListener && sigintListener) {
				await lineListener("SELECT *");

				sigintListener();

				expect(consoleSpy).toHaveBeenCalledWith(
					expect.stringContaining("Query cancelled"),
				);
				expect(mockRlInterface.setPrompt).toHaveBeenCalled();
			}

			consoleSpy.mockRestore();
		});

		it("should handle SIGINT when no SQL accumulated", async () => {
			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const sigintListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "SIGINT",
			)?.[1];

			if (sigintListener) {
				sigintListener();

				expect(mockRlInterface.close).toHaveBeenCalled();
			}
		});

		it("should handle close event", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation();
			const exitSpy = vi
				.spyOn(process, "exit")
				.mockImplementation((_code) => undefined as never);

			const session = new ReplSession(dbConfig, "testdb");
			await session.start();

			const closeListener = mockRlInterface.on.mock.calls.find(
				(call) => call[0] === "close",
			)?.[1];

			if (closeListener) {
				closeListener();

				expect(consoleSpy).toHaveBeenCalledWith(
					expect.stringContaining("Goodbye"),
				);
				expect(exitSpy).toHaveBeenCalledWith(0);
			}

			consoleSpy.mockRestore();
			exitSpy.mockRestore();
		});
	});
});
