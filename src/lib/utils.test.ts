import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// cn = clsx (conditional join) + tailwind-merge (later utility wins on the same property).
describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("merges conflicting tailwind utilities — last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("keeps non-conflicting utilities and merges arrays", () => {
    expect(cn(["px-2", "py-1"], "text-sm")).toBe("px-2 py-1 text-sm");
  });
});
