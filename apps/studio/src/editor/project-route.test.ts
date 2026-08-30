import { describe, expect, it } from "vitest";

import { projectIdFromPathname, projectPath } from "./project-route.js";

describe("project routes", () => {
  it("round-trips a project ID", () => {
    const id = "project_cbf73a9d5bce492bb0c8ea9b9173e87a";
    expect(projectIdFromPathname(projectPath(id))).toBe(id);
  });

  it("ignores root, nested, and malformed routes", () => {
    expect(projectIdFromPathname("/")).toBeNull();
    expect(projectIdFromPathname("/projects/one/release")).toBeNull();
    expect(projectIdFromPathname("/projects/%E0%A4%A")).toBeNull();
  });
});
