export const VAULT_MCP_INSTRUCTIONS = [
  'CorpGate keeps stored passwords, API tokens and service addresses local while the model uses named variables.',
  'Call corpgate_list_variables to find a suitable name; never invent names or request original values. The catalog returns names, descriptions and sources only. Fixed/manual variables are the default; request includeAutomatic: true only when needed.',
  'Use the exact returned name as $${<NAME>} (uppercase letters, digits and underscores). In explanations write bare NAME: a full token is substituted even inside quotes or code blocks.',
  'The CorpGate proxy restores tokens to local values before delivery to the client. MCP alone does not substitute tokens when model traffic bypasses that proxy.',
  'The catalog is a snapshot: variables may change outside this session. Refresh if a name is missing, unknown or stale. A value change preserves the name/token and subsequent requests use the current value. Renaming may invalidate the old name; no refresh is needed for every reuse of a known name.',
  'Use corpgate_request_secret_input with operation set and names or variable metadata for human input in the local browser. Never pass secret values in MCP arguments, chat or URLs. Only request state and metadata return to MCP.',
  'A launch attempt does not prove a visible form. Check corpgate_secret_input_status after human action, or corpgate_cancel_secret_input to cancel; do not poll or wait indefinitely.',
].join(' ');

export const VAULT_CATALOG_DESCRIPTION = 'Find names and descriptions of Vault variables without revealing values. Fixed variables are returned by default; includeAutomatic: true adds automatic variables. Use $${<NAME>} through the CorpGate proxy. Refresh this snapshot when a name is missing, unknown or stale.';
