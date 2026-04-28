interface Persistence {
    provider: {
        getAllDocNames: () => Promise<string[]>
        clearDocument: (docName: string) => Promise<void>
        getYDoc: (docName: string) => Promise<any>
        storeUpdate: (docName: string, update: Uint8Array) => void
    }
    bindState: (docName: string, ydoc: any) => Promise<void>
    writeState: (docName: string, ydoc: any) => Promise<any>
}
