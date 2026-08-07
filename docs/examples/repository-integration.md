# Example Repository Integration

To add the coordinator to a repository:

1. Add `.github/chatgpt-coordinator.yml`.
2. Choose project-specific labels.
3. List governance files that must be read before issue creation or review.
4. Configure approval gates.
5. Install the GitHub App on the repository.
6. Run config validation.
7. Test issue preview with a non-production directive.
8. Create issues only after explicit human approval.

## GitHub App, MCP Server, Custom App, Custom GPT

A GitHub App grants scoped repository access and performs GitHub operations.

An MCP server exposes high-level workflow tools to ChatGPT or other clients.

A ChatGPT custom app can provide a user-facing integration surface, but it is not by itself the durable coordination record.

A custom GPT can carry instructions and conversational behavior, but it is not the workflow system. GitHub remains the durable task record.

Repository configuration defines local labels, governance files, gates, and review inputs for each participating repository.

