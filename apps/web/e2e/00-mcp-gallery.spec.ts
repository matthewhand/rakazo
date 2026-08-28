import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("owner or member can open the MCP servers tab", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-gallery-${stamp}@rakazo.test`, "password12", "Mcp Gallery");
  await completeOnboarding(page, testInfo);

  await page.getByText("Integrations").click();
  await expect(page.getByPlaceholder("Search apps")).toBeVisible();
  await page.getByRole("tab", { name: "MCP servers" }).click();
  await expect(
    page.getByText(/No MCP servers configured|Only the deployment owner/i).first(),
  ).toBeVisible();
  const add = page.getByRole("button", { name: "Add your first server" });
  if (await add.isVisible().catch(() => false)) {
    await captureScreenshot(page, testInfo, "11c-mcp-servers-owner");
    await add.click();
    await expect(page.getByRole("heading", { name: "Add server" })).toBeVisible();
    await captureScreenshot(page, testInfo, "11d-mcp-server-editor");
  } else {
    await captureScreenshot(page, testInfo, "11c-mcp-servers");
  }
});
