#!/usr/bin/env node

import WebSocket from 'ws'
import http from 'node:http'
import * as number from 'lib0/number'
import { getPersistence, setupWSConnection } from './utils.js'
import url from 'node:url'
import settings from './settings.js'
import { DAY_MS } from './date.js'
import { backupYDoc } from './backup.js'

const persistenceDir = process.env.YPERSISTENCE
const backupDir = process.env.YBACKUP

const BACKUP_DELAY = DAY_MS

const isDev = process.env.NODE_ENV !== 'production'

const wss = new WebSocket.Server({ noServer: true })
const host = process.env.HOST || 'localhost'
const port = number.parseInt(process.env.PORT || '1234')
const cors = isDev ? { 'Access-Control-Allow-Origin': '*' } : {}

const server = http.createServer(async (request, response) => {
    const parsedUrl = url.parse(request?.url ?? '', true)
    const secret = parsedUrl.query.secret || ''
    const badSecret = secret !== settings.secret
    if (badSecret) {
        response.writeHead(401, { 'Content-Type': 'application/json', ...cors })
        response.end(JSON.stringify({ error: 'Unauthorized' }))
    } else {
        if (request.method === 'GET') {
            if (request.url?.startsWith('/list')) {
                const rawPrefix = parsedUrl.query.prefix || ''
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
                            await getPersistence()?.provider.getAllDocNames()
                        const prefix = `${rawPrefix}:`
                        const cleanDocs =
                            rawPrefix === '*'
                                ? docs
                                : docs.filter((name) => name.includes(prefix))
                        response.writeHead(200, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(JSON.stringify(cleanDocs))
                    } catch (error) {
                        console.warn(error)
                        response.writeHead(500, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(
                            JSON.stringify({
                                error: 'Error retrieving document names',
                            })
                        )
                    }
                }
            } else if (request.url?.startsWith('/del')) {
                const docName = parsedUrl.query.doc || ''
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
                        console.log('> deleting docName=', docName)
                        await getPersistence()?.provider.clearDocument(docName)
                        response.writeHead(200, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(JSON.stringify({ status: 'deleted' }))
                    } catch (error) {
                        console.warn(error)
                        response.writeHead(500, {
                            'Content-Type': 'application/json',
                            ...cors,
                        })
                        response.end(
                            JSON.stringify({ error: 'Error deleting document' })
                        )
                    }
                }
            }
        } else {
            response.writeHead(200, { 'Content-Type': 'text/plain' })
            response.end('okay')
        }
    }
})

wss.on('connection', setupWSConnection)

server.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request?.url ?? '', true)
    const secret = parsedUrl.query.secret || ''
    const badSecret = secret !== settings.secret
    if (badSecret) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.end()
    } else {
        wss.handleUpgrade(
            request,
            socket,
            head,
            /** @param {any} ws */ (ws) => {
                wss.emit('connection', ws, request)
            }
        )
    }
})

server.listen(port, host, () => {
    console.log(`running at '${host}' on port ${port}`)

    if (typeof persistenceDir === 'string' && typeof backupDir === 'string') {
        console.info(
            `backing up documents to "${backupDir}" each ${BACKUP_DELAY}`
        )
        setInterval(
            backupYDoc(backupDir, getPersistence().provider),
            BACKUP_DELAY
        )
    }
})
