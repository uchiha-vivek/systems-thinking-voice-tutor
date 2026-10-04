import { afterEach, describe, expect, it, vi } from "vitest";

async function rewrites() {
  vi.resetModules();
  const { default: config } = await import("@/next.config");
  return config.rewrites ? await config.rewrites() : [];
}

afterEach(() => vi.unstubAllEnvs());

describe("next.config rewrites", () => {
  it("forwards /api/* to the FastAPI backend on :8000 by default", async () => {
    vi.stubEnv("BACKEND_URL", "");
    delete process.env.BACKEND_URL;
    expect(await rewrites()).toEqual([
      { source: "/api/:path*", destination: "http://localhost:8000/api/:path*" },
    ]);
  });

  it("uses BACKEND_URL when set", async () => {
    vi.stubEnv("BACKEND_URL", "http://backend.test:9000");
    expect(await rewrites()).toEqual([
      { source: "/api/:path*", destination: "http://backend.test:9000/api/:path*" },
    ]);
  });
});
