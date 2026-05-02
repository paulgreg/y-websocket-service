import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'

import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

import * as eventloop from 'lib0/eventloop'
import { LeveldbPersistence } from 'y-leveldb'

import { callbackHandler, isCallbackSet } from './callback.js'

const CALLBACK_DEBOUNCE_WAIT = Number.parseInt(
    process.env.CALLBACK_DEBOUNCE_WAIT || '2000'
)
const CALLBACK_DEBOUNCE_MAXWAIT = Number.parseInt(
    process.env.CALLBACK_DEBOUNCE_MAXWAIT || '10000'
)

const debouncer = eventloop.createDebouncer(
    CALLBACK_DEBOUNCE_WAIT,
    CALLBACK_DEBOUNCE_MAXWAIT
)

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1
// const wsReadyStateClosing = 2
// const wsReadyStateClosed = 3

// disable gc when using snapshots!
const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0'
const persistenceDir = process.env.YPERSISTENCE

console.info('gcEnabled:', gcEnabled)

/**
 * @type {{bindState: function(string,WSSharedDoc):void, writeState:function(string,WSSharedDoc):Promise<any>, provider: any}|null}
 */
let persistence: {
    provider: any
    bindState: (docName: string, ydoc: any) => Promise<void>
    writeState: (docName: string, ydoc: any) => Promise<any>
} | null = null

if (typeof persistenceDir === 'string') {
    console.info('Persisting documents to "' + persistenceDir + '"')
    try {
        // @ts-ignore
        const ldb = new LeveldbPersistence(persistenceDir)
        persistence = {
            provider: ldb,
            bindState: async (docName, ydoc) => {
                try {
                    const persistedYdoc = await ldb.getYDoc(docName)
                    if (persistedYdoc) {
                        const newUpdates = Y.encodeStateAsUpdate(ydoc)
                        ldb.storeUpdate(docName, newUpdates)
                        const persistedUpdates =
                            Y.encodeStateAsUpdate(persistedYdoc)
                        if (persistedUpdates.length > 0) {
                            Y.applyUpdate(ydoc, persistedUpdates)
                        }
                    }
                    // Store reference to cleanup function
                    const updateHandler = (update) => {
                        ldb.storeUpdate(docName, update)
                    }
                    ydoc.on('update', updateHandler)
                    // Store cleanup function on ydoc for later removal
                    if (!ydoc._persistenceCleanup) {
                        ydoc._persistenceCleanup = []
                    }
                    ydoc._persistenceCleanup.push(() => {
                        ydoc.off('update', updateHandler)
                    })
                } catch (error) {
                    console.error(
                        'Error binding state for doc:',
                        docName,
                        error
                    )
                }
            },
            writeState: async (docName, ydoc) => {
                // Clean up event listeners before destroying
                if (ydoc._persistenceCleanup) {
                    ydoc._persistenceCleanup.forEach((cleanup) => cleanup())
                    delete ydoc._persistenceCleanup
                }
            },
        }
    } catch (error) {
        console.error('Failed to initialize persistence:', error)
        persistence = null
    }
}

/**
 * @return {null|{bindState: function(string,WSSharedDoc):void,
 * writeState:function(string,WSSharedDoc):Promise<any>}|null} used persistence layer
 */
export const getPersistence = (): any => persistence

/**
 * @param {any} persistence_
 */
export const setPersistence = (persistence_: any): void => {
    persistence = persistence_
}

/**
 * @param {any} req
 */
export class WSSharedDoc extends Y.Doc {
    conns: Map<any, Set<number>>
    awareness: any
    name: string
    _cleanup?: () => void

    constructor(name: string) {
        super({ gc: gcEnabled })
        this.name = name
        this.conns = new Map()
        this.awareness = new awarenessProtocol.Awareness(this)
        this.awareness.setLocalState(null)

        const awarenessChangeHandler = (
            { added, updated, removed }: any,
            conn: any
        ) => {
            const changedClients = added.concat(updated, removed)
            if (conn !== null) {
                const connControlledIDs = this.conns.get(conn)
                if (connControlledIDs !== undefined) {
                    added.forEach((clientID: number) => {
                        connControlledIDs.add(clientID)
                    })
                    removed.forEach((clientID: number) => {
                        connControlledIDs.delete(clientID)
                    })
                }
            }
            // broadcast awareness update
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, 1)
            encoding.writeVarUint8Array(
                encoder,
                awarenessProtocol.encodeAwarenessUpdate(
                    this.awareness,
                    changedClients
                )
            )
            const buff = encoding.toUint8Array(encoder)
            this.conns.forEach((_, c) => {
                send(this, c, buff)
            })
        }
        this.awareness.on('update', awarenessChangeHandler)

        // Store references to event listeners for cleanup
        const syncUpdateHandler = (update: any, _origin: any, doc: any) => {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, 0)
            syncProtocol.writeUpdate(encoder, update)
            const message = encoding.toUint8Array(encoder)
            this.conns.forEach((_, conn) => send(this, conn, message))
        }
        this.on('update', syncUpdateHandler)

        let callbackUpdateHandler:
            | ((_update: any, _origin: any, doc: any) => void)
            | null = null
        if (isCallbackSet) {
            callbackUpdateHandler = (_update: any, _origin: any, doc: any) => {
                debouncer(() => callbackHandler(doc))
            }
            this.on('update', callbackUpdateHandler)
        }

        // Store cleanup functions
        this._cleanup = () => {
            this.awareness.off('update', awarenessChangeHandler)
            this.off('update', syncUpdateHandler)
            if (callbackUpdateHandler) {
                this.off('update', callbackUpdateHandler)
            }
        }
    }
}

export const docs = new Map<string, WSSharedDoc>()

/**
 * Log memory statistics for debugging
 */
export const logMemoryStats = (): void => {
    if (process.env.DEBUG) {
        const memoryUsage = process.memoryUsage()
        console.debug(
            `Memory stats - Documents: ${docs.size}, ` +
                `Heap: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(
                    2
                )}MB used, ` +
                `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB total`
        )
        if (docs.size > 0) {
            const docNames = Array.from(docs.keys())
            console.debug(`Open documents: ${docNames.join(', ')}`)
        }
        if (persistence) {
            persistence.provider
                .getAllDocNames()
                .then((allDocNames: string[]) => {
                    console.debug(
                        `Total persisted documents: ${allDocNames.length}`
                    )
                })
                .catch(console.error)
        }
    }
}

export const getYDoc = (
    req: any,
    { docName }: { docName?: string } = {}
): WSSharedDoc => {
    if (!docName) {
        try {
            const requestUrl = new URL(
                req.url ?? '',
                `http://${req.headers.host || 'localhost'}`
            )
            docName = requestUrl.pathname.slice(1).split('/')[1] || ''
        } catch (e) {
            console.warn(e)
            docName = req.url.slice(1).split('?')[0].split('/')[1]
        }
    }
    if (!docName) {
        // For WebSocket connections, try to extract from the path
        try {
            const requestUrl = new URL(
                req.url ?? '',
                `http://${req.headers.host || 'localhost'}`
            )
            const pathnameParts = requestUrl.pathname
                .slice(1)
                .split('/')
                .filter((part) => part.length > 0)
            if (pathnameParts.length > 0) {
                docName = pathnameParts[pathnameParts.length - 1]
            } else {
                console.warn(
                    'Could not determine document name from request, using default:',
                    req.url
                )
                docName = 'default' // Fallback to default document
            }
        } catch (error) {
            console.warn(
                'Could not determine document name from request, using default:',
                req.url,
                error
            )
            docName = 'default' // Fallback to default document
        }
    }
    if (!docs.has(docName)) {
        const doc = new WSSharedDoc(docName)
        if (persistence !== null) {
            persistence.bindState(docName, doc)
        }
        docs.set(docName, doc)
        if (process.env.DEBUG) {
            console.debug(
                `Document ${docName} created, total documents in memory: ${docs.size}`
            )
        }
    } else if (process.env.DEBUG) {
        console.debug(
            `Document ${docName} reused, total documents in memory: ${docs.size}`
        )
    }
    return docs.get(docName) as WSSharedDoc
}

/**
 * @param {any} conn
 * @param {any} req
 * @param {Object} [options]
 * @param {function(any):any} [options.awareOfUpdate]
 */
export const setupWSConnection = (
    conn: any,
    req: any,
    options: any = {}
): void => {
    // Extract document name from URL, matching original behavior
    let docName = (req.url || '').slice(1).split('?')[0]
    if (!docName) {
        docName = (req.url || '').slice(1).split('?')[0].split('/')[1] || ''
    }

    if (process.env.DEBUG)
        console.debug(
            'WebSocket connection URL:',
            req.url,
            'Extracted docName:',
            docName
        )

    if (!docName) {
        console.warn('No document name found in WebSocket URL, using default')
        docName = 'default' // Fallback to default document
    }

    const doc = getYDoc(req, { docName })
    if (process.env.DEBUG) {
        console.debug(
            `New connection for document ${doc.name}, total connections: ${
                doc.conns.size + 1
            }`
        )
    }

    // Add connection to doc.conns
    doc.conns.set(conn, new Set())

    conn.on('close', () => {
        // Remove connection from doc.conns
        doc.conns.delete(conn)
        if (isCallbackSet) {
            debouncer(() => {
                callbackHandler(doc)
            })
        }
    })

    const messageListener = (message: any): void => {
        try {
            const encoder = encoding.createEncoder()
            const decoder = decoding.createDecoder(new Uint8Array(message))
            const messageType = decoding.readVarUint(decoder)
            switch (messageType) {
                case 0: {
                    // Sync message
                    encoding.writeVarUint(encoder, 0)
                    const syncStart = Date.now()
                    syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
                    const syncDuration = Date.now() - syncStart

                    // If the `encoder` only contains the type of reply message and no
                    // message, don't send anything.
                    if (encoding.length(encoder) > 1) {
                        if (process.env.DEBUG) {
                            console.debug(
                                `Sync message processed in ${syncDuration}ms, sending response to ${doc.conns.size} connections`
                            )
                        }
                        send(doc, conn, encoding.toUint8Array(encoder))
                    }
                    break
                }
                case 1: {
                    // Awareness message
                    const awarenessStart = Date.now()
                    awarenessProtocol.applyAwarenessUpdate(
                        doc.awareness,
                        decoding.readVarUint8Array(decoder),
                        conn
                    )
                    if (process.env.DEBUG === 'debug') {
                        const awarenessDuration = Date.now() - awarenessStart
                        console.log(
                            `Awareness update processed in ${awarenessDuration}ms`
                        )
                    }
                    break
                }
            }
        } catch (err) {
            console.error(err)
            if (doc._cleanup) {
                doc._cleanup()
            }
            doc.destroy()
            docs.delete(doc.name)
        }
    }

    conn.on('message', messageListener)

    // Check if connection is still alive
    let pongReceived = true
    const pingInterval = setInterval(() => {
        if (!pongReceived) {
            if (doc.conns.has(conn)) {
                closeConn(doc, conn)
            }
            clearInterval(pingInterval)
        } else if (doc.conns.has(conn)) {
            pongReceived = false
            try {
                conn.ping()
            } catch (e) {
                console.error(e)
                closeConn(doc, conn)
                clearInterval(pingInterval)
            }
        }
    }, 30000)

    conn.on('close', () => {
        if (process.env.DEBUG) {
            console.debug(
                `Connection closed for document ${doc.name}, remaining connections: ${doc.conns.size}`
            )
        }
        closeConn(doc, conn)
        clearInterval(pingInterval)
    })

    conn.on('pong', () => {
        pongReceived = true
    })

    // put the following in a variables in a block so the interval handlers don't keep in in
    // scope
    {
        // send sync step 1
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, 0)
        syncProtocol.writeSyncStep1(encoder, doc)
        send(doc, conn, encoding.toUint8Array(encoder))
        const awarenessStates = doc.awareness.getStates()
        if (awarenessStates.size > 0) {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, 1)
            encoding.writeVarUint8Array(
                encoder,
                awarenessProtocol.encodeAwarenessUpdate(
                    doc.awareness,
                    Array.from(awarenessStates.keys())
                )
            )
            send(doc, conn, encoding.toUint8Array(encoder))
        }
    }
}

const closeConn = (doc: WSSharedDoc, conn: any): void => {
    if (doc.conns.has(conn)) {
        /**
         * @type {Set<number>}
         */
        // @ts-ignore
        const controlledIds = doc.conns.get(conn)
        doc.conns.delete(conn)
        awarenessProtocol.removeAwarenessStates(
            doc.awareness,
            controlledIds ? Array.from(controlledIds) : [],
            null
        )
        if (doc.conns.size === 0 && persistence !== null) {
            // if persisted, we store state and destroy ydocument
            persistence.writeState(doc.name, doc).then(() => {
                if (doc._cleanup) {
                    doc._cleanup()
                }
                doc.destroy()
                docs.delete(doc.name)
                if (process.env.DEBUG) {
                    console.debug(
                        `Document ${doc.name} removed from memory, ${docs.size} documents remaining`
                    )
                }
            })
        } else if (doc.conns.size === 0) {
            // No persistence, but still clean up if no connections
            if (doc._cleanup) {
                doc._cleanup()
            }
            doc.destroy()
            docs.delete(doc.name)
            if (process.env.DEBUG) {
                console.debug(
                    `Document ${doc.name} removed from memory (no persistence), ${docs.size} documents remaining`
                )
            }
        }
    }
    try {
        conn.close()
    } catch (e) {
        console.error('Error closing connection:', e)
    }
}

const send = (doc: WSSharedDoc, conn: any, m: Uint8Array): void => {
    if (
        conn.readyState !== wsReadyStateConnecting &&
        conn.readyState !== wsReadyStateOpen
    ) {
        console.warn('Connection not ready, closing:', conn.readyState)
        closeConn(doc, conn)
        return
    }
    try {
        const sendStart = Date.now()
        conn.send(m, {}, (err) => {
            if (err === null) {
                if (process.env.DEBUG === 'debug') {
                    console.log(
                        `Message sent in ${Date.now() - sendStart}ms, ${
                            m.length
                        } bytes`
                    )
                }
            } else {
                console.error('Send error:', err)
                closeConn(doc, conn)
            }
        })
    } catch (e) {
        console.error('Send exception:', e)
        closeConn(doc, conn)
    }
}
