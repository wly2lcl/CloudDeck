declare module 'y-websocket/bin/utils' {
  export function setupWSConnection(
    socket: unknown,
    request: unknown,
    options?: { docName?: string; gc?: boolean },
  ): void
  // y-websocket 未提供 server 类型；调用处按 Y.Doc 使用。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getYDoc(docName: string, gc?: boolean): any
}
