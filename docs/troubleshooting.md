# Troubleshooting

## Directive Rejected

Check that all required directive sections are present and that explicit approval evidence is provided.

## Approval Ambiguous

Revise the approval input to contain an unambiguous implementation approval, such as `Create the issue` or `Proceed with implementation`.

## Governance File Missing

Restore the configured governance file or update `.github/chatgpt-coordinator.yml` if the repository authority changed.

## Permission Failure

Verify the GitHub App installation has only the required permissions and is installed on the target repository.

## Duplicate Task Candidate

Review existing open issues with similar titles, source references, or acceptance criteria before creating a new implementation issue.

## Rate Limited

Retry after the GitHub rate-limit reset time. The adapter should preserve a redacted audit record for the failed request.

