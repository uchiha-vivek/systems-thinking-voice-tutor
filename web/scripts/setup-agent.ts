// Create/update the tutor's 6 client tools and attach them to the ElevenLabs agent.
//
// Usage (from web/): npm run setup-agent
//
// The tools run in the student's browser (see lib/tools.ts), so ElevenLabs never calls our server
// and nothing here needs a public URL. Run this once, and again whenever the prompt, first message
// or tool definitions change.
//
// Tools are separate workspace objects referenced by id (prompt.tool_ids). The workspace may be
// shared with other projects, so this script never searches tools by name across the workspace:
// it only updates tools already attached to THIS agent and creates whichever are missing.
import { readFileSync } from "node:fs";
import { TOOL_SPECS, type ToolSpec } from "../lib/tool-specs.ts";

const API = "https://api.elevenlabs.io/v1/convai";

export const SYSTEM_PROMPT = readFileSync(new URL("./system_prompt.txt", import.meta.url), "utf8");
export const FIRST_MESSAGE = readFileSync(new URL("./first_message.txt", import.meta.url), "utf8").trim();

export function toolConfig(spec: ToolSpec) {
  const properties = Object.fromEntries(
    Object.entries(spec.params).map(([name, description]) => [name, { type: "string", description }]),
  );
  return {
    type: "client",
    name: spec.name,
    description: spec.description,
    expects_response: true,
    response_timeout_secs: 20,
    ...(Object.keys(properties).length
      ? {
          parameters: {
            type: "object",
            description: `Arguments for ${spec.name}.`,
            properties,
            required: Object.keys(properties),
          },
        }
      : {}),
  };
}

// How the agent decides the student is speaking. Loud sounds were cutting the tutor off, so it
// filters background voices, waits for clearer speech, and ignores short listening sounds.
// The student can still interrupt on purpose by talking.
export const TURN_SETTINGS = {
  turn: {
    turn_eagerness: "patient",
    interruption_ignore_terms: ["mm-hmm", "uh-huh", "okay", "ok", "yeah", "mhm"],
    merge_with_default_ignore_terms: true,
  },
  vad: { background_voice_detection: true },
};

// What ElevenLabs keeps. The page tells students transcripts are deleted after 30 days, so keep
// the two in step. Existing conversations are left as they were.
export const PRIVACY_SETTINGS = {
  privacy: {
    record_voice: false,
    retention_days: 30,
    apply_to_existing_conversations: false,
  },
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to web/.env.local.`);
  return value;
}

async function main() {
  const key = requireEnv("ELEVENLABS_API_KEY");
  const agentId = requireEnv("ELEVENLABS_AGENT_ID");
  const llm = process.env.ELEVENLABS_LLM || "claude-sonnet-5-5";

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "xi-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, status: res.status, text: () => res.text(), json: () => res.json() };
  };

  const agent = await call("GET", `/agents/${agentId}`);
  if (!agent.ok) throw new Error(`get agent: ${agent.status} ${(await agent.text()).slice(0, 800)}`);
  const attached: string[] = (await agent.json()).conversation_config.agent.prompt.tool_ids ?? [];

  // Map name -> id for tools already attached to this agent only.
  const oursByName = new Map<string, string>();
  const others: string[] = [];
  const wanted = new Set(TOOL_SPECS.map((t) => t.name));
  for (const id of attached) {
    const r = await call("GET", `/tools/${id}`);
    const name = r.ok ? (await r.json()).tool_config?.name : undefined;
    if (wanted.has(name)) oursByName.set(name, id);
    else others.push(id);
  }

  const toolIds: string[] = [];
  for (const spec of TOOL_SPECS) {
    const body = { tool_config: toolConfig(spec) };
    const existing = oursByName.get(spec.name);
    const r = existing ? await call("PATCH", `/tools/${existing}`, body) : await call("POST", "/tools", body);
    if (!r.ok) throw new Error(`${spec.name}: ${r.status} ${(await r.text()).slice(0, 800)}`);
    const id = (await r.json()).id;
    toolIds.push(id);
    console.log(`  ${existing ? "updated" : "created"} tool ${spec.name} -> ${id}`);
  }

  const patch = {
    platform_settings: PRIVACY_SETTINGS,
    conversation_config: {
      ...TURN_SETTINGS,
      agent: {
        first_message: FIRST_MESSAGE,
        language: "en",
        dynamic_variables: {
          dynamic_variable_placeholders: {
            opening:
              "Hi, I'm your Systems Thinking tutor. Upload your Stella model with the button on this page, and I can describe it. You can ask me questions, and I can ask you questions too.",
          },
        },
        prompt: { prompt: SYSTEM_PROMPT, llm, temperature: 0.3, tool_ids: [...others, ...toolIds] },
      },
    },
  };
  const r = await call("PATCH", `/agents/${agentId}`, patch);
  if (!r.ok) throw new Error(`agent update: ${r.status} ${(await r.text()).slice(0, 800)}`);
  const got = (await r.json()).conversation_config.agent.prompt;
  console.log(`Updated agent ${agentId}: llm=${got.llm}, ${got.tool_ids?.length ?? 0} tools attached.`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
