#!/usr/bin/env node

import { WebSocketServer } from 'ws'
import http from 'node:http'
import * as number from 'lib0/number'
import { getPersistence, setupWSConnection } from './utils.js'
import settings from './settings.js'
import { DAY_MS } from './date.js'
import { backupYDoc } from './backup.js'

const persistenceDir = process.env.YPERSISTENCE
const backupDir = process.env.YBACKUP

const BACKUP_DELAY = DAY_MS

const isDev = process.env.NODE_ENV !== 'production'

const wss = new WebSocketServer({ noServer: true })
const host = process.env.HOST || 'localhost'
const port = number.parseInt(process.env.PORT || '1234')
const cors = isDev ? { 'Access-Control-Allow-Origin': '*' } : {}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(
        request.url ?? '',
        `http://${request.headers.host || 'localhost'}`
    )
    const secret = requestUrl.searchParams.get('secret') || ''
    const badSecret = secret !== settings.secret
    if (badSecret) {
        response.writeHead(401, { 'Content-Type': 'application/json', ...cors })
        response.end(JSON.stringify({ error: 'Unauthorized' }))
    } else {
        if (request.method === 'GET') {
            if (request.url?.startsWith('/list')) {
                const rawPrefix = requestUrl.searchParams.get('prefix') || ''
                const emptyRawPrefix = !rawPrefix
                if (emptyRawPrefix) {
                    response.writeHead(400, {
                        'Content-Type': 'application/json',
                        ...cors,
                    })
                    response.end(
                        JSON.stringify({ error: 'Missing prefix parameter' })
                    )
                } else {
                    try {
                        const docs =
                            (await (
                                getPersistence() as Persistence | null
                            )?.provider.getAllDocNames()) ?? []
                        const prefix = `${rawPrefix}:`
                        const cleanDocs =
                            rawPrefix === '*'
                                ? docs
                                : docs.filter((name) => name.includes(prefix))
                        response.writeHead(200, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(JSON.stringify(cleanDocs ?? []))
                    } catch (error) {
                        console.warn(error)
                        response.writeHead(500, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(
                            JSON.stringify({ error: 'Internal server error' })
                        )
                    }
                }
            } else if (request.url?.startsWith('/delete')) {
                const docName = requestUrl.searchParams.get('doc')
                const emptyDocName = !docName
                if (emptyDocName) {
                    response.writeHead(400, {
                        'Content-Type': 'application/json',
                        ...cors,
                    })
                    response.end(
                        JSON.stringify({ error: 'Missing doc parameter' })
                    )
                } else {
                    try {
                        console.info('> deleting docName=', docName)
                        const docNameStr = Array.isArray(docName)
                            ? docName[0]
                            : docName
                        await (
                            getPersistence() as Persistence | null
                        )?.provider.clearDocument(docNameStr)
                        response.writeHead(200, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(JSON.stringify({ success: true }))
                    } catch (error) {
                        console.warn(error)
                        response.writeHead(500, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(
                            JSON.stringify({ error: 'Internal server error' })
                        )
                    }
                }
            } else {
                response.writeHead(404, {
                    'Content-Type': 'application/json',
                    ...cors,
                })
                response.end(JSON.stringify({ error: 'Not found' }))
            }
        } else {
            response.writeHead(405, {
                'Content-Type': 'application/json',
                ...cors,
            })
            response.end(JSON.stringify({ error: 'Method not allowed' }))
        }
    }
})

server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(
        request.url ?? '',
        `http://${request.headers.host || 'localhost'}`
    )
    const secret = requestUrl.searchParams.get('secret') || ''
    const badSecret = secret !== settings.secret
    if (badSecret) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
        setupWSConnection(ws, request, {})
    })
})

if (backupDir) {
    console.info(`backing up documents to "${backupDir}" each ${BACKUP_DELAY}`)
    setInterval(
        backupYDoc(backupDir, (getPersistence() as Persistence).provider),
        BACKUP_DELAY
    )
}

server.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}/`)
})
