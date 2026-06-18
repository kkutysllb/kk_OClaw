---
name: security-review
description: >-
  Use this skill for security-focused review of code, PRs, architecture,
  authentication, authorization, secrets, input handling, dependencies, and
  deployment configuration.
---

# Security Review Skill

## Purpose

Identify security risks before code is shipped.

## Workflow

1. Locate trust boundaries and privileged operations.
2. Review authentication, authorization, and data access paths.
3. Check input parsing, file access, URL fetching, command execution, and SQL.
4. Inspect secrets, logs, dependency changes, and deployment config.
5. Produce findings with severity and concrete remediation.

## Review Checklist

- Findings cite specific files or decisions.
- Risk is prioritized by exploitability and impact.
- Automatic fixes are limited to deterministic safe changes.
- Sensitive details are not included in user-facing output.
