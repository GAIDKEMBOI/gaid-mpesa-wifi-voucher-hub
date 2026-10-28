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
  PAYMENT_TIMEOUT_MS,
  paymentAccess,
  paymentState,
  topUpShortfall,
  topUpAmountProblem,
  creditChangeProblem,
  hasFreeSlot,
  isFreeWifiTime,
  freeWifiEndsAt,
  greeting,
  kenyaDay,
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

describe("payment status panel rules", () => {
  it("cancelled payments show as failed", () => {
    expect(paymentState("cancelled")).toBe("failed");
    expect(paymentState("failed")).toBe("failed");
    expect(paymentState("pending")).toBe("pending");
    expect(paymentState("success")).toBe("success");
  });
  it("pending payments time out after 3 minutes", () => {
    expect(PAYMENT_TIMEOUT_MS).toBe(180_000);
  });
  const now = new Date("2026-10-26T09:00:00Z");
  const later = new Date("2026-10-26T10:00:00Z");
  const earlier = new Date("2026-10-26T08:00:00Z");
  it("pending payment means internet is not on yet", () => {
    expect(paymentAccess("pending", null, now, false)).toBe("waiting");
  });
  it("failed payment never turns internet on", () => {
    expect(paymentAccess("failed", later, now, true)).toBe("none");
  });
  it("successful payment with time left means internet is on", () => {
    expect(paymentAccess("success", later, now, true)).toBe("on");
  });
  it("successful payment whose time ran out or was disconnected has ended", () => {
    expect(paymentAccess("success", earlier, now, true)).toBe("ended");
    expect(paymentAccess("success", later, now, false)).toBe("ended");
  });
  it("successful payment with no access granted is flagged", () => {
    expect(paymentAccess("success", null, now, false)).toBe("not_activated");
  });
});

describe("two-device packages", () => {
  const cases: [string, number, number][] = [["4h-2d", 30, 240], ["24h-2d", 70, 1440], ["3d-2d", 135, 4320]];
  for (const [id, price, minutes] of cases)
    it(`${id} costs ${price} KES for 2 devices at 5 Mbps`, () =>
      expect(getPackage(id)).toMatchObject({ price, minutes, devices: 2, speedMbps: 5 }));
  it("single-device packages allow 1 device", () => expect(getPackage("24h")?.devices).toBe(1));
});

describe("prepaid credit", () => {
  it("no top-up needed when credit covers the price", () => expect(topUpShortfall(45, 50)).toBe(0));
  it("tops up only the missing amount", () => expect(topUpShortfall(45, 20)).toBe(25));
  it("rounds a fractional shortfall up to whole shillings", () => expect(topUpShortfall(10, 2.5)).toBe(8));
  it("2-device package: second device fits, third does not", () => {
    expect(hasFreeSlot(2, 1)).toBe(true);
    expect(hasFreeSlot(2, 2)).toBe(false);
  });
});

describe("free WiFi 6:00-8:00 AM Kenya time", () => {
  it("is free at 6:00 Kenya (03:00 UTC)", () => expect(isFreeWifiTime(new Date("2026-10-27T03:00:00Z"))).toBe(true));
  it("is free at 7:59 Kenya", () => expect(isFreeWifiTime(new Date("2026-10-27T04:59:00Z"))).toBe(true));
  it("is not free at 8:00 Kenya", () => expect(isFreeWifiTime(new Date("2026-10-27T05:00:00Z"))).toBe(false));
  it("is not free at 5:59 Kenya", () => expect(isFreeWifiTime(new Date("2026-10-27T02:59:00Z"))).toBe(false));
  it("free session ends at 8:00 Kenya", () =>
    expect(freeWifiEndsAt(new Date("2026-10-27T03:30:00Z")).toISOString()).toBe("2026-10-27T05:00:00.000Z"));
  it("Kenya day rolls over at midnight Kenya time", () => expect(kenyaDay(new Date("2026-10-27T21:30:00Z"))).toBe("2026-10-28"));
});

describe("greeting", () => {
  it("afternoon at 15:48 Kenya", () => expect(greeting(new Date("2026-10-27T12:48:00Z"))).toBe("Good Afternoon"));
  it("morning at 7:00 Kenya", () => expect(greeting(new Date("2026-10-27T04:00:00Z"))).toBe("Good Morning"));
  it("evening at 19:00 Kenya", () => expect(greeting(new Date("2026-10-27T16:00:00Z"))).toBe("Good Evening"));
});

describe("credit top-up by M-Pesa", () => {
  it("Sh5 is the smallest top-up", () => {
    expect(topUpAmountProblem(5)).toBeNull();
    expect(topUpAmountProblem(4)).not.toBeNull();
  });
  it("Sh10,000 is the largest top-up", () => {
    expect(topUpAmountProblem(10_000)).toBeNull();
    expect(topUpAmountProblem(10_001)).not.toBeNull();
  });
  it("only whole shillings", () => expect(topUpAmountProblem(12.5)).not.toBeNull());
});

describe("admin credit change", () => {
  it("can add credit", () => expect(creditChangeProblem(50, 0)).toBeNull());
  it("can remove up to what the customer has", () => expect(creditChangeProblem(-20, 20)).toBeNull());
  it("cannot remove more than the customer has", () => expect(creditChangeProblem(-21, 20)).not.toBeNull());
  it("zero is not a change", () => expect(creditChangeProblem(0, 20)).not.toBeNull());
});
