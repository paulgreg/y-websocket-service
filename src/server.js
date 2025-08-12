#!/usr/bin/env node

import WebSocket from 'ws'
import http from 'http'
import * as number from 'lib0/number'
import { getPersistence, setupWSConnection } from './utils.js'
import url from 'url'
import settings from './settings.js'

const wss = new WebSocket.Server({ noServer: true })
const host = process.env.HOST || 'localhost'
const port = number.parseInt(process.env.PORT || '1234')
const cors =
    process.env.NODE_ENV !== 'production'
        ? { 'Access-Control-Allow-Origin': '*' }
        : {}

const server = http.createServer(async (request, response) => {
    const parsedUrl = url.parse(request?.url ?? '', true)
    const secret = parsedUrl.query.secret || ''
    if (secret !== settings.secret) {
        response.writeHead(401, { 'Content-Type': 'application/json', ...cors })
        response.end(JSON.stringify({ error: 'Unauthorized' }))
    } else {
        if (request.method === 'GET') {
            if (request.url?.startsWith('/list')) {
                const rawPrefix = parsedUrl.query.prefix || ''
                if (!rawPrefix) {
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
                            await getPersistence().provider.getAllDocNames()
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
                if (!docName) {
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
                        await getPersistence().provider.clearDocument(docName)
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
    if (secret !== settings.secret) {
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
})
