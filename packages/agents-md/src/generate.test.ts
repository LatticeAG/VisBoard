import { describe, expect, it } from "vitest";
import { fixtureInput } from "./generate.fixture.js";
import { generate } from "./generate.js";

describe("generate", () => {
  it("matches AGENTS.md protocol v1 snapshot", () => {
    const output = generate(fixtureInput);
    expect(output).toMatchSnapshot();
  });

  it("includes version marker", () => {
    const output = generate(fixtureInput);
    expect(output).toContain("<!-- visboard-agents-md:1 -->");
  });
});
