import { describe, expect, it } from "vitest";
import { resolveDatabaseName } from "../src/index";

describe("resolveDatabaseName", () => {
	it("prefers the query subcommand --db option", () => {
		expect(resolveDatabaseName("query-db", "global-db", "current-db")).toBe(
			"query-db",
		);
	});

	it("falls back to the global --db option", () => {
		expect(resolveDatabaseName(undefined, "global-db", "current-db")).toBe(
			"global-db",
		);
	});

	it("falls back to the current configured database", () => {
		expect(resolveDatabaseName(undefined, undefined, "current-db")).toBe(
			"current-db",
		);
	});
});