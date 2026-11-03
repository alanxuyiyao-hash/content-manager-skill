import { expect, test, type Page } from 'playwright/test'

const viewport = { width: 420, height: 912 }
const safeTop = 59
const safeBottom = 34

async function settleLayout(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

async function expectActiveHeader(page: Page, tabName: 'Home' | 'Calendar' | 'Stats' | 'Insights' | 'Me') {
  const tab = page.getByRole('button', { name: tabName, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-current', 'page')

  const header = page.locator('.tab-panel:not([hidden]) .he-top')
  await expect(header).toBeVisible()
  await settleLayout(page)

  const box = await header.boundingBox()
  expect(box, `${tabName} header should render`).not.toBeNull()
  expect(box!.y).toBeCloseTo(safeTop + 10, 1)
  expect(box!.height).toBeCloseTo(40, 1)
}

test('iPhone Air keeps floating chrome and tab headers aligned to safe areas', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?demo')
  await page.addStyleTag({
    content: `:root{--safe-area-inset-top:${safeTop}px;--safe-area-inset-bottom:${safeBottom}px}`,
  })
  await page.evaluate(() => document.fonts.ready)
  await settleLayout(page)

  const tabbar = await page.locator('.tabbar').boundingBox()
  expect(tabbar).not.toBeNull()
  expect(tabbar!.height).toBeCloseTo(64, 1)
  expect(viewport.height - (tabbar!.y + tabbar!.height)).toBeCloseTo(safeBottom + 10, 1)

  await expectActiveHeader(page, 'Home')
  const fab = page.getByRole('button', { name: 'Quick add' })
  await expect(fab).toBeVisible()
  const fabBox = await fab.boundingBox()
  expect(fabBox).not.toBeNull()
  expect(tabbar!.y - (fabBox!.y + fabBox!.height)).toBeCloseTo(18, 1)

  await fab.click()
  const optionIcons = page.locator('.qc-opt-ico')
  await expect(optionIcons).toHaveCount(2)
  const iconBoxes = await optionIcons.evaluateAll((icons) =>
    icons.map((icon) => {
      const box = icon.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }),
  )
  for (const iconBox of iconBoxes) {
    expect(iconBox.x + iconBox.width / 2).toBeCloseTo(fabBox!.x + fabBox!.width / 2, 1)
  }
  const nearestOption = iconBoxes.at(-1)!
  expect(fabBox!.y - (nearestOption.y + nearestOption.height)).toBeCloseTo(20, 1)
  await page.getByRole('button', { name: 'Close' }).click()

  await expectActiveHeader(page, 'Calendar')
  await expectActiveHeader(page, 'Stats')
  await expectActiveHeader(page, 'Insights')

  const rangeLabel = page.locator('.tab-panel:not([hidden]) .he-month .in-range-label')
  await expect(rangeLabel).toBeVisible()
  await page.getByRole('button', { name: 'Previous 30 days' }).click()
  await settleLayout(page)
  await expect(rangeLabel).toBeVisible()
  await rangeLabel.click()
  await expect(page.getByRole('button', { name: 'Back to the latest 30 days' })).toHaveCount(0)
  await expectActiveHeader(page, 'Me')

  expect(errors).toEqual([])
})
