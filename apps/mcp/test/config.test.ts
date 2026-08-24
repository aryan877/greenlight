import { describe, expect, it } from "vitest";

import { parseMcpPort } from "../src/config.js";

describe("MCP configuration", () => {
  it("accepts only valid TCP ports", () => {
    expect(parseMcpPort(undefined)).toBe(8941);
    expect(parseMcpPort("4173")).toBe(4173);
    expect(() => parseMcpPort("abc")).toThrow("GREENLIGHT_MCP_PORT");
    expect(() => parseMcpPort("0")).toThrow("GREENLIGHT_MCP_PORT");
    expect(() => parseMcpPort("65536")).toThrow("GREENLIGHT_MCP_PORT");
  });
});
