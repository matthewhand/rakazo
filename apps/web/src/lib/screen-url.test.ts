import { describe, expect, it } from "vitest";
import { embeddableScreenUrl, screenIframeSandbox } from "./screen-url.js";

describe("embeddableScreenUrl", () => {
  it("rewrites a loopback /novnc/ capability onto the LAN page origin", () => {
    expect(
      embeddableScreenUrl(
        "http://127.0.0.1:5173/novnc/abc/49152/1.sig/embed.html?view_only=true",
        "http://10.0.0.32:5173/app/bot-1",
      ),
    ).toBe("http://10.0.0.32:5173/novnc/abc/49152/1.sig/embed.html?view_only=true");
  });

  it("keeps a relative /novnc/ path on the page origin", () => {
    expect(embeddableScreenUrl("/novnc/abc/49152/1.sig/embed.html", "http://10.0.0.32:5173/")).toBe(
      "http://10.0.0.32:5173/novnc/abc/49152/1.sig/embed.html",
    );
  });

  it("does not point the iframe at the client's loopback VNC port", () => {
    expect(
      embeddableScreenUrl(
        "http://127.0.0.1:16080/embed.html?view_only=true",
        "http://10.0.0.32:5173/",
      ),
    ).toBeNull();
    expect(
      embeddableScreenUrl("http://localhost:16080/embed.html", "http://10.0.0.32:5173/"),
    ).toBeNull();
  });

  it("still rejects a different-port loopback VNC when the page is loopback", () => {
    expect(
      embeddableScreenUrl("http://127.0.0.1:16080/embed.html", "http://127.0.0.1:5173/"),
    ).toBeNull();
  });

  it("leaves a managed-provider URL alone", () => {
    const url = "https://sandbox.e2b.app/stream?authKey=abc&view_only=true";
    expect(embeddableScreenUrl(url, "http://10.0.0.32:5173/")).toBe(url);
  });

  it("returns null when there is no screen", () => {
    expect(embeddableScreenUrl(null, "http://10.0.0.32:5173/")).toBeNull();
  });
});

describe("screenIframeSandbox", () => {
  it("sandboxes only the signed /novnc/ proxy", () => {
    expect(screenIframeSandbox("http://10.0.0.32:5173/novnc/abc/1/1.sig/embed.html")).toBe(
      "allow-scripts allow-pointer-lock",
    );
    expect(screenIframeSandbox("https://sandbox.e2b.app/stream")).toBeUndefined();
  });
});
