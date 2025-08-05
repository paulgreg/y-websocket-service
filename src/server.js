#!/usr/bin/env node

import WebSocket from "ws";
import http from "http";
import * as number from "lib0/number";
import { getPersistence, setupWSConnection } from "./utils.js";
import url from "url";

const wss = new WebSocket.Server({ noServer: true });
const host = process.env.HOST || "localhost";
const port = number.parseInt(process.env.PORT || "1234");

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url?.startsWith("/list")) {
    const parsedUrl = url.parse(request.url, true);
    const rawPrefix = parsedUrl.query.prefix || "";
    if (!rawPrefix) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Missing prefix parameter" }));
    } else {
      const persistence = getPersistence();
      if (persistence && typeof persistence.provider.getAllDocNames === "function") {
        try {
          const docNames = await persistence.provider.getAllDocNames();
          const prefix = `${rawPrefix}::`;
          const documents = docNames.filter((name) => name.includes(prefix)).map((name) => name.split(prefix)[1]);

          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ documents }));
        } catch (error) {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Error retrieving document names" }));
        }
      }
    }
  } else {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("okay");
  }
});

wss.on("connection", setupWSConnection);

server.on("upgrade", (request, socket, head) => {
  // You may check auth of request here..
  // Call `wss.HandleUpgrade` *after* you checked whether the client has access
  // (e.g. by checking cookies, or url parameters).
  // See https://github.com/websockets/ws#client-authentication
  wss.handleUpgrade(
    request,
    socket,
    head,
    /** @param {any} ws */ (ws) => {
      wss.emit("connection", ws, request);
    }
  );
});

server.listen(port, host, () => {
  console.log(`running at '${host}' on port ${port}`);
});
