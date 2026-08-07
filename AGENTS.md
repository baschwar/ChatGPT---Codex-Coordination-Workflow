# Agent Instructions

This repository defines a reusable ChatGPT-GitHub coordination workflow.

## Core Rules

- Keep core workflow logic repository-neutral.
- Do not hard-code CDW Studio labels, paths, milestones, or physical-validation rules.
- Preserve explicit human approval gates.
- Do not treat passing automated tests as manual or physical validation.
- Do not automatically merge pull requests in the initial release.
- Do not commit secrets.
- Prefer small, testable TypeScript packages with strict typing.

## Review Expectations

When reviewing task progress, inspect configured governance files, issue body, issue comments, related pull requests, commits, changed files, checks, and review comments before posting a conclusion.

