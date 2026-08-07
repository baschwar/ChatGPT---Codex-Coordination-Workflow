# Security

## Authentication

The preferred long-term authentication model is a GitHub App with least-privilege repository permissions.

The local prototype may use GitHub CLI authentication for development. Broad personal access tokens should not be required when narrower permissions can perform the workflow.

## Required GitHub Permissions

Initial permissions should be limited to:

- read repository contents
- read issues and pull requests
- create issues
- add and remove configured labels
- post issue and pull-request comments
- read checks and commit status

Disabled for the initial release:

- pull-request merge permissions
- branch protection changes
- workflow modification
- repository administration
- destructive repository operations

## Secrets

Secrets must be loaded from environment variables or a local secret manager. Do not commit `.env` files or tokens.

Logs must redact:

- tokens
- authorization headers
- private keys
- webhook secrets
- installation tokens

