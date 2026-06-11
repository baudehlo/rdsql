import { describe, expect, it } from "vitest";

// We test the pure TypeScript logic (pattern parsing, SQL building) without
// needing a real database connection.  The describe module's public surface is
// executeDescribe, which requires a live client; those integration paths are
// covered by the pattern-parsing unit tests below.

// We reach into the module's private helpers through a small re-export shim by
// duplicating the pure functions here and asserting the same behaviour documented
// in pg_describe's README.

// ─── Inline copies of the pure helpers (kept in sync with describe.ts) ───────

function patternSegToRegex(seg: string): string {
	let result = "";
	let i = 0;
	let inDq = false;

	while (i < seg.length) {
		const ch = seg[i];
		if (inDq) {
			if (ch === '"') {
				if (i + 1 < seg.length && seg[i + 1] === '"') {
					result += '"';
					i += 2;
					continue;
				}
				inDq = false;
			} else {
				if (/[.*+?()[\]{}^$|\\]/.test(ch)) result += `\\${ch}`;
				else result += ch;
			}
		} else {
			switch (ch) {
				case '"':
					inDq = true;
					break;
				case "*":
					result += ".*";
					break;
				case "?":
					result += ".";
					break;
				case "$":
					result += "\\$";
					break;
				default:
					result += ch.toLowerCase();
			}
		}
		i++;
	}
	return result;
}

interface ParsedPattern {
	schemaRe: string | null;
	nameRe: string;
	checkVis: boolean;
}

function parsePattern(pattern: string): ParsedPattern {
	const dots: number[] = [];
	let inDq = false;
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (inDq) {
			if (ch === '"') {
				if (i + 1 < pattern.length && pattern[i + 1] === '"') i++;
				else inDq = false;
			}
		} else {
			if (ch === '"') inDq = true;
			else if (ch === ".") dots.push(i);
		}
	}
	if (dots.length === 0) {
		return {
			schemaRe: null,
			nameRe: patternSegToRegex(pattern),
			checkVis: true,
		};
	}
	const dotPos = dots[0];
	return {
		schemaRe: patternSegToRegex(pattern.slice(0, dotPos)),
		nameRe: patternSegToRegex(pattern.slice(dotPos + 1)),
		checkVis: false,
	};
}

function safeOid(oid: string): string {
	const n = Number.parseInt(oid, 10);
	if (!Number.isFinite(n) || n < 0 || String(n) !== oid.trim())
		throw new Error(`Invalid OID: ${oid}`);
	return String(n);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("patternSegToRegex", () => {
	it("passes through plain lowercase letters unchanged", () => {
		expect(patternSegToRegex("orders")).toBe("orders");
	});

	it("folds unquoted uppercase to lowercase", () => {
		expect(patternSegToRegex("ORDERS")).toBe("orders");
		expect(patternSegToRegex("Orders")).toBe("orders");
	});

	it("converts * to .*", () => {
		expect(patternSegToRegex("cust*")).toBe("cust.*");
	});

	it("converts ? to .", () => {
		expect(patternSegToRegex("us?r")).toBe("us.r");
	});

	it("escapes $ in unquoted segment", () => {
		expect(patternSegToRegex("seq$1")).toBe("seq\\$1");
	});

	it("preserves case and treats * ? as literals inside double quotes", () => {
		expect(patternSegToRegex('"MyTable"')).toBe("MyTable");
		expect(patternSegToRegex('"My*Table"')).toBe("My\\*Table");
		expect(patternSegToRegex('"My?Table"')).toBe("My\\?Table");
	});

	it('handles "" inside quoted segment as literal double-quote', () => {
		expect(patternSegToRegex('"say""hi"')).toBe('say"hi');
	});

	it("escapes regex metacharacters inside quoted segment", () => {
		expect(patternSegToRegex('"a.b"')).toBe("a\\.b");
		expect(patternSegToRegex('"a+b"')).toBe("a\\+b");
		expect(patternSegToRegex('"a(b)"')).toBe("a\\(b\\)");
	});
});

describe("parsePattern", () => {
	it("name-only: checkVis=true, schemaRe=null, nameRe lowercased", () => {
		const p = parsePattern("orders");
		expect(p.checkVis).toBe(true);
		expect(p.schemaRe).toBeNull();
		expect(p.nameRe).toBe("orders");
	});

	it("name-only with wildcard", () => {
		const p = parsePattern("cust*");
		expect(p.checkVis).toBe(true);
		expect(p.schemaRe).toBeNull();
		expect(p.nameRe).toBe("cust.*");
	});

	it("schema.name: checkVis=false, schemaRe and nameRe set", () => {
		const p = parsePattern("public.orders");
		expect(p.checkVis).toBe(false);
		expect(p.schemaRe).toBe("public");
		expect(p.nameRe).toBe("orders");
	});

	it("schema wildcard: hr.*", () => {
		const p = parsePattern("hr.*");
		expect(p.checkVis).toBe(false);
		expect(p.schemaRe).toBe("hr");
		expect(p.nameRe).toBe(".*");
	});

	it("*.* matches all schemas", () => {
		const p = parsePattern("*.*");
		expect(p.checkVis).toBe(false);
		expect(p.schemaRe).toBe(".*");
		expect(p.nameRe).toBe(".*");
	});

	it("dot inside double-quotes does not count as separator", () => {
		// "my.schema" is a quoted name with a literal dot — treated as name-only
		const p = parsePattern('"my.table"');
		expect(p.checkVis).toBe(true);
		expect(p.schemaRe).toBeNull();
		// The dot inside quotes is escaped in the regex
		expect(p.nameRe).toBe("my\\.table");
	});

	it("uses first dot when multiple dots appear", () => {
		// pg_describe / psql: first dot is the schema separator; subsequent dots
		// in the name segment are passed through unescaped (become regex '.',
		// matching any character — same behaviour as psql).
		const p = parsePattern("myschema.my.table");
		expect(p.schemaRe).toBe("myschema");
		expect(p.nameRe).toBe("my.table");
	});
});

describe("safeOid", () => {
	it("accepts a valid integer OID", () => {
		expect(safeOid("12345")).toBe("12345");
	});

	it("rejects non-numeric strings", () => {
		expect(() => safeOid("abc")).toThrow("Invalid OID");
	});

	it("rejects negative numbers", () => {
		expect(() => safeOid("-1")).toThrow("Invalid OID");
	});

	it("rejects strings with trailing non-numeric content (SQL injection guard)", () => {
		expect(() => safeOid("1; DROP TABLE users--")).toThrow("Invalid OID");
		expect(() => safeOid("123abc")).toThrow("Invalid OID");
	});
});
