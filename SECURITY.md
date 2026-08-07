# Security Policy

## Supported Versions

VersiGo is an experimental, AI-generated project. The project currently does
not make any support or maintenance commitments for past releases.

| Version | Supported          |
|---------|--------------------|
| latest  | :white_check_mark: |
| older   | :x:                |

Security fixes are applied to the current development branch and released with
the next version tag.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**
Use **GitHub Security Advisories** instead, which creates a private report
that only the repository maintainers can see:

1. Open the repository on GitHub.
2. Go to **Security** -> **Report a vulnerability** (or use the direct URL
   `https://github.com/M0P/insura/security/advisories/new`).
3. Describe the vulnerability, including:
   - the affected component and version,
   - a description of the vulnerability and its impact,
   - steps to reproduce (if possible),
   - any suggested fix, if you have one.

You can expect a response within a reasonable time frame (typically a few
days). If the issue is confirmed, a security advisory and a fixed release will
be prepared. The vulnerability is disclosed publicly only after a fix is
available.

## Security Notes for Operators

VersiGo is **experimental and not security-audited**. It is **not intended for
internet-facing operation**. Run it only in a trusted, isolated private
environment and do not store production or highly sensitive data without your
own security review. See the README warning box for details.

- All secrets (`SESSION_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `POSTGRES_*`,
  integration tokens/API keys) must be replaced with strong, individually
  generated values in `.env` (`openssl rand -hex 32`).
- For beta/production operation `NODE_ENV=production` must be set: only then
  do the security guarantees apply (no automatic default admin, rejection of
  the placeholder password, session cookie with `Secure` flag, auth fail-fast).
- Backup responsibilities remain with the operator (see
  `docs/docker-image-guide.md` section 8).
