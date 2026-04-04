# OpenCode Plugin: BIOMETRICS

This repository contains an OpenCode plugin that bootstraps and operates the BIOMETRICS V3 control-plane as a repo-first package.

## What it provides

- Tools (OpenCode custom tools):
  - `biometrics.bootstrap_plans` — creates `~/.sisyphus/plans/<project>/boulder.json` scaffolding.
  - `biometrics.clone_repo` — clones the BIOMETRICS repo into a target directory.
  - `biometrics.onboard` — runs `./biometrics-onboard` in the BIOMETRICS repo (interactive by default).
  - `biometrics.check_gates` — runs `./scripts/release/check-gates.sh` in the BIOMETRICS repo.

## Install (repo-first)

Add a loader to your project:

- `.opencode/plugins/biometrics.ts`:
  - `import plugin from "<path-to-this-repo>/plugins/biometrics.ts"; export default plugin;`

Then start OpenCode in that project and call the tools from your agent workflow.

## Safety

The plugin does not run privileged installers automatically. If you run onboarding with non-interactive flags, you are explicitly opting into automation.

## 📚 Documentation

This repository follows the [Global Dev Docs Standard](https://github.com/OpenSIN-AI/Global-Dev-Docs-Standard).

For contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).
For security policy, see [SECURITY.md](SECURITY.md).
For the complete OpenSIN ecosystem, see [OpenSIN-AI Organization](https://github.com/OpenSIN-AI).

## 🔗 See Also

- [OpenSIN Core](https://github.com/OpenSIN-AI/OpenSIN) — Main platform
- [OpenSIN-Code](https://github.com/OpenSIN-AI/OpenSIN-Code) — CLI
- [OpenSIN-backend](https://github.com/OpenSIN-AI/OpenSIN-backend) — Backend
- [OpenSIN-Infrastructure](https://github.com/OpenSIN-AI/OpenSIN-Infrastructure) — Deploy
- [Global Dev Docs Standard](https://github.com/OpenSIN-AI/Global-Dev-Docs-Standard) — Docs