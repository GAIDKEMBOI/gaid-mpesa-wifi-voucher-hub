import { describe, expect, it } from "vitest";
import {
  computeExpiry,
  formatTimeLeft,
  getPackage,
  makeVoucherCode,
  normalizeMac,
  normalizePhone,
  startOfKenyaDay,
  adminPasswordProblem,
  isLoginLocked,
  normalizeAdminUsername,
} from "@/lib/wifi";

describe("packages", () => {
  const cases: [string, number, number][] = [
    ["30m", 5, 30], ["1h", 10, 60], ["2h", 12, 120], ["4h", 20, 240],
    ["12h", 30, 720], ["24h", 45, 1440], ["7d", 200, 10080], ["30d", 600, 43200],
  ];
  for (const [id, price, minutes] of cases)
    it(`${id} costs ${price} KES`, () => expect(getPackage(id)).toMatchObject({ price, minutes }));
});

describe("expiry", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  it("starts from now for a new customer", () => {
    expect(computeExpiry(getPackage("1h")!, now).toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });
  it("adds time on top of an unexpired session", () => {
    const current = new Date("2026-01-01T10:30:00Z");
    expect(computeExpiry(getPackage("1h")!, now, current).toISOString()).toBe(
      "2026-01-01T11:30:00.000Z",
    );
  });
  it("ignores an already expired session", () => {
    const old = new Date("2026-01-01T09:00:00Z");
    expect(computeExpiry(getPackage("4h")!, now, old).toISOString()).toBe(
      "2026-01-01T14:00:00.000Z",
    );
  });
});

describe("phone numbers", () => {
  it("accepts 07 numbers", () => expect(normalizePhone("0712 345 678")).toBe("254712345678"));
  it("accepts 01 numbers", () => expect(normalizePhone("0110345678")).toBe("254110345678"));
  it("accepts +254 numbers", () => expect(normalizePhone("+254712345678")).toBe("254712345678"));
  it("rejects short numbers", () => expect(normalizePhone("071234")).toBeNull());
});

describe("MAC addresses", () => {
  it("normalises dashes and lowercase", () =>
    expect(normalizeMac("aa-bb-cc-dd-ee-0f")).toBe("AA:BB:CC:DD:EE:0F"));
  it("rejects garbage", () => expect(normalizeMac("hello world!")).toBeNull());
});

describe("time left", () => {
  it("shows 23:59:00 for a fresh 24h minus one minute", () =>
    expect(formatTimeLeft((24 * 60 - 1) * 60_000)).toBe("23:59:00"));
  it("shows days for 7 day packages", () =>
    expect(formatTimeLeft(7 * 86400_000 - 1000)).toBe("6d 23:59:59"));
});

describe("vouchers", () => {
  it("are 8 characters without confusing letters", () => {
    const code = makeVoucherCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toHaveLength(8);
    expect(code).not.toMatch(/[01OIL]/);
  });
});

describe("today in Kenya", () => {
  it("starts at 21:00 UTC the previous day", () =>
    expect(startOfKenyaDay(new Date("2026-03-10T02:00:00Z")).toISOString()).toBe(
      "2026-03-09T21:00:00.000Z",
    ));
});

describe("admin password", () => {
  it("rejects the old default admin123", () =>
    expect(adminPasswordProblem("admin123")).not.toBeNull());
  it("rejects passwords shorter than 10 characters", () =>
    expect(adminPasswordProblem("abc12345x")).toBe("Use at least 10 characters"));
  it("needs letters and numbers", () =>
    expect(adminPasswordProblem("onlyletterswow")).toBe("Use both letters and numbers"));
  it("must not contain the username", () =>
    expect(adminPasswordProblem("gaidboss2026x", "gaidboss")).toBe("Password must not contain the username"));
  it("accepts a strong password", () => expect(adminPasswordProblem("Mawingu-7421-Kisumu")).toBeNull());
});

describe("admin username", () => {
  it("is lowercased and trimmed", () => expect(normalizeAdminUsername("  Owner ")).toBe("owner"));
  it("rejects spaces", () => expect(normalizeAdminUsername("my boss")).toBeNull());
});

describe("login lockout", () => {
  it("allows 4 failures from one device", () => expect(isLoginLocked(4, 4)).toBe(false));
  it("locks after 5 failures from one device", () => expect(isLoginLocked(5, 5)).toBe(true));
  it("locks everyone after 50 failures in total", () => expect(isLoginLocked(0, 50)).toBe(true));
});
