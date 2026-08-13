import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("recommendation remains complete and cards match the body", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: () => { (window as typeof window & { __geoCalls?: number }).__geoCalls = ((window as typeof window & { __geoCalls?: number }).__geoCalls ?? 0) + 1; } },
    });
  });
  await page.goto("/");
  expect(await page.evaluate(() => (window as typeof window & { __geoCalls?: number }).__geoCalls ?? 0)).toBe(0);
  const input = page.getByRole("textbox", { name: "输入需求" });
  await input.fill("下午想坐一会写东西，最好安静一点");
  await input.press("Enter");
  await expect(page.getByText(/推荐完成/)).toBeAttached();
  const cards = await page.locator(".message-assistant").last().locator(".inline-card-name").allTextContents();
  expect(cards).toHaveLength(2);
  const body = await page.locator(".message-assistant").last().locator(".message-text").innerText();
  for (const name of cards) expect(body).toContain(name);

  await input.fill("预算再低一点");
  await input.press("Enter");
  await expect(page.locator(".message-user").last()).toContainText("预算再低一点");
  const metrics = await page.evaluate(() => ({
    documentScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    chatScrolls: document.querySelector(".chat-log")!.scrollHeight > document.querySelector(".chat-log")!.clientHeight,
  }));
  expect(metrics.documentScrolls).toBe(false);
  expect(metrics.chatScrolls).toBe(true);
});

test("four target widths have no page-level horizontal overflow", async ({ page }) => {
  await page.goto("/");
  for (const size of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test("tabs, filters and dialog are keyboard operable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const chatTab = page.getByRole("tab", { name: /对话推荐/ });
  await chatTab.focus();
  await chatTab.press("ArrowRight");
  const shopsTab = page.getByRole("tab", { name: /店铺展示/ });
  await expect(shopsTab).toHaveAttribute("aria-selected", "true");
  await expect(shopsTab).toHaveAttribute("tabindex", "0");
  const firstFilter = page.locator(".guide-tab").first();
  await expect(firstFilter).toHaveAttribute("aria-pressed", "true");
  const trigger = page.getByRole("button", { name: "看这家更细一点" }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".drawer-mobile-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("accessibility smoke has no critical axe violations and honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
  const animation = await page.locator(".page-shell").evaluate((element) => getComputedStyle(element, "::before").animationDuration);
  expect(["0s", "0.00001s", "0.01ms", "1e-05s"]).toContain(animation);
});

test("admin login exposes draft controls without leaking the token", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("核验人姓名").fill("自动验收");
  await page.getByLabel("管理口令").fill("playwright-admin-token");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "四牌楼咖啡管理台" })).toBeVisible();
  await expect(page.getByRole("button", { name: "店铺数据" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/数据 Blob 未配置/)).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("playwright-admin-token");
});
