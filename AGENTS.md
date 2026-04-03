# Agent: opencode-biometrics-plugin

**Team:** OpenSIN-AI  
**Protocol:** A2A (Agent-to-Agent)  
**Status:** Active  
**Repository:** https://github.com/OpenSIN-AI/opencode-biometrics-plugin

## Capabilities

Biometrics plugin for OpenCode providing authentication and identity verification capabilities.

## Communication

- **Input:** A2A messages from orchestrator
- **Output:** A2A messages to other agents
- **MCP:** Standard OpenSIN MCP servers

## Security

- All operations logged to OpenSIN-Ledger
- Requires authorization token
- Guardrails enforced on all inputs/outputs

## Setup

```bash
git clone https://github.com/OpenSIN-AI/opencode-biometrics-plugin.git
cd opencode-biometrics-plugin
npm install
npm start
```

## License

MIT
