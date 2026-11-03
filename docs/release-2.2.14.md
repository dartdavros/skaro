# Skaro 2.2.14

## Changes

- The built-in Skaro agent is explicitly marked **In development**. Its model
  fields, connection/route controls and picker entry are disabled. Ordinary task
  and chat model hosts remain disabled in the backend; Skaro is not the default.
- Development work on native tool progress, model catalogs, credential handling,
  task/chat lifecycle, history, usage receipts and verification evidence is
  retained behind the closed product gate. It is not advertised as accepted
  live task execution or completed Cat-pilot work.
- Windows command checks stay on Windows. POSIX command tests use actual sh/bash
  processes. Release tests use bounded concurrency and explicit deadlines.

## Verification and scope

The owner authorized the standard complete release suite with its existing
isolated fixtures and HTTP test servers, and reuse of accepted checks for
unchanged Codex/Claude pins with the existing Claude limitation. No new model
calls or successful Claude canary are claimed. The owner will perform UI review.

Production build, type checks, lint, formatting and the complete release suite
must pass before publishing. CI builds all six native installers and verifies
their manifests, sizes and SHA512. The public description retains the direct
Windows/macOS/Linux by x64/arm64 installer table.

Bundle and displayed version: **2.2.14**. Agent/SDK pins, adapter versions and
the existing publisher-signing policy remain unchanged. Full built-in-agent
acceptance, default activation and Cat-pilot T-006/T-008 remain outside this
development-preview release.
