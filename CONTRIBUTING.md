# Contributing

1. Use Node 22 and pnpm 9.15.0.
2. Run `pnpm lint && pnpm typecheck && pnpm test` before opening a pull request.
3. CI runs on `main` and on pull requests. It migrates Postgres, runs the test suite, builds, smokes `/v1`, and runs Playwright.
4. Do not commit `.env`, `data/`, or packed tarballs under `dist-tarballs/`.
5. Public SDK changes should stay packable via `./scripts/pack-sdks.sh`.

See [AGENT.md](./AGENT.md) for repo conventions and [SECURITY.md](./SECURITY.md) for disclosure.
