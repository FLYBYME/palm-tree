const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;

const fs = require('fs').promises;
const { readFile } = require("fs");
const ssh = require("ssh2");


module.exports = {
    name: "ssh",
    version: 1,

    mixins: [
        DbService({
            adapter: {
                type: "NeDB",
                options: "./db/ssh.db"
            }
        })
    ],

    settings: {
        fields: {

            id: { type: "string", primaryKey: true, columnName: "_id" /*, generated: "user"*/ },
            createdAt: {
                type: "number",
                readonly: true,
                onCreate: () => Date.now(),
                columnType: "double"
            },
            updatedAt: {
                type: "number",
                readonly: true,
                onUpdate: () => Date.now(),
                columnType: "double"
            },
            deletedAt: { type: "number", readonly: true, onRemove: () => Date.now() }
        },

        scopes: {
            notDeleted: {
                deletedAt: { $exists: false }
            },
        },

        // Configure the scope as default scope
        defaultScopes: ["notDeleted"],

        ssh: {
            privateKey: "/root/.ssh/id_ecdsa",
            user: "root"
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
        },

    },

    created() {
        this.clients = new Map();
    },

    async started() {
        //await this.readSshKeys();
    },

    async stopped() {
        await this.closeAll();
    }
}