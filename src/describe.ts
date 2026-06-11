/**
 * Implements psql's \d / \d+ describe commands.
 *
 * Pattern syntax mirrors psql \d exactly:
 *   *        → any sequence of characters
 *   ?        → any single character
 *   "quoted" → case-sensitive literal (* ? . treated as plain chars)
 *   schema.name → match by schema; no visibility filter
 *   name (no dot) → match visible relations only
 */

import type { RDSDataClient } from "@aws-sdk/client-rds-data";
import { executeQuery } from "./db";
import type { QueryResult } from "./types";

// ─── Pattern helpers (TypeScript port of pg_describe's PL/pgSQL helpers) ────

/**
 * Convert one psql pattern segment (no dots) to a POSIX regex fragment.
 * Unquoted: folds to lower-case; * → .*  ? → .  $ → \$
 * Quoted:   literal (regex metacharacters escaped); no case-fold; "" → "
 */
function patternSegToRegex(seg: string): string {
	let result = "";
	let i = 0;
	let inDq = false;

	while (i < seg.length) {
		const ch = seg[i];

		if (inDq) {
			if (ch === '"') {
				if (i + 1 < seg.length && seg[i + 1] === '"') {
					// "" inside quotes → literal "
					result += '"';
					i += 2;
					continue;
				}
				inDq = false;
			} else {
				// Quoted: escape regex metacharacters, preserve case
				if (/[.*+?()[\]{}^$|\\]/.test(ch)) {
					result += `\\${ch}`;
				} else {
					result += ch;
				}
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
					// Pass through (folding to lower-case for unquoted)
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
	checkVis: boolean; // true → apply pg_table_is_visible (no dot in pattern)
}

/**
 * Parse a full psql relation pattern into its components.
 * Handles name-only, schema.name, and schema.* forms.
 */
function parsePattern(pattern: string): ParsedPattern {
	// Collect positions of all unquoted dots
	const dots: number[] = [];
	let inDq = false;

	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (inDq) {
			if (ch === '"') {
				if (i + 1 < pattern.length && pattern[i + 1] === '"') {
					i++; // skip escaped double-quote
				} else {
					inDq = false;
				}
			}
		} else {
			if (ch === '"') inDq = true;
			else if (ch === ".") dots.push(i);
		}
	}

	if (dots.length === 0) {
		// Name-only pattern: visibility filter applies
		return {
			schemaRe: null,
			nameRe: patternSegToRegex(pattern),
			checkVis: true,
		};
	}

	// schema.name (use first dot)
	const dotPos = dots[0];
	return {
		schemaRe: patternSegToRegex(pattern.slice(0, dotPos)),
		nameRe: patternSegToRegex(pattern.slice(dotPos + 1)),
		checkVis: false,
	};
}

// ─── SQL helpers ──────────────────────────────────────────────────────────────

/** Embed a string as a PostgreSQL E'' string literal. */
function sqlStr(s: string): string {
	return `E'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** Validate an OID and return it as a safe SQL literal (integer). */
function safeOid(oid: string): string {
	const n = Number.parseInt(oid, 10);
	if (!Number.isFinite(n) || n < 0 || String(n) !== oid.trim())
		throw new Error(`Invalid OID: ${oid}`);
	return String(n);
}

// ─── Text formatting helpers ─────────────────────────────────────────────────

function padEnd(s: string, width: number): string {
	return s + " ".repeat(Math.max(0, width - s.length));
}

function center(s: string, width: number): string {
	const pad = Math.max(0, width - s.length);
	const left = Math.floor(pad / 2);
	return " ".repeat(left) + s + " ".repeat(pad - left);
}

/**
 * Format a table in psql \d style:
 *   [centered title]
 *    col1 | col2 | ...
 *   ------+------+---
 *    v1   | v2   | ...
 */
function fmtDescribeTable(
	headers: string[],
	rows: string[][],
	title?: string,
): string {
	const widths = headers.map((h) => h.length);
	for (const row of rows) {
		row.forEach((cell, i) => {
			widths[i] = Math.max(widths[i], (cell ?? "").length);
		});
	}

	const sep = widths.map((w) => "-".repeat(w + 2)).join("+");
	const headerRow = headers
		.map((h, i) => ` ${padEnd(h, widths[i])} `)
		.join("|");
	const dataRows = rows.map((row) =>
		row.map((cell, i) => ` ${padEnd(cell ?? "", widths[i])} `).join("|"),
	);

	const lines: string[] = [];
	if (title !== undefined) {
		lines.push(center(title, sep.length));
	}
	lines.push(headerRow, sep, ...dataRows);
	return lines.join("\n");
}

// ─── Describe one relation ────────────────────────────────────────────────────

type Runner = (sql: string) => Promise<QueryResult>;

const RELKIND_NAMES: Record<string, string> = {
	r: "Table",
	p: "Partitioned table",
	v: "View",
	m: "Materialized view",
	S: "Sequence",
	i: "Index",
	f: "Foreign table",
	c: "Composite type",
};

async function describeOne(
	run: Runner,
	schema: string,
	name: string,
	relkind: string,
	oid: string,
	verbose: boolean,
): Promise<string> {
	const o = safeOid(oid);
	const kindName = RELKIND_NAMES[relkind] ?? relkind;
	const title = `${kindName} "${schema}.${name}"`;
	const output: string[] = [];

	// ────────────────────────────────────────────────────────────────────────
	// SEQUENCE
	// ────────────────────────────────────────────────────────────────────────
	if (relkind === "S") {
		const seqRes = await run(`
      SELECT format_type(s.seqtypid, NULL)::text        AS type,
             s.seqstart::text                           AS start,
             s.seqmin::text                             AS minimum,
             s.seqmax::text                             AS maximum,
             s.seqincrement::text                       AS increment,
             CASE s.seqcycle WHEN true THEN 'yes' ELSE 'no' END AS cycles,
             s.seqcache::text                           AS cache
      FROM   pg_sequence s
      WHERE  s.seqrelid = ${o}
    `);

		if (seqRes.rows.length > 0) {
			const r = seqRes.rows[0];
			const rows = [
				[
					String(r["type"] ?? ""),
					String(r["start"] ?? ""),
					String(r["minimum"] ?? ""),
					String(r["maximum"] ?? ""),
					String(r["increment"] ?? ""),
					String(r["cycles"] ?? ""),
					String(r["cache"] ?? ""),
				],
			];
			output.push(
				fmtDescribeTable(
					[
						"Type",
						"Start",
						"Minimum",
						"Maximum",
						"Increment",
						"Cycles?",
						"Cache",
					],
					rows,
					title,
				),
			);
		} else {
			output.push(title);
		}

		// Owned by (serial / identity)
		const ownedRes = await run(`
      SELECT CASE d.deptype
               WHEN 'i' THEN 'Sequence for identity column'
               ELSE 'Owned by'
             END            AS label,
             n.nspname || '.' || c.relname || '.' || a.attname AS owner_col
      FROM   pg_depend    d
      JOIN   pg_class     c ON c.oid = d.refobjid
      JOIN   pg_namespace n ON n.oid = c.relnamespace
      JOIN   pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
      WHERE  d.objid    = ${o}
        AND  d.deptype  IN ('a','i')
        AND  d.classid  = 'pg_class'::regclass
      LIMIT  1
    `);
		if (ownedRes.rows.length > 0) {
			const r = ownedRes.rows[0];
			output.push(`${String(r["label"])}: ${String(r["owner_col"])}`);
		}

		return output.join("\n");
	}

	// ────────────────────────────────────────────────────────────────────────
	// INDEX (describing the index object itself)
	// ────────────────────────────────────────────────────────────────────────
	if (relkind === "i") {
		const colRes = await run(`
      SELECT COALESCE(ta.attname::text, ia.attname::text)  AS col_name,
             format_type(ia.atttypid, ia.atttypmod)::text  AS col_type,
             CASE WHEN k.pos <= ix.indnkeyatts THEN 'yes' ELSE 'no' END AS key,
             pg_get_indexdef(${o}, k.pos::int, true)       AS definition
      FROM   pg_index ix
      CROSS  JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos)
      JOIN   pg_attribute ia
             ON ia.attrelid = ${o} AND ia.attnum = k.pos
      LEFT   JOIN pg_attribute ta
             ON ta.attrelid = ix.indrelid AND ta.attnum = k.attnum AND k.attnum != 0
      WHERE  ix.indexrelid = ${o}
      ORDER  BY k.pos
    `);

		const colRows = colRes.rows.map((r) => [
			String(r["col_name"] ?? ""),
			String(r["col_type"] ?? ""),
			String(r["key"] ?? ""),
			String(r["definition"] ?? ""),
		]);

		output.push(
			fmtDescribeTable(
				["Column", "Type", "Key?", "Definition"],
				colRows,
				title,
			),
		);

		const footerRes = await run(`
      SELECT CASE WHEN ix.indisprimary THEN 'primary key, '
                  WHEN ix.indisunique  THEN 'unique, '
                  ELSE ''
             END
             || am.amname
             || ', for table "' || n.nspname || '.' || t.relname || '"'
             || COALESCE(', predicate (' || pg_get_expr(ix.indpred, ix.indrelid) || ')', '')
             AS footer
      FROM   pg_index     ix
      JOIN   pg_class     t  ON t.oid  = ix.indrelid
      JOIN   pg_namespace n  ON n.oid  = t.relnamespace
      JOIN   pg_class     ic ON ic.oid = ix.indexrelid
      JOIN   pg_am        am ON am.oid = ic.relam
      WHERE  ix.indexrelid = ${o}
    `);
		if (footerRes.rows.length > 0) {
			output.push(String(footerRes.rows[0]["footer"] ?? ""));
		}

		return output.join("\n");
	}

	// ────────────────────────────────────────────────────────────────────────
	// COLUMNS (tables, views, mat views, foreign tables, composite types)
	// ────────────────────────────────────────────────────────────────────────
	let columnRes: QueryResult;

	if (relkind === "f") {
		// Foreign table: FDW column options shown instead of default
		columnRes = await run(`
      SELECT a.attname::text                                     AS col,
             format_type(a.atttypid, a.atttypmod)::text         AS type,
             CASE WHEN a.attcollation NOT IN (
                          0,
                          (SELECT typcollation FROM pg_type WHERE oid = a.atttypid))
                  THEN (SELECT collname FROM pg_collation WHERE oid = a.attcollation)
                  ELSE ''
             END                                                 AS collation,
             CASE WHEN a.attnotnull THEN 'not null' ELSE '' END  AS nullable,
             COALESCE((
               SELECT string_agg(
                        opt.option_name || '=' || quote_literal(opt.option_value),
                        ', ' ORDER BY opt.option_name)
               FROM   pg_options_to_table(a.attfdwoptions) opt
             ), '')                                              AS "default"
      FROM   pg_attribute a
      WHERE  a.attrelid = ${o}
        AND  a.attnum   > 0
        AND  NOT a.attisdropped
      ORDER  BY a.attnum
    `);
	} else {
		columnRes = await run(`
      SELECT a.attname::text                                     AS col,
             format_type(a.atttypid, a.atttypmod)::text         AS type,
             CASE WHEN a.attcollation NOT IN (
                          0,
                          (SELECT typcollation FROM pg_type WHERE oid = a.atttypid))
                  THEN (SELECT collname FROM pg_collation WHERE oid = a.attcollation)
                  ELSE ''
             END                                                 AS collation,
             CASE WHEN a.attnotnull THEN 'not null' ELSE '' END  AS nullable,
             COALESCE(
               CASE
                 WHEN a.attidentity  = 'a' THEN 'generated always as identity'
                 WHEN a.attidentity  = 'd' THEN 'generated by default as identity'
                 WHEN a.attgenerated = 's' THEN
                   'generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
                 ELSE pg_get_expr(d.adbin, d.adrelid)
               END, ''
             )                                                   AS "default"
      FROM   pg_attribute  a
      LEFT   JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE  a.attrelid = ${o}
        AND  a.attnum   > 0
        AND  NOT a.attisdropped
      ORDER  BY a.attnum
    `);
	}

	const hasCollation = columnRes.rows.some(
		(r) => String(r["collation"] ?? "").trim() !== "",
	);
	const colHeaders = hasCollation
		? ["Column", "Type", "Collation", "Nullable", "Default"]
		: ["Column", "Type", "Nullable", "Default"];

	const colRows = columnRes.rows.map((r) => [
		String(r["col"] ?? ""),
		String(r["type"] ?? ""),
		...(hasCollation ? [String(r["collation"] ?? "")] : []),
		String(r["nullable"] ?? ""),
		String(r["default"] ?? ""),
	]);

	output.push(fmtDescribeTable(colHeaders, colRows, title));

	// Object comment (verbose, shown after the column table like psql)
	if (verbose) {
		const commentRes = await run(`
      SELECT obj_description(${o}::oid, 'pg_class') AS comment
    `);
		const comment = commentRes.rows[0]?.["comment"];
		if (comment && String(comment).trim()) {
			output.push(`\n${String(comment)}`);
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// VIEW definition (verbose only)
	// ────────────────────────────────────────────────────────────────────────
	if (relkind === "v") {
		if (verbose) {
			const viewRes = await run(`
        SELECT pg_get_viewdef(${o}, true) AS def
      `);
			if (viewRes.rows.length > 0) {
				const def = String(viewRes.rows[0]["def"] ?? "");
				const lines = def.split("\n").filter((l) => l.trim() !== "");
				output.push("\nView definition:");
				for (const l of lines) output.push(l);
			}
		}
		return output.join("\n");
	}

	// Composite types: columns only, done
	if (relkind === "c") {
		return output.join("\n");
	}

	// ────────────────────────────────────────────────────────────────────────
	// PARTITION KEY (partitioned tables)
	// ────────────────────────────────────────────────────────────────────────
	if (relkind === "p") {
		const pkRes = await run(`
      SELECT pg_get_partkeydef(${o}) AS partition_key
    `);
		const numRes = await run(`
      SELECT count(*)::text AS num FROM pg_inherits WHERE inhparent = ${o}
    `);
		if (pkRes.rows.length > 0) {
			output.push(
				`\nPartition key: ${String(pkRes.rows[0]["partition_key"] ?? "")}`,
			);
		}
		if (numRes.rows.length > 0) {
			output.push(
				`Number of partitions: ${String(numRes.rows[0]["num"] ?? "0")}`,
			);
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// INDEXES (tables, partitioned tables, materialized views)
	// ────────────────────────────────────────────────────────────────────────
	if (["r", "p", "m"].includes(relkind)) {
		const idxRes = await run(`
      SELECT '"' || i.relname || '" '
             || CASE
                  WHEN ix.indisprimary THEN 'PRIMARY KEY, '
                  WHEN ix.indisunique
                   AND EXISTS (
                         SELECT 1 FROM pg_constraint
                         WHERE  conindid = ix.indexrelid AND contype IN ('p','u'))
                       THEN 'UNIQUE CONSTRAINT, '
                  WHEN ix.indisunique THEN 'UNIQUE, '
                  ELSE ''
                END
             || am.amname
             || ' ('
             || (SELECT string_agg(
                          pg_get_indexdef(ix.indexrelid, ks.pos::int, true),
                          ', ' ORDER BY ks.pos)
                 FROM   unnest(ix.indkey) WITH ORDINALITY AS ks(attnum, pos)
                 WHERE  ks.pos <= ix.indnkeyatts)
             || ')'
             || CASE WHEN ix.indnkeyatts < ix.indnatts
                     THEN ' INCLUDE ('
                          || (SELECT string_agg(
                                       pg_get_indexdef(ix.indexrelid, ks.pos::int, true),
                                       ', ' ORDER BY ks.pos)
                              FROM   unnest(ix.indkey) WITH ORDINALITY AS ks(attnum, pos)
                              WHERE  ks.pos > ix.indnkeyatts)
                          || ')'
                     ELSE ''
                END
             || COALESCE(' WHERE ' || pg_get_expr(ix.indpred, ix.indrelid), '')
             AS def
      FROM   pg_index ix
      JOIN   pg_class i  ON i.oid  = ix.indexrelid
      JOIN   pg_am    am ON am.oid = i.relam
      WHERE  ix.indrelid = ${o}
      ORDER  BY ix.indisprimary DESC, ix.indisunique DESC, i.relname
    `);
		if (idxRes.rows.length > 0) {
			output.push("\nIndexes:");
			for (const r of idxRes.rows) {
				output.push(`    ${String(r["def"] ?? "")}`);
			}
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// MATERIALIZED VIEW definition (verbose only)
	// ────────────────────────────────────────────────────────────────────────
	if (relkind === "m" && verbose) {
		const matRes = await run(`
      SELECT pg_get_viewdef(${o}, true) AS def
    `);
		if (matRes.rows.length > 0) {
			const def = String(matRes.rows[0]["def"] ?? "");
			const lines = def.split("\n").filter((l) => l.trim() !== "");
			output.push("\nView definition:");
			for (const l of lines) output.push(l);
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// CHECK CONSTRAINTS (tables, partitioned tables)
	// ────────────────────────────────────────────────────────────────────────
	if (["r", "p"].includes(relkind)) {
		const ckRes = await run(`
      SELECT c.conname::text,
             pg_get_constraintdef(c.oid)::text AS def
      FROM   pg_constraint c
      WHERE  c.conrelid    = ${o}
        AND  c.contype     = 'c'
        AND  c.conparentid = 0
      ORDER  BY c.conname
    `);
		if (ckRes.rows.length > 0) {
			output.push("\nCheck constraints:");
			for (const r of ckRes.rows) {
				output.push(
					`    "${String(r["conname"] ?? "")}" ${String(r["def"] ?? "")}`,
				);
			}
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// FOREIGN-KEY CONSTRAINTS
	// ────────────────────────────────────────────────────────────────────────
	if (["r", "p"].includes(relkind)) {
		const fkRes = await run(`
      SELECT c.conname::text,
             pg_get_constraintdef(c.oid)::text AS def
      FROM   pg_constraint c
      WHERE  c.conrelid = ${o}
        AND  c.contype  = 'f'
      ORDER  BY c.conname
    `);
		if (fkRes.rows.length > 0) {
			output.push("\nForeign-key constraints:");
			for (const r of fkRes.rows) {
				output.push(
					`    "${String(r["conname"] ?? "")}" ${String(r["def"] ?? "")}`,
				);
			}
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// NOT-NULL CONSTRAINTS (verbose; PG18+)
	// ────────────────────────────────────────────────────────────────────────
	if (verbose && ["r", "p", "f"].includes(relkind)) {
		// contype = 'n' only exists in PG18+; on older versions the query
		// simply returns no rows, so no try/catch needed.
		const nnRes = await run(`
      SELECT c.conname::text,
             pg_get_constraintdef(c.oid)::text AS def
      FROM   pg_constraint c
      WHERE  c.conrelid = ${o}
        AND  c.contype  = 'n'
      ORDER  BY c.conname
    `);
		if (nnRes.rows.length > 0) {
			output.push("\nNot-null constraints:");
			for (const r of nnRes.rows) {
				output.push(
					`    "${String(r["conname"] ?? "")}" ${String(r["def"] ?? "")}`,
				);
			}
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// REFERENCED BY
	// ────────────────────────────────────────────────────────────────────────
	if (["r", "p"].includes(relkind)) {
		const refRes = await run(`
      SELECT (n2.nspname || '.' || t2.relname)::text AS tbl,
             c.conname::text,
             pg_get_constraintdef(c.oid)::text        AS def
      FROM   pg_constraint c
      JOIN   pg_class     t2 ON t2.oid = c.conrelid
      JOIN   pg_namespace n2 ON n2.oid = t2.relnamespace
      WHERE  c.confrelid = ${o}
        AND  c.contype   = 'f'
      ORDER  BY n2.nspname || '.' || t2.relname, c.conname
    `);
		if (refRes.rows.length > 0) {
			output.push("\nReferenced by:");
			for (const r of refRes.rows) {
				output.push(
					`    TABLE "${String(r["tbl"] ?? "")}" CONSTRAINT "${String(r["conname"] ?? "")}" ${String(r["def"] ?? "")}`,
				);
			}
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// TRIGGERS (tables, partitioned tables, views)
	// ────────────────────────────────────────────────────────────────────────
	if (["r", "p", "v"].includes(relkind)) {
		const trgRes = await run(`
      SELECT t.tgname::text AS name,
             CASE
               WHEN t.tgtype::int & 64 > 0 THEN 'INSTEAD OF'
               WHEN t.tgtype::int & 2  > 0 THEN 'BEFORE'
               ELSE 'AFTER'
             END
             || ' '
             || CASE WHEN t.tgtype::int & 1 > 0 THEN 'ROW' ELSE 'STATEMENT' END
             AS timing,
             array_to_string(array_remove(ARRAY[
               CASE WHEN t.tgtype::int & 4  > 0 THEN 'INSERT' END,
               CASE WHEN t.tgtype::int & 16 > 0 THEN
                 'UPDATE'
                 || COALESCE(
                      NULLIF(
                        ' OF ' || (
                          SELECT string_agg(a.attname, ', ' ORDER BY u.ord)
                          FROM   unnest(t.tgattr::smallint[]) WITH ORDINALITY AS u(num, ord)
                          JOIN   pg_attribute a
                                 ON a.attrelid = t.tgrelid AND a.attnum = u.num
                        ),
                        ' OF '
                      ),
                      '')
               END,
               CASE WHEN t.tgtype::int & 8  > 0 THEN 'DELETE'   END,
               CASE WHEN t.tgtype::int & 32 > 0 THEN 'TRUNCATE' END
             ], NULL), ' OR ')  AS events,
             (pn.nspname || '.' || p.proname)::text AS func
      FROM   pg_trigger   t
      JOIN   pg_proc      p  ON p.oid  = t.tgfoid
      JOIN   pg_namespace pn ON pn.oid = p.pronamespace
      WHERE  t.tgrelid = ${o}
        AND  NOT t.tgisinternal
      ORDER  BY t.tgname
    `);
		if (trgRes.rows.length > 0) {
			output.push("\nTriggers:");
			for (const r of trgRes.rows) {
				output.push(
					`    ${String(r["name"] ?? "")} ${String(r["timing"] ?? "")} ${String(r["events"] ?? "")} EXECUTE FUNCTION ${String(r["func"] ?? "")}`,
				);
			}
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// FOREIGN TABLE: server and FDW options
	// ────────────────────────────────────────────────────────────────────────
	if (relkind === "f") {
		const ftRes = await run(`
      SELECT fs.srvname::text AS server_name,
             (SELECT string_agg(
                       opt.option_name || '=' || quote_literal(opt.option_value),
                       ', ' ORDER BY opt.option_name)
              FROM   pg_options_to_table(ft.ftoptions) opt) AS tbl_opts
      FROM   pg_foreign_table  ft
      JOIN   pg_foreign_server fs ON fs.oid = ft.ftserver
      WHERE  ft.ftrelid = ${o}
    `);
		if (ftRes.rows.length > 0) {
			const r = ftRes.rows[0];
			output.push(`\nServer: ${String(r["server_name"] ?? "")}`);
			const opts = String(r["tbl_opts"] ?? "");
			if (opts) output.push(`FDW options: (${opts})`);
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// VERBOSE: column details (storage, stats, description)
	// ────────────────────────────────────────────────────────────────────────
	if (verbose && !["v", "S", "i"].includes(relkind)) {
		const cdRes = await run(`
      SELECT a.attname::text AS col,
             CASE a.attstorage
               WHEN 'p' THEN 'plain'
               WHEN 'e' THEN 'external'
               WHEN 'x' THEN 'extended'
               WHEN 'm' THEN 'main'
               ELSE a.attstorage::text
             END                                              AS storage,
             COALESCE(a.attstattarget::text, '')              AS stats_target,
             COALESCE(col_description(a.attrelid, a.attnum), '') AS description
      FROM   pg_attribute a
      WHERE  a.attrelid = ${o}
        AND  a.attnum   > 0
        AND  NOT a.attisdropped
        AND  (   a.attstattarget IS NOT NULL
              OR a.attcompression <> ''
              OR col_description(a.attrelid, a.attnum) IS NOT NULL)
      ORDER  BY a.attnum
    `);
		if (cdRes.rows.length > 0) {
			const cdRows = cdRes.rows.map((r) => [
				String(r["col"] ?? ""),
				String(r["storage"] ?? ""),
				String(r["stats_target"] ?? ""),
				String(r["description"] ?? ""),
			]);
			output.push(
				"\nColumn details:",
				fmtDescribeTable(
					["Column", "Storage", "Stats target", "Description"],
					cdRows,
				),
			);
		}
	}

	// ────────────────────────────────────────────────────────────────────────
	// VERBOSE: replica identity and access method (tables, mat views)
	// ────────────────────────────────────────────────────────────────────────
	if (verbose && ["r", "p", "m"].includes(relkind)) {
		const metaRes = await run(`
      SELECT CASE c.relreplident
               WHEN 'n' THEN 'nothing'
               WHEN 'f' THEN 'full'
               WHEN 'i' THEN 'index'
               ELSE NULL
             END       AS replica_identity,
             am.amname AS access_method
      FROM   pg_class c
      LEFT   JOIN pg_am am ON am.oid = c.relam
      WHERE  c.oid = ${o}
    `);
		if (metaRes.rows.length > 0) {
			const r = metaRes.rows[0];
			const ri = r["replica_identity"];
			if (ri != null && String(ri).trim()) {
				output.push(`\nReplica identity: ${String(ri)}`);
			}
			const am = r["access_method"];
			if (am != null && String(am).trim()) {
				output.push(`Access method: ${String(am)}`);
			}
		}
	}

	return output.join("\n");
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Execute a \d / \d+ describe command.
 *
 * @param args  Everything after \d: "", "+", "tablename", "+ tablename",
 *              "schema.table", "cust*", etc.
 */
export async function executeDescribe(
	client: RDSDataClient,
	resourceArn: string,
	database: string,
	secretArn: string,
	args: string,
	debug = false,
): Promise<string> {
	const trimmed = args.trim();
	const verbose = trimmed.startsWith("+");
	const pattern = (verbose ? trimmed.slice(1) : trimmed).trim() || null;

	const run: Runner = (sql) =>
		executeQuery(
			client,
			resourceArn,
			database,
			sql,
			secretArn,
			undefined,
			undefined,
			debug,
		);

	// ── Listing mode (\d with no pattern) ──
	if (!pattern) {
		const result = await run(`
      SELECT n.nspname::text                   AS "Schema",
             c.relname::text                   AS "Name",
             CASE c.relkind
               WHEN 'r' THEN 'table'
               WHEN 'p' THEN 'partitioned table'
               WHEN 'v' THEN 'view'
               WHEN 'm' THEN 'materialized view'
               WHEN 'S' THEN 'sequence'
               WHEN 'f' THEN 'foreign table'
             END::text                         AS "Type",
             pg_get_userbyid(c.relowner)::text  AS "Owner"
      FROM   pg_class     c
      JOIN   pg_namespace n ON n.oid = c.relnamespace
      WHERE  c.relkind IN ('r','p','v','m','S','f')
        AND  pg_table_is_visible(c.oid)
        AND  n.nspname NOT IN ('pg_catalog','information_schema')
      ORDER  BY n.nspname, c.relname
    `);

		if (result.rows.length === 0) {
			return "Did not find any relations.";
		}

		const rows = result.rows.map((r) => [
			String(r["Schema"] ?? ""),
			String(r["Name"] ?? ""),
			String(r["Type"] ?? ""),
			String(r["Owner"] ?? ""),
		]);
		return fmtDescribeTable(
			["Schema", "Name", "Type", "Owner"],
			rows,
			"List of relations",
		);
	}

	// ── Pattern mode ──
	const parsed = parsePattern(pattern);

	const schemaClause =
		parsed.schemaRe !== null
			? `AND n.nspname ~ ('^' || ${sqlStr(parsed.schemaRe)} || '$')`
			: "";
	const visClause = parsed.checkVis ? "AND pg_table_is_visible(c.oid)" : "";

	const matchRes = await run(`
    SELECT n.nspname::text AS schema,
           c.relname::text AS name,
           c.relkind::text AS relkind,
           c.oid::text     AS oid
    FROM   pg_class     c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  c.relkind IN ('r','p','v','m','S','i','f','c')
      AND  c.relname  ~ ('^' || ${sqlStr(parsed.nameRe)} || '$')
      ${schemaClause}
      ${visClause}
    ORDER  BY n.nspname, c.relname
  `);

	if (matchRes.rows.length === 0) {
		return `Did not find any relation named "${pattern}".`;
	}

	const parts: string[] = [];
	for (const row of matchRes.rows) {
		if (parts.length > 0) {
			parts.push("", "---");
		}
		const section = await describeOne(
			run,
			String(row["schema"]),
			String(row["name"]),
			String(row["relkind"]),
			String(row["oid"]),
			verbose,
		);
		parts.push(section);
	}

	return parts.join("\n");
}
