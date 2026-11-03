import { Capacitor } from '@capacitor/core'

export interface BackupFilePorts {
  isNative: boolean
  downloadWeb(text: string, filename: string): void
  writeNative(text: string, filename: string): Promise<string>
  shareNative(uri: string, filename: string): Promise<void>
}

const defaultPorts: BackupFilePorts = {
  isNative: Capacitor.isNativePlatform(),
  downloadWeb: (text, filename) => {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  writeNative: async (text, filename) => {
    const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem')
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    return uri
  },
  shareNative: async (uri) => {
    const { Share } = await import('@capacitor/share')
    await Share.share({
      title: 'Ledger backup',
      dialogTitle: 'Save or share backup',
      files: [uri],
    })
  },
}

export async function saveBackupJSON(
  data: unknown,
  filename: string,
  ports: BackupFilePorts = defaultPorts,
): Promise<'downloaded' | 'shared' | 'canceled'> {
  const text = JSON.stringify(data, null, 2)
  if (!ports.isNative) {
    ports.downloadWeb(text, filename)
    return 'downloaded'
  }
  const uri = await ports.writeNative(text, filename)
  try {
    await ports.shareNative(uri, filename)
  } catch (error) {
    if (error instanceof Error && error.message === 'Share canceled') return 'canceled'
    throw error
  }
  return 'shared'
}
