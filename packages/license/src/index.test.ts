import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  loadPrivateKey,
  loadPublicKey,
  signLicense,
  verifyLicense,
  LicenseInvalidError,
} from "./index.js";

const futureSec = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
const pastSec = Math.floor(Date.now() / 1000) - 1;

const sample = {
  customer_id: "cus_1",
  customer_name: "Test Casino",
  license_id: "lic_1",
  issued_at: Math.floor(Date.now() / 1000),
  expires_at: futureSec,
};

describe("license", () => {
  it("signs and verifies a valid token", () => {
    const kp = generateKeyPair();
    const priv = loadPrivateKey(kp.privatePem);
    const pub = loadPublicKey(kp.publicPem);
    const token = signLicense(sample, priv);
    const decoded = verifyLicense(token, pub);
    expect(decoded.customer_id).toBe("cus_1");
  });

  it("rejects an expired token", () => {
    const kp = generateKeyPair();
    const priv = loadPrivateKey(kp.privatePem);
    const pub = loadPublicKey(kp.publicPem);
    const token = signLicense({ ...sample, expires_at: pastSec }, priv);
    expect(() => verifyLicense(token, pub)).toThrowError(LicenseInvalidError);
  });

  it("rejects a token signed by a different key", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const aPriv = loadPrivateKey(a.privatePem);
    const bPub = loadPublicKey(b.publicPem);
    const token = signLicense(sample, aPriv);
    expect(() => verifyLicense(token, bPub)).toThrowError(LicenseInvalidError);
  });

  it("rejects malformed tokens", () => {
    const pub = loadPublicKey(generateKeyPair().publicPem);
    expect(() => verifyLicense("", pub)).toThrowError(LicenseInvalidError);
    expect(() => verifyLicense("only-one-segment", pub)).toThrowError(
      LicenseInvalidError,
    );
    expect(() => verifyLicense("a.b.c", pub)).toThrowError(LicenseInvalidError);
  });

  it("rejects tampered payload", () => {
    const kp = generateKeyPair();
    const priv = loadPrivateKey(kp.privatePem);
    const pub = loadPublicKey(kp.publicPem);
    const token = signLicense(sample, priv);
    const [head, sig] = token.split(".");
    // Replace head with different payload but keep original signature.
    const otherHead = Buffer.from(
      JSON.stringify({ ...sample, customer_id: "tampered" }),
      "utf8",
    )
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(() => verifyLicense(`${otherHead}.${sig}`, pub)).toThrowError(
      LicenseInvalidError,
    );
  });
});
