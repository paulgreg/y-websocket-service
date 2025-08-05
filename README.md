# y-websocket-service 

This is a fork of [yjs/y-websocket-server](https://github.com/yjs/y-websocket-server).

It adds authentification via a secret parameter and a few custom HTTP methods : 
 - /list to list docnument names
 - /del to remove document

## configuration

`cp src/settings.js.dist src/settings.js` and update secret 
