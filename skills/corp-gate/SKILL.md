---
name: corp-gate
description: Use CorpGate MCP variables for service URLs, API keys and passwords without exposing their stored values to the model. Use when discovering or reusing Vault variables, requesting local human secret input, or configuring and recovering a CorpGate proxy connection.
---

# CorpGate

CorpGate lets an agent read configuration files and work with real services while registered values with masking enabled are replaced in supported outgoing fields before reaching the model. The proxy restores symbolic variables before the client receives a response, including commands for local execution. Vault stores the values; MCP exposes names and local input requests. MCP alone does not route or mask model traffic.

## Discover and use variables

- Call `corpgate_list_variables` to discover exact names and descriptions. Match the requested service and purpose; never invent a name or ask for its original value. Omit `names` for discovery; use exact case-sensitive `names` when checking known entries.
- Fixed/manual variables are returned by default. Set `includeAutomatic: true` only when automatically detected variables are relevant; these may disappear after a restart.
- Use the exact name in `$${<NAME>}`. For example, a command can use `$${<SERVICE_URL>}` and `$${<SERVICE_TOKEN>}` after discovering those names. In explanations, write bare `SERVICE_TOKEN`: a full token is substituted even inside quotes or code blocks.
- Catalogs are snapshots. Refresh when a name is missing, unknown, renamed or apparently stale. Reuse a known valid name without listing the catalog on every call. Changing its value preserves its token; later requests use the current value. Renaming can invalidate the old name.
- If model traffic bypasses the CorpGate proxy, MCP cannot make substitution work. Investigate the connection before using unresolved tokens as credentials or addresses.

## Request human input locally

Call `corpgate_request_secret_input` with `operation: "set"`, a unique `idempotencyKey`, and either `names` or `variables` metadata (`name`, optional `description` and `isSecret`). Set creates missing names and updates existing names in one flow. Never supply secret values through MCP, chat or URLs, or ask the person to paste them there.

Keep the same idempotency key when retrying the same request. Ask the person to enter values in the returned local browser form. `launch: "attempted"` means a launch was attempted, not that the form is visible. If it did not appear, give the returned local URL to the person; do not submit the form for them or extract its values through browser automation.

Check `corpgate_secret_input_status` with the returned `requestId` after the person acts. `completed` confirms the save; `committing` requires checking the actual outcome before retrying. A cleanup notice says the save completed: do not resubmit values. Cancel unwanted pending requests with `corpgate_cancel_secret_input`. Expired, failed or unknown requests need their reported cause reviewed; an unknown request can belong to a previous runtime. Do not wait or poll indefinitely.

## Configure or recover the connection

When installing, changing providers, investigating localhost failures or repairing a connection, read [setup and recovery](references/setup-and-recovery.md). Prepare recovery before changing the working client endpoint: the current AI session can stop responding after that change. For normal variable use, the setup reference is unnecessary.
