import { describe, expect, it } from "vitest";
import { normalizeHeaderName, hasDuplicateHeaders } from "../src/utils/headers.ts";

describe("Dataset Analyzer smoke checks", () => {
  it("normalizes blank headers", () => expect(normalizeHeaderName("", 2)).toBe("Column 3"));
  it("detects duplicate headers", () => expect(hasDuplicateHeaders(["A", "B", "a"])).toBe(true));
});