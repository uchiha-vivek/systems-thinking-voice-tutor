// @vitest-environment node
// The client-tool definitions setup-agent.ts sends to ElevenLabs, checked against what the page handles.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FIRST_MESSAGE, PRIVACY_SETTINGS, SYSTEM_PROMPT, toolConfig, TURN_SETTINGS } from "@/scripts/setup-agent";
import { TOOL_SPECS } from "@/lib/tool-specs";
import { TOOL_NAMES } from "@/lib/tools";

type Config = ReturnType<typeof toolConfig> & {
  parameters?: { required: string[]; properties: Record<string, { type: string; description: string }> };
};
const configs: Config[] = TOOL_SPECS.map((spec) => toolConfig(spec));

describe("setup-agent", () => {
  it("defines exactly the tools the page answers", () => {
    expect(configs.map((c) => c.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("registers them as client tools that return a response", () => {
    for (const cfg of configs) {
      expect(cfg.type).toBe("client");
      expect(cfg.expects_response).toBe(true);
      expect(cfg).not.toHaveProperty("api_schema"); // no webhook, no URL, no secret
    }
  });

  it("every parameter is a required, described string; tools with none send no schema", () => {
    for (const cfg of configs) {
      if (!cfg.parameters) {
        expect(TOOL_SPECS.find((t) => t.name === cfg.name)!.params).toEqual({});
        continue;
      }
      expect(cfg.parameters.required).toEqual(Object.keys(cfg.parameters.properties));
      for (const prop of Object.values(cfg.parameters.properties)) {
        expect(prop.type).toBe("string");
        expect(prop.description).toBeTruthy();
      }
    }
  });

  it("noise doesn't count as the student interrupting, but talking still does", () => {
    expect(TURN_SETTINGS.vad.background_voice_detection).toBe(true);
    expect(TURN_SETTINGS.turn.turn_eagerness).toBe("patient");
    expect(TURN_SETTINGS.turn.interruption_ignore_terms).toContain("mm-hmm");
    expect(SYSTEM_PROMPT).toMatch(/never say your answer got cut off/);
  });

  it("keeps transcripts only as long as the page's privacy notice says, and no audio", () => {
    expect(PRIVACY_SETTINGS.privacy.record_voice).toBe(false);
    const page = readFileSync(new URL("../app/tutor.tsx", import.meta.url), "utf8");
    expect(page).toContain(`deleted after ${PRIVACY_SETTINGS.privacy.retention_days} days`);
  });

  it("the greeting is supplied by the page", () => {
    expect(FIRST_MESSAGE).toBe("{{opening}}");
  });

  it("the prompt is about behaviour only: no model's data in it", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/deer|water supply|\{\{model_/i);
    expect(SYSTEM_PROMPT).toContain("[Upload]");
    // every tool the prompt names must really exist
    const named = SYSTEM_PROMPT.match(/\bget_[a-z_]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(TOOL_NAMES).toContain(name);
  });
});
