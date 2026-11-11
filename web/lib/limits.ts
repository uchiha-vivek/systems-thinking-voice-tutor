// Shared between the page and scripts/setup-agent.ts, so the agent's limit and the page's warning agree.

/** Longest a voice session can run before ElevenLabs ends it. At ~$0.10/min, 30 minutes is about $3. */
export const MAX_CALL_SECONDS = 30 * 60;
