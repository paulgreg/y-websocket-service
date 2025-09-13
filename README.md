# y-websocket-service 

This is a fork of [yjs/y-websocket-server](https://github.com/yjs/y-websocket-server).

It adds authentification via a secret parameter and a few custom HTTP methods : 
 - /list to list docnument names
 - /del to remove document

## configuration

`cp src/settings.js.dist src/settings.js` and update secret 

You can define theses env var : 
 
 - HOST : listening host, ex : 127.0.0.1
 - PORT : listening port, ex : 6010
 - YPERSISTENCE : directory to save data (optional)
 - YBACKUP : directory to backup data to JSON periodically (optional)

