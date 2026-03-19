import { DescribeDBClustersCommand, RDSClient } from "@aws-sdk/client-rds";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
	ListSecretsCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";
import type { DatabaseConfig } from "./types";

export function createRdsDataClient(config: DatabaseConfig): RDSDataClient {
	const clientConfig: {
		region: string;
		credentials?:
			| ReturnType<typeof fromIni>
			| { accessKeyId: string; secretAccessKey: string };
	} = {
		region: config.region,
	};

	if (config.profile) {
		clientConfig.credentials = fromIni({ profile: config.profile });
	} else if (config.accessKeyId && config.secretAccessKey) {
		clientConfig.credentials = {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		};
	}

	return new RDSDataClient(clientConfig);
}

export function createRdsClient(
	region: string,
	credentials?: {
		profile?: string;
		accessKeyId?: string;
		secretAccessKey?: string;
	},
): RDSClient {
	const clientConfig: {
		region: string;
		credentials?:
			| ReturnType<typeof fromIni>
			| { accessKeyId: string; secretAccessKey: string };
	} = {
		region,
	};

	if (credentials?.profile) {
		clientConfig.credentials = fromIni({ profile: credentials.profile });
	} else if (credentials?.accessKeyId && credentials?.secretAccessKey) {
		clientConfig.credentials = {
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
		};
	}

	return new RDSClient(clientConfig);
}

export function createSecretsManagerClient(
	region: string,
	credentials?: {
		profile?: string;
		accessKeyId?: string;
		secretAccessKey?: string;
	},
): SecretsManagerClient {
	const clientConfig: {
		region: string;
		credentials?:
			| ReturnType<typeof fromIni>
			| { accessKeyId: string; secretAccessKey: string };
	} = {
		region,
	};

	if (credentials?.profile) {
		clientConfig.credentials = fromIni({ profile: credentials.profile });
	} else if (credentials?.accessKeyId && credentials?.secretAccessKey) {
		clientConfig.credentials = {
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
		};
	}

	return new SecretsManagerClient(clientConfig);
}

export async function listRdsClusters(
	region: string,
	credentials?: {
		profile?: string;
		accessKeyId?: string;
		secretAccessKey?: string;
	},
): Promise<Array<{ arn: string; identifier: string }>> {
	const client = createRdsClient(region, credentials);

	try {
		const command = new DescribeDBClustersCommand({});
		const response = await client.send(command);

		const clusters = response.DBClusters || [];
		return clusters
			.filter((cluster) => cluster.DBClusterArn && cluster.DBClusterIdentifier)
			.map((cluster) => ({
				arn: cluster.DBClusterArn as string,
				identifier: cluster.DBClusterIdentifier as string,
			}));
	} catch (error) {
		throw new Error(`Failed to list RDS clusters: ${error}`);
	}
}

export async function listSecrets(
	region: string,
	credentials?: {
		profile?: string;
		accessKeyId?: string;
		secretAccessKey?: string;
	},
): Promise<Array<{ arn: string; name: string }>> {
	const client = createSecretsManagerClient(region, credentials);

	try {
		const command = new ListSecretsCommand({});
		const response = await client.send(command);

		const secrets = response.SecretList || [];
		return secrets
			.filter((secret) => secret.ARN && secret.Name)
			.map((secret) => ({
				arn: secret.ARN as string,
				name: secret.Name as string,
			}));
	} catch (error) {
		throw new Error(`Failed to list secrets: ${error}`);
	}
}
