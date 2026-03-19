import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reportsDirectory: "coverage",
			exclude: ["node_modules", "dist"],
			thresholds: {
				branches: 60,
				functions: 70,
				lines: 70,
				statements: 70,
			},
		},
	},
});
