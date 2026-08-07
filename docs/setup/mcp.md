# MCP Setup Guide

The MCP server will expose intentional workflow tools for ChatGPT clients.

## Planned Capabilities

- project-context reads
- ready-task discovery
- approved directive creation
- progress inspection
- review-ready discovery
- structured review posting
- task comments
- human approval records

## Authentication

The MCP server should use the GitHub adapter and its configured auth provider. It should not ask ChatGPT callers to pass raw tokens in tool arguments.

## Structured Errors

Tools should return typed errors for:

- missing configuration
- invalid configuration
- missing governance files
- conflicting governance instructions
- ambiguous approval
- duplicate task candidates
- permission failures
- rate limits
- GitHub API failures

