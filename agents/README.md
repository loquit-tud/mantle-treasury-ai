# AgentTreasury — Agent Configuration

This directory contains the OpenClaw-compatible agent workspace.

## Structure

```
agents/
├── AGENTS.md            # Top-level instructions (which agents exist)
├── SOUL.md              # Global personality / behavioral constraints
├── TOOLS.md             # Available MCP tools
├── treasury/
│   └── SKILL.md         # Treasury Agent skill definition
└── credit/
    └── SKILL.md         # Credit Agent skill definition
```

## How agents communicate

All three agents publish events through the backend EventBus.
OpenClaw can orchestrate them via `sessions_send` (agent-to-agent).
The Risk Agent participates in Board Meetings as an advisory voice — it does not execute transactions.
