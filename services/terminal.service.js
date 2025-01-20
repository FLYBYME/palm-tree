const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;

const fs = require('fs').promises;
const ssh = require("ssh2");
const pty = require('node-pty');
const ws = require('ws');

const ConfigMixin = require("../mixins/config.mixin");

module.exports = {
    name: "terminal",
    version: 1,

    dependencies: [
        {
            name: "nodes",
            version: 1
        },
        {
            name: "kernels",
            version: 1
        }
    ],

    mixins: [
        ConfigMixin
    ],

    settings: {

        config: {
            "terminal.ssh.user": "root",
            "terminal.ssh.privateKey": "/root/.ssh/id_ecdsa",
            "terminal.ws.port": 8082
        }
    },

    actions: {
        exec: {
            rest: {
                method: "POST",
                path: "/:node/exec"
            },
            params: {
                node: { type: "string", optional: false },
                command: { type: "string", optional: false }
            },
            async handler(ctx) {
                const client = await this.resolveOrThrow(ctx, ctx.params.node);

                return new Promise((resolve, reject) => {
                    client.exec(ctx.params.command, (err, stream) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        const output = [];
                        stream.on('close', () => {
                            resolve(output.join(''));
                        });
                        stream.on('data', (data) => {
                            output.push(data);
                        });
                        stream.stderr.on('data', (data) => {
                            output.push(data);
                        });
                    });
                })
            }
        },

        readFile: {
            rest: {
                method: "POST",
                path: "/:node/readFile"
            },
            params: {
                node: { type: "string", optional: false },
                path: { type: "string", optional: false }
            },
            async handler(ctx) {
                const client = await this.resolveOrThrow(ctx, ctx.params.node);

                return new Promise((resolve, reject) => {
                    client.sftp((err, sftp) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        sftp.readFile(ctx.params.path, (err, data) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve(data.toString());
                        });
                    });
                })
            }
        },

        writeFile: {
            rest: {
                method: "POST",
                path: "/:node/writeFile"
            },
            params: {
                node: { type: "string", optional: false },
                path: { type: "string", optional: false },
                content: { type: "string", optional: false }
            },
            async handler(ctx) {
                const client = await this.resolveOrThrow(ctx, ctx.params.node);

                return new Promise((resolve, reject) => {
                    client.sftp((err, sftp) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        sftp.writeFile(ctx.params.path, ctx.params.content, (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve();
                        });
                    });
                });
            }
        },

        listClients: {
            rest: {
                method: "GET",
                path: "/clients"
            },
            async handler(ctx) {
                const clients = [];
                for (const client of this.clients.values()) {
                    clients.push({
                        id: client.id,
                        node: client.node
                    });
                }
                return clients;
            }
        }
    },

    events: {},

    methods: {
        async resolveOrThrow(ctx, id) {
            const node = await ctx.call('v1.nodes.resolve', { id: id });
            if (!node) {
                throw new MoleculerClientError(
                    `Node with ID ${id} not found`,
                    404,
                    "NODE_NOT_FOUND",
                    { id: id }
                );
            }

            const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                throw new MoleculerClientError(
                    `Kernel ID ${node.kernel} not found`,
                    404,
                    "KERNEL_NOT_FOUND",
                    { id: node.kernel }
                );
            }

            const client = await this.createClient(node, kernel);
            if (!client) {
                throw new MoleculerClientError(
                    `Client for node ${id} not found`,
                    404,
                    "CLIENT_NOT_FOUND",
                    { id: id }
                );
            }

            return client;
        },
        /**
         * Create a client
         */
        async createClient(node, kernel) {

            if (this.clients.has(node.id)) {
                return this.clients.get(node.id);
            }

            const client = new ssh.Client();

            this.clients.set(node.id, client);

            client.on('error', (err) => {
                this.logger.error(`SSH Client error: ${err.message}`);
                this.clients.delete(node.id);
                client.end();
            });

            const privateKey = await fs.readFile(this.config.get('terminal.ssh.privateKey'), 'utf8');

            client.on('connect', () => {
                this.logger.info(`SSH Client connected to ${node.ip}:22`);

            });

            return new Promise((resolve, reject) => {
                client.on('ready', () => {
                    resolve(client);
                });

                client.connect({
                    host: node.ip,
                    port: 22,
                    username: kernel.name == 'k3os' ? 'rancher' : 'root',
                    privateKey
                }).on('error', (err) => {
                    this.clients.delete(node.id);
                    client.end();
                    resolve(null);
                });

                this.logger.info(`SSH Client connecting to ${node.ip}:22`);
            });
        },
        /**
         * Close all clients
         */
        async closeAll() {
            for (let client of this.clients.values()) {
                await client.end();
            }
            this.clients.clear();

            this.logger.info('All SSH clients closed');
        },

        async createServer() {
            const port = this.config.get('terminal.ws.port');

            this.server = new ws.WebSocketServer({ port });

            this.attachEvents(this.server);

            this.logger.info('WebSocket Server created');
        },

        attachEvents(server) {
            server.on('listening', () => {
                const address = server.address();
                this.logger.info(`WebSocket Server listening on ws://${address.address}:${address.port}`);
            });

            server.on('connection', (ws, request) => {
                if (request.url.startsWith('/node')) {
                    const nodeID = request.url.split('/')[2];
                    this.startWsShell(ws, nodeID);
                } else {
                    ws.close();
                }
            });
        },

        async closeServer() {
            if (this.server) {
                await this.server.close();
            }
        },

        async startWsShell(ws, nodeID) {
            const node = await this.broker.call('v1.nodes.resolve', { id: nodeID });
            if (!node) {
                ws.send('SSH Client error no node\n');
                ws.close();
                return;
            }

            const kernel = await this.broker.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                ws.send('SSH Client error no kernel\n');
                ws.close();
                return;
            }

            const client = await this.createClient(node, kernel);
            if (!client) {
                ws.send('SSH Client error no client\n');
                ws.close();
                return;
            }

            client.shell((err, stream) => {
                if (err) {
                    this.logger.error(`SSH Client error: ${err.message}`);
                    this.clients.delete(node.id);
                    client.end();
                    ws.send(`SSH Client error: ${err.message}\n`);
                    ws.close();
                    return;
                }

                this.logger.info(`SSH Client connected to ${node.ip}:22`);

                ws.on('message', (message) => {
                    stream.write(message.toString());
                });

                stream.on('data', (data) => {
                    ws.send(data.toString());
                });

                stream.on('close', () => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                    this.logger.info(`SSH Client disconnected from ${node.ip}:22`);
                });

                stream.on('error', (err) => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                    this.logger.error(`SSH Client error: ${err.message}`);
                });

                ws.on('close', () => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                    this.logger.info(`WebSocket connection closed`);
                });

                ws.on('error', (err) => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                    this.logger.error(`WebSocket error: ${err.message}`);
                });
            });
        },
    },

    created() {
        this.clients = new Map();
        this.pty = null;
    },

    async started() {
        //await this.readSshKeys();
        await this.createServer();
    },

    async stopped() {
        await this.closeAll();
        await this.closeServer();
    }
}