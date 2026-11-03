import { test, expect } from 'playwright/test'
import { readFile } from 'node:fs/promises'


test('template creates, edits, persists and round-trips a JSON backup', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Quick add', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Content', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByPlaceholder('Title or brand name').fill('Template verification content')
  await page.getByRole('button', { name: /Publish date/ }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const card = page.getByRole('button', { name: /Template verification content/ })
  await expect(card).toBeVisible()
  await page.reload()
  await expect(card).toBeVisible()
  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2, { steps: 8 })
  expect((await card.boundingBox())!.x).toBeCloseTo(box.x, 1)
  await page.mouse.down()
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 12 })
  await page.mouse.up()
  const tray = page.locator('.he-swipe .swipe-tray').first()
  await expect(tray).toHaveAttribute('aria-hidden', 'false')
  // First ordinary click closes an open tray; the next opens the editor.
  await card.click()
  await expect(tray).toHaveAttribute('aria-hidden', 'true')
  await card.click()
  await page.getByPlaceholder('Title or brand name').fill('Template verified and edited')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('button', { name: /Template verified and edited/ })).toBeVisible()
  await page.getByRole('button', { name: 'Me', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export backup \(JSON\)/ }).click()
  const download = await downloadPromise
  const text = await readFile((await download.path())!, 'utf8')
  const data = JSON.parse(text)
  expect(data.projects).toHaveLength(1)
  expect(data.projects[0].name).toBe('Template verified and edited')
  expect(data.version).toBe(10)
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const restore = await fresh.newPage()
    await restore.goto(new URL('/', page.url()).href)
    await restore.getByRole('button', { name: 'Me', exact: true }).click()
    await restore.locator('input[type="file"][accept*="json"]').setInputFiles({
      name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(text),
    })
    await expect(restore.locator('.hint.ok')).toContainText('Imported 1 orders')
    await restore.getByRole('button', { name: 'Home', exact: true }).click()
    await expect(restore.getByRole('button', { name: /Template verified and edited/ })).toBeVisible()
    await restore.reload()
    await expect(restore.getByRole('button', { name: /Template verified and edited/ })).toBeVisible()
  } finally { await fresh.close() }
})

