import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ini from "ini";
import * as inquirer from "inquirer";
import { listRdsClusters, listSecrets } from "./aws";
import { readConfig, writeConfig } from "./config";
import { testConnection } from "./db";
import type { DatabaseConfig } from "./types";

function getAwsProfiles(): string[] {
	const credentialsPath = path.join(os.homedir(), ".aws", "credentials");

	if (!fs.existsSync(credentialsPath)) {
		return [];
	}

	try {
		const content = fs.readFileSync(credentialsPath, "utf-8");
		const parsed = ini.parse(content);
		return Object.keys(parsed);
	} catch (error) {
		console.error("Failed to read AWS credentials file:", error);
		return [];
	}
}

export async function runConfigurator(): Promise<void> {
	console.log("\n🔧 RDS Data API Configuration Wizard\n");

	const answers = await inquirer.prompt([
		{
			type: "input",
			name: "configName",
			message: "Enter a name for this database configuration:",
			validate: (input: string) => {
				if (!input || input.trim().length === 0) {
					return "Configuration name is required";
				}
				return true;
			},
		},
		{
			type: "input",
			name: "region",
			message: "Enter AWS region:",
			default: "us-east-1",
			validate: (input: string) => {
				if (!input || input.trim().length === 0) {
					return "Region is required";
				}
				return true;
			},
		},
	]);

	const awsProfiles = getAwsProfiles();
	let authMethod: string;
	let profile: string | undefined;
	let accessKeyId: string | undefined;
	let secretAccessKey: string | undefined;

	if (awsProfiles.length > 0) {
		const authAnswer = await inquirer.prompt([
			{
				type: "list",
				name: "authMethod",
				message: "Choose authentication method:",
				choices: ["AWS Profile", "Access Keys"],
			},
		]);
		authMethod = authAnswer.authMethod;

		if (authMethod === "AWS Profile") {
			const profileAnswer = await inquirer.prompt([
				{
					type: "list",
					name: "profile",
					message: "Select AWS profile:",
					choices: awsProfiles,
				},
			]);
			profile = profileAnswer.profile;
		} else {
			const keysAnswer = await inquirer.prompt([
				{
					type: "input",
					name: "accessKeyId",
					message: "Enter AWS Access Key ID:",
					validate: (input: string) =>
						input.trim().length > 0 ? true : "Access Key ID is required",
				},
				{
					type: "password",
					name: "secretAccessKey",
					message: "Enter AWS Secret Access Key:",
					validate: (input: string) =>
						input.trim().length > 0 ? true : "Secret Access Key is required",
				},
			]);
			accessKeyId = keysAnswer.accessKeyId;
			secretAccessKey = keysAnswer.secretAccessKey;
		}
	} else {
		const keysAnswer = await inquirer.prompt([
			{
				type: "input",
				name: "accessKeyId",
				message: "Enter AWS Access Key ID:",
				validate: (input: string) =>
					input.trim().length > 0 ? true : "Access Key ID is required",
			},
			{
				type: "password",
				name: "secretAccessKey",
				message: "Enter AWS Secret Access Key:",
				validate: (input: string) =>
					input.trim().length > 0 ? true : "Secret Access Key is required",
			},
		]);
		accessKeyId = keysAnswer.accessKeyId;
		secretAccessKey = keysAnswer.secretAccessKey;
	}

	console.log("\n📋 Fetching RDS clusters...");

	let clusters: Array<{ arn: string; identifier: string }> = [];
	try {
		clusters = await listRdsClusters(answers.region, {
			profile,
			accessKeyId,
			secretAccessKey,
		});
	} catch (error) {
		console.error("Failed to list RDS clusters:", error);
	}

	let resourceArn: string;

	if (clusters.length > 0) {
		const clusterAnswer = await inquirer.prompt([
			{
				type: "list",
				name: "cluster",
				message: "Select RDS cluster:",
				choices: clusters.map((c) => ({
					name: `${c.identifier} (${c.arn})`,
					value: c.arn,
				})),
			},
		]);
		resourceArn = clusterAnswer.cluster;
	} else {
		const arnAnswer = await inquirer.prompt([
			{
				type: "input",
				name: "resourceArn",
				message: "No clusters found. Enter RDS cluster ARN manually:",
				validate: (input: string) =>
					input.trim().length > 0 ? true : "Resource ARN is required",
			},
		]);
		resourceArn = arnAnswer.resourceArn;
	}

	const dbAuthAnswer = await inquirer.prompt([
		{
			type: "list",
			name: "dbAuthMethod",
			message: "Choose database authentication method:",
			choices: ["Secrets Manager", "Username/Password"],
		},
	]);

	let secretArn: string | undefined;
	let username: string | undefined;
	let password: string | undefined;

	if (dbAuthAnswer.dbAuthMethod === "Secrets Manager") {
		console.log("\n🔐 Fetching secrets...");

		let secrets: Array<{ arn: string; name: string }> = [];
		try {
			secrets = await listSecrets(answers.region, {
				profile,
				accessKeyId,
				secretAccessKey,
			});
		} catch (error) {
			console.error("Failed to list secrets:", error);
		}

		if (secrets.length > 0) {
			const secretAnswer = await inquirer.prompt([
				{
					type: "list",
					name: "secret",
					message: "Select Secrets Manager secret:",
					choices: secrets.map((s) => ({
						name: `${s.name} (${s.arn})`,
						value: s.arn,
					})),
				},
			]);
			secretArn = secretAnswer.secret;
		} else {
			const secretArnAnswer = await inquirer.prompt([
				{
					type: "input",
					name: "secretArn",
					message: "No secrets found. Enter Secrets Manager ARN manually:",
					validate: (input: string) =>
						input.trim().length > 0 ? true : "Secret ARN is required",
				},
			]);
			secretArn = secretArnAnswer.secretArn;
		}
	} else {
		const credAnswer = await inquirer.prompt([
			{
				type: "input",
				name: "username",
				message: "Enter database username:",
				validate: (input: string) =>
					input.trim().length > 0 ? true : "Username is required",
			},
			{
				type: "password",
				name: "password",
				message: "Enter database password:",
				validate: (input: string) =>
					input.trim().length > 0 ? true : "Password is required",
			},
		]);
		username = credAnswer.username;
		password = credAnswer.password;

		console.log(
			"\n⚠️  Note: RDS Data API requires Secrets Manager for authentication.",
		);
		console.log(
			"   Please create a secret in AWS Secrets Manager with these credentials,",
		);
		console.log(
			'   then run the configurator again and select "Secrets Manager".\n',
		);
	}

	const databaseAnswer = await inquirer.prompt([
		{
			type: "input",
			name: "database",
			message: "Enter database name:",
			validate: (input: string) =>
				input.trim().length > 0 ? true : "Database name is required",
		},
	]);

	const dbConfig: DatabaseConfig = {
		profile,
		accessKeyId,
		secretAccessKey,
		region: answers.region,
		resourceArn,
		secretArn,
		database: databaseAnswer.database,
		username,
		password,
	};

	if (secretArn) {
		console.log("\n🔌 Testing connection...");
		try {
			await testConnection(dbConfig);
			console.log("✅ Connection successful!");
		} catch (error) {
			console.error("❌ Connection test failed:", error);
			const continueAnswer = await inquirer.prompt([
				{
					type: "confirm",
					name: "continue",
					message: "Save configuration anyway?",
					default: false,
				},
			]);

			if (!continueAnswer.continue) {
				console.log("Configuration cancelled.");
				return;
			}
		}
	}

	const config = readConfig();
	config.databases[answers.configName] = dbConfig;

	if (!config.current) {
		config.current = answers.configName;
	}

	writeConfig(config);
	console.log(`\n✅ Configuration '${answers.configName}' saved successfully!`);

	if (config.current === answers.configName) {
		console.log(`Set as current database.`);
	}
}
