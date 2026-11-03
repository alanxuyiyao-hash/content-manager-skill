import { useEffect, useRef } from 'react'
import { androidBackDispatcher, type AndroidBackHandler } from '../lib/androidBack'

export function useAndroidBackHandler(handler: AndroidBackHandler): void {
  const current = useRef(handler)
  current.current = handler

  useEffect(() => androidBackDispatcher.register(() => current.current()), [])
}
