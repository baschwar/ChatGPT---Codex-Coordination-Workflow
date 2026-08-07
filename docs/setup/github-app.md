# GitHub App Setup Guide

The preferred reusable deployment model is a GitHub App installed only on participating repositories.

## Minimum Permission Rationale

| Permission | Access | Rationale |
| --- | --- | --- |
| Contents | Read | Read governance files and changed files. |
| Issues | Read/Write | Create implementation issues, apply labels, and post comments. |
| Pull requests | Read/Write | Read PR context and post review comments. |
| Metadata | Read | Required by GitHub Apps. |
| Checks | Read | Inspect automated validation status. |
| Commit statuses | Read | Inspect status checks where checks API is not enough. |

Do not grant administration, branch-protection, workflow-write, deployment, or merge privileges for the initial release.

## Local Secret Inputs

Use environment variables or a local secret manager:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY_PATH`
- `GITHUB_APP_INSTALLATION_ID`

Never commit private keys, installation tokens, or `.env` files.

