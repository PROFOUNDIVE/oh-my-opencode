export type StorageFileIdentity = { readonly dev: number; readonly ino: number }

export type StorageFileHandle = {
  readonly writeFile: (content: string) => Promise<void>
  readonly readFile: () => Promise<string>
  readonly identity: () => Promise<StorageFileIdentity>
  readonly sync: () => Promise<void>
  readonly close: () => Promise<void>
}

export type ProcessStatus = "live" | "dead" | "unverifiable"

export type StorageRuntime = {
  readonly mkdir: (path: string) => Promise<void>
  readonly readdir: (path: string) => Promise<readonly string[]>
  readonly readFile: (path: string) => Promise<string>
  readonly writeExclusive: (path: string, content: string) => Promise<void>
  readonly open: (path: string, flags: "r" | "wx") => Promise<StorageFileHandle>
  readonly link: (source: string, destination: string) => Promise<void>
  readonly rename: (source: string, destination: string) => Promise<void>
  readonly unlink: (path: string) => Promise<void>
  readonly sameIdentity: (path: string, identity: StorageFileIdentity) => Promise<boolean>
  readonly now: () => number
  readonly sleep: (milliseconds: number) => Promise<void>
  readonly token: () => string
  readonly pid: number
  readonly processStatus: (pid: number) => ProcessStatus
}
