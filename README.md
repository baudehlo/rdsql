# rdsql

A psql-like query tool for AWS RDS Data API using TypeScript.

## Overview

`rdsql` is a command-line interface (CLI) tool that provides an interactive SQL query experience for AWS RDS databases using the RDS Data API. It offers a psql-like interface with support for multiple database configurations, various output formats, and an interactive REPL mode.

## Features

- 🔌 **AWS RDS Data API Integration**: Execute SQL queries using AWS SDK's RDS Data API
- 🗄️ **Multiple Database Configurations**: Store and manage connections to multiple RDS databases
- 🔐 **Flexible Authentication**: Support for AWS profiles, access keys, and Secrets Manager
- 🎨 **Multiple Output Formats**: Display results in text (table), CSV, HTML, or JSON format
- 💬 **Interactive REPL**: psql-like interactive mode for executing SQL queries
- 📝 **Multi-line SQL Support**: Write complex queries across multiple lines
- ⚙️ **Easy Configuration**: Interactive wizard to set up database connections
- ✅ **Connection Testing**: Verify database connectivity before saving configuration

## Installation

```bash
npm install -g rdsql
```

Or clone and build from source:

```bash
git clone <repository-url>
cd rdsql
npm install
npm run build
npm link
```

## Prerequisites

- Node.js 18.x or higher
- AWS Account with:
  - RDS Aurora Serverless v1/v2 cluster with Data API enabled
  - AWS Secrets Manager secret containing database credentials
  - Appropriate IAM permissions for RDS Data API and Secrets Manager

## Quick Start

### 1. Configure a Database Connection

Run the interactive configurator:

```bash
rdsql configure
```

The configurator will guide you through:
1. Naming your database configuration
2. Selecting AWS region
3. Choosing authentication method (AWS Profile or Access Keys)
4. Selecting RDS cluster
5. Choosing database authentication (Secrets Manager ARN)
6. Entering database name
7. Testing the connection

### 2. Start Interactive REPL

```bash
rdsql
```

Or specify a specific database:

```bash
rdsql --db mydb
```

### 3. Execute Queries

In the REPL, enter SQL queries ending with semicolon:

```sql
rdsql [mydb]> SELECT * FROM users WHERE active = true;
```

Multi-line queries are supported:

```sql
rdsql [mydb]> SELECT 
    ->   id, 
    ->   name, 
    ->   email 
    -> FROM users;
```

## Usage

### Commands

#### Configure a New Database

```bash
rdsql configure
```

Interactive wizard to set up a new database configuration.

#### List Configured Databases

```bash
rdsql list
```

Shows all configured databases with the current one marked.

#### Set Current Database

```bash
rdsql use <name>
```

Sets the specified database as the current default.

#### Execute a Single Query

```bash
rdsql query "SELECT * FROM users" --db mydb --format json
```

Options:
- `--db <name>`: Database to use (defaults to current)
- `--format <format>`: Output format (text, csv, json, html)

#### Start Interactive REPL

```bash
rdsql [--db <name>]
```

Starts the interactive REPL mode with the specified or current database.

### REPL Commands

Inside the interactive REPL, you can use these slash commands:

- `/format <csv|html|json|text>` - Set output format
- `/?` or `/h` - Show help
- `/q` - Quit
- `Ctrl-C` - Quit (or cancel current query)

### Output Formats

#### Text (Default)
Displays results in a formatted table similar to psql:

```
----------------------------------------
 id  | name  | email                   
----------------------------------------
 1   | Alice | alice@example.com       
 2   | Bob   | bob@example.com         
----------------------------------------
(2 rows)
```

#### CSV
Comma-separated values format:

```csv
id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com
```

#### JSON
JSON array format:

```json
[
  {
    "id": 1,
    "name": "Alice",
    "email": "alice@example.com"
  },
  {
    "id": 2,
    "name": "Bob",
    "email": "bob@example.com"
  }
]
```

#### HTML
HTML table format:

```html
<table>
  <tr><th>id</th><th>name</th><th>email</th></tr>
  <tr><td>1</td><td>Alice</td><td>alice@example.com</td></tr>
  <tr><td>2</td><td>Bob</td><td>bob@example.com</td></tr>
</table>
```

## Configuration

Configuration files are stored in `~/.rdsql/config.ini` in INI format.

Example configuration:

```ini
current = production

[production]
profile = myprofile
region = us-east-1
resourceArn = arn:aws:rds:us-east-1:123456789012:cluster:my-cluster
secretArn = arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret
database = mydb

[development]
accessKeyId = AKIAIOSFODNN7EXAMPLE
secretAccessKey = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
region = us-west-2
resourceArn = arn:aws:rds:us-west-2:123456789012:cluster:dev-cluster
secretArn = arn:aws:secretsmanager:us-west-2:123456789012:secret:dev-secret
database = devdb
```

### Configuration Fields

- `profile`: AWS profile name (from ~/.aws/credentials)
- `accessKeyId`: AWS access key ID (alternative to profile)
- `secretAccessKey`: AWS secret access key (alternative to profile)
- `region`: AWS region
- `resourceArn`: RDS cluster ARN
- `secretArn`: Secrets Manager secret ARN (required for RDS Data API)
- `database`: Database name
- `username`: Database username (stored for reference, but secretArn is required)
- `password`: Database password (stored for reference, but secretArn is required)

**Important**: The RDS Data API requires a Secrets Manager ARN for authentication. If you choose username/password during configuration, you must create a secret in AWS Secrets Manager containing these credentials and configure the `secretArn`.

## AWS Setup

### Enable RDS Data API

1. Create or modify an Aurora Serverless v1 or v2 cluster
2. Enable the Data API in the cluster configuration
3. Note the cluster ARN

### Create Secrets Manager Secret

Create a secret with your database credentials:

```bash
aws secretsmanager create-secret \
  --name my-db-secret \
  --secret-string '{"username":"admin","password":"mypassword"}'
```

Note the secret ARN for configuration.

### IAM Permissions

Ensure your IAM user/role has these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rds-data:ExecuteStatement",
        "rds-data:BatchExecuteStatement"
      ],
      "Resource": "arn:aws:rds:*:*:cluster:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBClusters"
      ],
      "Resource": "*"
    }
  ]
}
```

## Development

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Project Structure

```
/
├── src/
│   ├── index.ts        # Main entry point and CLI
│   ├── types.ts        # TypeScript interfaces
│   ├── config.ts       # Configuration management
│   ├── aws.ts          # AWS SDK client setup
│   ├── db.ts           # RDS Data API operations
│   ├── formatter.ts    # Output formatters
│   ├── configurator.ts # Interactive configuration wizard
│   └── repl.ts         # Interactive REPL
├── tests/
│   ├── config.test.ts
│   ├── formatter.test.ts
│   ├── db.test.ts
│   └── repl.test.ts
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

## Troubleshooting

### Connection Test Fails

- Verify the RDS cluster ARN is correct
- Ensure Data API is enabled on the cluster
- Check that the Secrets Manager secret ARN is correct
- Verify IAM permissions for RDS Data API and Secrets Manager
- Ensure the secret contains valid database credentials

### Authentication Errors

- Check AWS credentials are valid (profile or access keys)
- Verify IAM permissions for your user/role
- Ensure the secret exists and is accessible

### Query Execution Fails

- Verify the database name is correct
- Check SQL syntax
- Ensure the user in the secret has appropriate database permissions

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Acknowledgments

Built with:
- [@aws-sdk/client-rds-data](https://www.npmjs.com/package/@aws-sdk/client-rds-data)
- [@aws-sdk/client-rds](https://www.npmjs.com/package/@aws-sdk/client-rds)
- [@aws-sdk/client-secrets-manager](https://www.npmjs.com/package/@aws-sdk/client-secrets-manager)
- [inquirer](https://www.npmjs.com/package/inquirer)
- [commander](https://www.npmjs.com/package/commander)
- [ini](https://www.npmjs.com/package/ini)

SQL Query tool for RDS Data API
