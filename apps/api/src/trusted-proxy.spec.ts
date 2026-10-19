import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { configureTrustedProxy } from "./trusted-proxy.js";

describe("trusted ingress", () => {
  it("ignores forged forwarding headers from an untrusted direct peer", async () => {
    const app = express();
    configureTrustedProxy(app, "172.30.250.2");
    app.get("/", (req, res) => res.json({ trusted: req.ip === "198.51.100.1" }));
    const result = await request(app).get("/").set("X-Forwarded-For", "198.51.100.1");
    expect(result.body).toEqual({ trusted: false });
  });
  it("rejects CIDRs and hop-count configurations", () => {
    for (const value of ["true", "1", "172.16.0.0/12", "loopback"]) {
      expect(() => configureTrustedProxy(express(), value)).toThrow("single IPv4");
    }
  });
});
