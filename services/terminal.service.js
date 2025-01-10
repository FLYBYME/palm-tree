const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;

const fs = require('fs').promises;
const ssh = require("ssh2");
const pty = require('node-pty');
const ws = require('ws');

module.exports = {
    name: "terminal",
    version: 1,

    mixins: [

    ],

    settings: {

        ssh: {
            privateKey: "/root/.ssh/id_ecdsa",
            user: "root"
        },

        ws: {
            port: 8082
        }
    },

    actions: {
        exec: {
            rest: {
                method: "POST",
                path: "/command/:node"
            },
            params: {
                node: { type: "string", optional: false },
                command: { type: "string", optional: false }
            },
            async handler(ctx) {
                const node = await ctx.call('v1.nodes.resolve', { id: ctx.params.node });
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${ctx.params.node} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id: ctx.params.node }
                    );
                }
                const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
                if (!kernel) {
                    throw new MoleculerClientError(
                        `Kernel name ${node.kernel} not found`,
                        404,
                        "KERNEL_NOT_FOUND",
                        { id: node.kernel }
                    );
                }
                const client = await this.createClient(node, kernel);

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
                    });
                })
            }
        },

        readFile: {
            rest: {
                method: "POST",
                path: "/readFile/:node"
            },
            params: {
                node: { type: "string", optional: false },
                path: { type: "string", optional: false }
            },
            async handler(ctx) {
                const node = await ctx.call('v1.nodes.resolve', { id: ctx.params.node });
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${ctx.params.node} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id: ctx.params.node }
                    );
                }
                const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
                if (!kernel) {
                    throw new MoleculerClientError(
                        `Kernel name ${node.kernel} not found`,
                        404,
                        "KERNEL_NOT_FOUND",
                        { id: node.kernel }
                    );
                }

                const client = await this.createClient(node, kernel);

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


    },

    events: {},

    methods: {
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

            const privateKey = await fs.readFile(this.settings.ssh.privateKey, 'utf8');

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
                    reject(err);
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
            const port = this.settings.ws.port || 8082;

            this.server = new ws.WebSocketServer({ port });

            this.attachEvents(this.server);

            this.logger.info('WebSocket Server created');
        },

        attachEvents(server) {
            server.on('listening', () => {
                const address = server.address;
                this.logger.info(`WebSocket Server listening on ${address.address}:${address.port}`);
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
            const node = await this.call('v1.nodes.resolve', { id: nodeID });
            if (!node) {
                ws.close();
                return;
            }
            const kernel = await this.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                ws.close();
                return;
            }
            const client = await this.createClient(node, kernel);

            client.shell((err, stream) => {
                if (err) {
                    this.logger.error(`SSH Client error: ${err.message}`);
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                    return;
                }
                this.logger.info(`SSH Client connected to ${node.ip}:22`);

                ws.on('message', (message) => {
                    stream.write(message);
                });

                stream.on('data', (data) => {
                    ws.send(data);
                });

                stream.on('close', () => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                });

                stream.on('error', (err) => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                });

                ws.on('close', () => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
                });

                ws.on('error', (err) => {
                    this.clients.delete(node.id);
                    client.end();
                    ws.close();
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