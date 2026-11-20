import { describe, expect, it, vi } from "vitest";
import { isPublicAddress, SafeExternalReader } from "./safe-external-reader.js";

describe("external collection boundary", () => {
  it("blocks metadata, private and mapped/transition addresses before transport", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "172.16.0.1", "192.168.1.1", "100.100.100.200", "168.63.129.16", "::1", "::ffff:127.0.0.1", "2002:7f00:1::", "2001:db8::1"]) expect(isPublicAddress(address), address).toBe(false);
    const transport = vi.fn();
    const reader = new SafeExternalReader({ hosts: ["allowed.test"], resolve: () => Promise.resolve([{ address: "169.254.169.254", family: 4 }]), transport });
    await expect(reader.read("https://allowed.test/")).rejects.toThrow("SOURCE_PRIVATE_ADDRESS");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rechecks redirects and pins the validated DNS address", async () => {
    const resolve = vi.fn().mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const transport = vi.fn().mockResolvedValue({ status: 302, location: "/redirected", contentType: "text/html", body: "" });
    const reader = new SafeExternalReader({ hosts: ["allowed.test"], resolve, transport });
    await expect(reader.read("https://allowed.test/")).rejects.toThrow("SOURCE_PRIVATE_ADDRESS");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]).toEqual({ address: "8.8.8.8", family: 4 });
    await expect(reader.read("https://allowed.test.evil.test/")).rejects.toThrow("SOURCE_URL_NOT_ALLOWED");
  });
  it("rejects unsupported formats, oversized bodies and aborted requests", async () => {
    const transport = vi.fn().mockResolvedValueOnce({ status: 200, contentType: "video/mp4", body: "x" }).mockResolvedValueOnce({ status: 200, contentType: "text/html", body: "too long" });
    const reader = new SafeExternalReader({ hosts: ["allowed.test"], maxBytes: 4, resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }]), transport });
    await expect(reader.read("https://allowed.test/")).rejects.toThrow("SOURCE_CONTENT_TYPE_UNSUPPORTED");
    await expect(reader.read("https://allowed.test/")).rejects.toThrow("SOURCE_RESPONSE_TOO_LARGE");
    const controller = new AbortController(); controller.abort();
    await expect(reader.read("https://allowed.test/", controller.signal)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
