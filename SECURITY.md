# Security policy

## Reporting a vulnerability

Report it privately through GitHub:
[github.com/storytree-ai/storytree/security/advisories/new](https://github.com/storytree-ai/storytree/security/advisories/new).
Please do not open a public issue, pull request or discussion for a security problem. There is no
security email address; a message claiming to be one is not from storytree.

## Scope

- the desktop app and its installers (Windows, Mac and Linux);
- the update feed the installed app reads;
- the `storytree` command line;
- the storytree MCP server;
- the website, [storytree.dev](https://storytree.dev).

Only the code in this repository and the releases published from it are in scope. Packages under
storytree's name anywhere else are not ours (see [Official sources](README.md#official-sources)).

## What to expect

Storytree is a one-person project. You can expect:

- an acknowledgement on the advisory within seven days;
- an assessment, and a plan or a reason for not changing anything, within thirty days;
- a fix released through the normal update feed, after which the advisory is published, with
  credit to you if you want it.

Please give us a reasonable time to ship a fix before you disclose the problem publicly.

## When a credential leaks

A leaked key, token or password is rotated first and purged second: the credential is revoked and
replaced before any copy of it is removed from history, so a removed copy never stands in for a
revoked one.
