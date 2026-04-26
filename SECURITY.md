# Security Policy

## Supported Versions

Wind Comic is currently in active development. Security fixes land on `main` and the most recent tagged release.

| Version | Supported          |
| ------- | ------------------ |
| 2.12.x  | :white_check_mark: |
| < 2.12  | :x:                |

## Reporting a Vulnerability

**Please do not file a public GitHub issue for security vulnerabilities.**

Email the maintainer directly at **chenhaorui667788@gmail.com** with:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept)
- Affected version(s) and configuration
- Your suggested fix, if any

You should receive an acknowledgement within **72 hours**. If the issue is confirmed, we aim to release a fix within **14 days** depending on complexity, and will credit you in the release notes (unless you prefer to remain anonymous).

## Scope

In scope:

- Authentication / authorization bypass
- Server-side request forgery via API proxies
- Prompt injection that exfiltrates secrets or escalates privilege
- Path traversal or unsafe file operations in the orchestrator
- SQL injection / unsafe DB queries

Out of scope:

- Vulnerabilities in third-party AI providers (report directly to them)
- Issues that require physical access to the host
- Rate-limiting or DoS against your own dev instance
- Self-hosted deployment misconfigurations (those are your responsibility)

## Hardening Checklist for Self-Hosters

- [ ] Never commit `.env.local` — only `.env.example` is tracked
- [ ] Set strong `JWT_SECRET` (32+ random chars)
- [ ] Restrict invite codes — do not expose `/dashboard/invite` publicly
- [ ] Put your instance behind a reverse proxy with TLS
- [ ] Rotate AI provider keys regularly
- [ ] Monitor SQLite DB file (`data/qfmj.db`) — back it up, restrict file perms

## Known Limitations

- The default SQLite backend is single-process. For multi-tenant production use, plan to migrate to PostgreSQL (tracked in ROADMAP §5).
- LLM and image-gen API calls are passed through as-is — set per-user quotas at the gateway level if you expose this to untrusted users.
