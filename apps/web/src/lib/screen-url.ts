export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/** Screen URLs the browser may embed. Signed `/novnc/` capabilities are
 *  rewritten to this page's origin so a LAN tab does not follow
 *  `WEB_ORIGIN=http://127.0.0.1:5173`. Raw loopback VNC stays host-only. */
export function embeddableScreenUrl(url: string | null, pageHref?: string): string | null {
  if (!url) return null;
  const base = pageHref || (typeof window !== "undefined" ? window.location.href : "");
  try {
    const parsed = new URL(url, base || "http://127.0.0.1");
    const page = base ? new URL(base) : parsed;
    if (parsed.pathname.startsWith("/novnc/")) {
      return `${page.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    const pagePort = page.port || (page.protocol === "https:" ? "443" : "80");
    if (isLoopbackHostname(parsed.hostname) && parsed.port && parsed.port !== pagePort) {
      return null;
    }
    if (isLoopbackHostname(parsed.hostname) && !isLoopbackHostname(page.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function screenIframeSandbox(url: string | null) {
  if (!url) return undefined;
  try {
    return new URL(
      url,
      typeof window !== "undefined" ? window.location.href : undefined,
    ).pathname.startsWith("/novnc/")
      ? "allow-scripts allow-pointer-lock"
      : undefined;
  } catch {
    return undefined;
  }
}
