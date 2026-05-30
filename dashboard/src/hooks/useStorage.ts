import { useEffect, useState } from 'react'

export const useStorage = <T = unknown | undefined>(initialValue: T) => {
  const [storage, setStorage] = useState<T | undefined>(initialValue)

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea === localStorage) {
        try {
          const newValue = event.newValue ? (JSON.parse(event.newValue) as T) : undefined
          setStorage(newValue)
        } catch {
          // ignore parse errors
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  const set = (value: T) => {
    setStorage(value)
    if (value === undefined) {
      localStorage.removeItem('app-storage')
    } else {
      localStorage.setItem('app-storage', JSON.stringify(value))
    }
  }

  return [storage, set] as const
}
