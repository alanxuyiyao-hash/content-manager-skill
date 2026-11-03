export async function runBackupExportOnce(
  lock: { current: boolean },
  exportBackup: () => Promise<void>,
): Promise<boolean> {
  if (lock.current) return false
  lock.current = true
  try {
    await exportBackup()
    return true
  } finally {
    lock.current = false
  }
}
