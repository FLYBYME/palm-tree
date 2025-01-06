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
                const client = await this.createClient(node);

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
                const client = await this.createClient(node);

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
         * @param {Object} options
         */
        async createClient(options) {

            if (this.clients.has(options.id)) {
                return this.clients.get(options.id);
            }

            const client = new ssh.Client();

            this.clients.set(options.id, client);

            client.on('error', (err) => {
                this.logger.error(`SSH Client error: ${err.message}`);
            });

            const privateKey = await fs.readFile(this.settings.ssh.privateKey, 'utf8');

            client.on('connect', () => {
                this.logger.info('SSH Client connected');
            });

            return new Promise((resolve, reject) => {
                client.on('ready', () => {
                    resolve(client);
                });

                client.connect({
                    host: options.host,
                    port: options.port,
                    username: this.settings.ssh.user,
                    privateKey
                });
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
        await this.readSshKeys();
    },

    async stopped() {
        await this.closeAll();
    }
}