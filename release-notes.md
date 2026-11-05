Skaro 2.2.19

- Let project chats and current tasks register a missing project environment through `setup_environment`, without manually editing `.skaro/config.yaml`.
- Preserve existing configuration and reject stale writes or replacement of an existing environment. Task-specific adjustments remain available through `configure_environment`.
- Guide agents to configure and verify real services before dependent implementation, instead of getting stuck between unavailable setup tools and forbidden direct edits.
- Return current shell variables after environment startup so verification uses the correct Compose configuration and allocated ports.
- Check actual Compose container states before reporting readiness, including services that crash after `docker compose up --wait` returns.
