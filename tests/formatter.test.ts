import {
	format,
	formatAsCsv,
	formatAsHtml,
	formatAsJson,
	formatAsText,
} from "../src/formatter";
import type { QueryResult } from "../src/types";

describe("formatter", () => {
	describe("formatAsText", () => {
		it("should format query results as text table", () => {
			const result: QueryResult = {
				columns: ["id", "name", "age"],
				rows: [
					{ id: 1, name: "Alice", age: 30 },
					{ id: 2, name: "Bob", age: 25 },
				],
			};

			const formatted = formatAsText(result);

			expect(formatted).toContain("id");
			expect(formatted).toContain("name");
			expect(formatted).toContain("age");
			expect(formatted).toContain("Alice");
			expect(formatted).toContain("Bob");
			expect(formatted).toContain("(2 rows)");
		});

		it("should handle empty results", () => {
			const result: QueryResult = {
				columns: ["id", "name"],
				rows: [],
			};

			const formatted = formatAsText(result);

			expect(formatted).toBe("(0 rows)");
		});

		it("should handle NULL values", () => {
			const result: QueryResult = {
				columns: ["id", "value"],
				rows: [{ id: 1, value: null }],
			};

			const formatted = formatAsText(result);

			expect(formatted).toContain("NULL");
		});

		it("should handle update results", () => {
			const result: QueryResult = {
				columns: [],
				rows: [],
				numberOfRecordsUpdated: 5,
			};

			const formatted = formatAsText(result);

			expect(formatted).toBe("Query OK, 5 row(s) affected");
		});
	});

	describe("formatAsCsv", () => {
		it("should format query results as CSV", () => {
			const result: QueryResult = {
				columns: ["id", "name", "age"],
				rows: [
					{ id: 1, name: "Alice", age: 30 },
					{ id: 2, name: "Bob", age: 25 },
				],
			};

			const formatted = formatAsCsv(result);

			expect(formatted).toBe("id,name,age\n1,Alice,30\n2,Bob,25");
		});

		it("should handle empty results", () => {
			const result: QueryResult = {
				columns: ["id", "name"],
				rows: [],
			};

			const formatted = formatAsCsv(result);

			expect(formatted).toBe("id,name");
		});

		it("should escape CSV special characters", () => {
			const result: QueryResult = {
				columns: ["text"],
				rows: [{ text: 'Hello, "World"' }],
			};

			const formatted = formatAsCsv(result);

			expect(formatted).toContain('"Hello, ""World"""');
		});

		it("should handle NULL values", () => {
			const result: QueryResult = {
				columns: ["id", "value"],
				rows: [{ id: 1, value: null }],
			};

			const formatted = formatAsCsv(result);

			expect(formatted).toBe("id,value\n1,");
		});

		it("should handle update results", () => {
			const result: QueryResult = {
				columns: [],
				rows: [],
				numberOfRecordsUpdated: 3,
			};

			const formatted = formatAsCsv(result);

			expect(formatted).toBe("rows_affected\n3");
		});
	});

	describe("formatAsHtml", () => {
		it("should format query results as HTML table", () => {
			const result: QueryResult = {
				columns: ["id", "name"],
				rows: [
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
				],
			};

			const formatted = formatAsHtml(result);

			expect(formatted).toContain("<table>");
			expect(formatted).toContain("<th>id</th>");
			expect(formatted).toContain("<th>name</th>");
			expect(formatted).toContain("<td>1</td>");
			expect(formatted).toContain("<td>Alice</td>");
			expect(formatted).toContain("</table>");
		});

		it("should handle empty results", () => {
			const result: QueryResult = {
				columns: ["id", "name"],
				rows: [],
			};

			const formatted = formatAsHtml(result);

			expect(formatted).toContain("<table>");
			expect(formatted).toContain("<th>id</th>");
			expect(formatted).toContain("<th>name</th>");
		});

		it("should escape HTML special characters", () => {
			const result: QueryResult = {
				columns: ["text"],
				rows: [{ text: '<script>alert("XSS")</script>' }],
			};

			const formatted = formatAsHtml(result);

			expect(formatted).toContain("&lt;script&gt;");
			expect(formatted).toContain("&quot;");
			expect(formatted).not.toContain("<script>");
		});

		it("should handle NULL values", () => {
			const result: QueryResult = {
				columns: ["id", "value"],
				rows: [{ id: 1, value: null }],
			};

			const formatted = formatAsHtml(result);

			expect(formatted).toContain("NULL");
		});

		it("should handle update results", () => {
			const result: QueryResult = {
				columns: [],
				rows: [],
				numberOfRecordsUpdated: 7,
			};

			const formatted = formatAsHtml(result);

			expect(formatted).toBe("<div>Query OK, 7 row(s) affected</div>");
		});
	});

	describe("formatAsJson", () => {
		it("should format query results as JSON", () => {
			const result: QueryResult = {
				columns: ["id", "name"],
				rows: [
					{ id: 1, name: "Alice" },
					{ id: 2, name: "Bob" },
				],
			};

			const formatted = formatAsJson(result);
			const parsed = JSON.parse(formatted);

			expect(parsed).toEqual([
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
			]);
		});

		it("should handle empty results", () => {
			const result: QueryResult = {
				columns: ["id"],
				rows: [],
			};

			const formatted = formatAsJson(result);
			const parsed = JSON.parse(formatted);

			expect(parsed).toEqual([]);
		});

		it("should handle NULL values", () => {
			const result: QueryResult = {
				columns: ["id", "value"],
				rows: [{ id: 1, value: null }],
			};

			const formatted = formatAsJson(result);
			const parsed = JSON.parse(formatted);

			expect(parsed[0].value).toBeNull();
		});

		it("should handle update results", () => {
			const result: QueryResult = {
				columns: [],
				rows: [],
				numberOfRecordsUpdated: 4,
			};

			const formatted = formatAsJson(result);
			const parsed = JSON.parse(formatted);

			expect(parsed).toEqual({ numberOfRecordsUpdated: 4 });
		});
	});

	describe("format", () => {
		const result: QueryResult = {
			columns: ["id"],
			rows: [{ id: 1 }],
		};

		it("should dispatch to formatAsText for text format", () => {
			const formatted = format(result, "text");
			expect(formatted).toContain("id");
			expect(formatted).toContain("(1 row)");
		});

		it("should dispatch to formatAsCsv for csv format", () => {
			const formatted = format(result, "csv");
			expect(formatted).toBe("id\n1");
		});

		it("should dispatch to formatAsHtml for html format", () => {
			const formatted = format(result, "html");
			expect(formatted).toContain("<table>");
		});

		it("should dispatch to formatAsJson for json format", () => {
			const formatted = format(result, "json");
			const parsed = JSON.parse(formatted);
			expect(parsed).toEqual([{ id: 1 }]);
		});
	});
});
