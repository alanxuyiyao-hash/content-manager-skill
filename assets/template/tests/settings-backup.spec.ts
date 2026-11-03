import { expect, test } from 'playwright/test'

test('native export cancellation clears a pre-existing backup status', async ({ page }) => {
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
          { name: 'Filesystem', methods: [{ name: 'writeFile', rtype: 'promise' }] },
          { name: 'Share', methods: [{ name: 'share', rtype: 'promise' }] },
        ],
        nativePromise(pluginName: string, methodName: string) {
          if (pluginName === 'Filesystem' && methodName === 'writeFile') {
            return Promise.resolve({ uri: 'content://task-7a/backup.json' })
          }
          if (pluginName === 'Share' && methodName === 'share') {
            return Promise.reject(new Error('Share canceled'))
          }
          return Promise.resolve()
        },
        nativeCallback() {
          return Promise.resolve('task-7a-listener')
        },
      },
    })
  })

  await page.goto('/?demo')
  await page.getByRole('button', { name: 'Me', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not valid JSON'),
  })
  await expect(page.locator('.hint.ok')).toHaveText('Import failed: Invalid backup: not a valid JSON file')

  const exportButton = page.getByRole('button', { name: /Export backup \(JSON\)/ })
  await exportButton.click()
  await expect(exportButton).toBeEnabled()
  await expect(page.locator('.hint.ok')).toHaveCount(0)
})
