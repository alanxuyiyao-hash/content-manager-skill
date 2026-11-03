export type UpdateRegistrar = (options: { onNeedRefresh: () => void }) => (reloadPage?: boolean) => void

type Notice = (
  message: string,
  options: { actionLabel: string; onAction: () => void; duration: number },
) => void

export function startAppUpdates({
  isNative,
  register,
  notify,
}: {
  isNative: boolean
  register: UpdateRegistrar
  notify: Notice
}): void {
  if (isNative) return
  const update = register({
    onNeedRefresh() {
      notify('A new version is available', {
        actionLabel: 'Update',
        onAction: () => update(true),
        duration: 12000,
      })
    },
  })
}
