import { describe, expect, it } from "vitest";
import { canAdmin, canModerate, hasRole, Roles } from "@/lib/roles";

// Authorization contract: moderation is gated to the moderator OR admin roles, and admin actions to
// the admin role ALONE. The allowlist is exact — an unknown / misspelled role grants nothing, and a
// null/undefined user is never privileged (fail closed).
describe("hasRole", () => {
  it("is true when the user carries the role", () => {
    expect(hasRole({ roles: ["user", "moderator"] }, "moderator")).toBe(true);
  });

  it("is false when the role is absent", () => {
    expect(hasRole({ roles: ["user"] }, "moderator")).toBe(false);
  });

  it("is false for null/undefined users", () => {
    expect(hasRole(null, "user")).toBe(false);
    expect(hasRole(undefined, "user")).toBe(false);
  });

  it("is false when roles is missing or null", () => {
    expect(hasRole({}, "user")).toBe(false);
    expect(hasRole({ roles: null }, "user")).toBe(false);
  });

  it("is case-sensitive (no fuzzy matching)", () => {
    expect(hasRole({ roles: ["Moderator"] }, "moderator")).toBe(false);
  });
});

describe("canModerate (moderator OR admin)", () => {
  it("allows a moderator", () => {
    expect(canModerate({ roles: [Roles.Moderator] })).toBe(true);
  });

  it("allows an admin", () => {
    expect(canModerate({ roles: [Roles.Admin] })).toBe(true);
  });

  it("denies a plain user", () => {
    expect(canModerate({ roles: [Roles.User] })).toBe(false);
  });

  it("denies a user with no roles and a null user", () => {
    expect(canModerate({ roles: [] })).toBe(false);
    expect(canModerate(null)).toBe(false);
  });

  it("denies an unknown role token", () => {
    expect(canModerate({ roles: ["superuser"] })).toBe(false);
  });
});

describe("canAdmin (admin ONLY)", () => {
  it("allows an admin", () => {
    expect(canAdmin({ roles: [Roles.Admin] })).toBe(true);
  });

  it("denies a moderator — moderator is not admin", () => {
    expect(canAdmin({ roles: [Roles.Moderator] })).toBe(false);
  });

  it("denies a plain user and a null user", () => {
    expect(canAdmin({ roles: [Roles.User] })).toBe(false);
    expect(canAdmin(null)).toBe(false);
  });
});

describe("Roles allowlist values", () => {
  it("uses the exact wire tokens", () => {
    expect(Roles).toEqual({ User: "user", Moderator: "moderator", Admin: "admin" });
  });
});
