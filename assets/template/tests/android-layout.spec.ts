import { expect, test, type Page } from 'playwright/test'

async function settleLayout(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 875 },
  { width: 432, height: 960 },
]) {
  test(`home clears Android system insets at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      Object.assign(window, {
        androidBridge: {},
        Capacitor: {
          PluginHeaders: [
            {
              name: 'App',
              methods: [
                { name: 'addListener', rtype: 'callback' },
                { name: 'removeListener', rtype: 'promise' },
                { name: 'exitApp', rtype: 'promise' },
              ],
            },
          ],
          nativeCallback() {
            return Promise.resolve('android-layout-listener')
          },
          nativePromise() {
            return Promise.resolve()
          },
        },
      })
    })
    await page.goto('/?demo')
    await expect(page.locator('html')).toHaveAttribute('data-capacitor-platform', 'android')
    const top = page.locator('.he-top')
    await expect(top).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await settleLayout(page)

    const zeroInsetTop = await top.boundingBox()
    expect(zeroInsetTop).not.toBeNull()
    await page.addStyleTag({
      content: ':root{--safe-area-inset-top:32px;--safe-area-inset-bottom:24px}',
    })
    await settleLayout(page)

    const androidInsetTop = await top.boundingBox()
    expect(androidInsetTop).not.toBeNull()
    expect(androidInsetTop!.y - zeroInsetTop!.y).toBeCloseTo(32, 1)

    const content = page.locator('.content')
    const contentSize = await content.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(contentSize.scrollWidth).toBeLessThanOrEqual(contentSize.clientWidth)

    for (const selector of ['.home-elegant', '.he-top', '.he-cards', '.he-cadence', '.he-filters']) {
      const bounds = await page.locator(selector).boundingBox()
      expect(bounds, `${selector} should exist`).not.toBeNull()
      expect(bounds!.x, `${selector} should not cross the left viewport edge`).toBeGreaterThanOrEqual(0)
      expect(
        bounds!.x + bounds!.width,
        `${selector} should not cross the right viewport edge`,
      ).toBeLessThanOrEqual(viewport.width)
    }

    const hint = page.locator('.empty-state-hint')
    for (let attempt = 0; attempt < 24 && (await hint.count()) === 0; attempt += 1) {
      await page.getByRole('button', { name: 'Next month' }).click()
      await settleLayout(page)
    }

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(horizontalOverflow).toBe(false)

    const tabbar = await page.locator('.tabbar').boundingBox()
    expect(tabbar).not.toBeNull()
    expect(viewport.height - (tabbar!.y + tabbar!.height)).toBeGreaterThanOrEqual(39)

    await expect(hint).toBeVisible()
    const hintBox = await hint.boundingBox()
    expect(hintBox).not.toBeNull()
    expect(hintBox!.y + hintBox!.height).toBeLessThan(tabbar!.y)
  })
}
