const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const { Client } = require('ssh2');
const fs = require('fs').promises;
const Moniker = require('moniker');
const wol = require('wake_on_lan');
const crypto = require('crypto');


module.exports = {
    name: "nodes",
    version:1,

    mixins: [
        DbService({
            adapter: {
                type: "NeDB",
                options: "./db/nodes.db"
            }
        })
    ],

    settings: {
        fields: {

            hostname: {
                type: "string",
                required: false,
                onCreate: (context) => {
                    return Moniker.choose();
                }
            },

            ip: {
                type: "string",
                required: true
            },

            lease: {
                type: "string",
                required: false,
                populate: {
                    action: "v1.dhcp.resolve"
                }
            },

            kernel: {
                type: "string",
                required: true,
                populate: {
                    action: "v1.kernels.resolve"
                }
            },

            password: { type: "string" },
            authorizedKeys: { type: "string" },
            controlNode: { type: "boolean", required: false, default: false },


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


        authorizedKeys: "/root/.ssh/authorized_keys",
    },

    actions: {

        lookup: {
            rest: {
                method: "GET",
                path: "/lookup/:ip",
            },
            params: {
                ip: { type: "string", optional: false }
            },
            async handler(ctx) {
                return this.getNodeByIp(ctx, ctx.params.ip);
            }
        },

        register: {
            rest: {
                method: "POST",
                path: "/register",
            },
            params: {
                ip: { type: "string", optional: false },
                kernel: {
                    type: "string",
                    optional: true,
                    enum: [
                        "k3os",
                        "alpine"
                    ],
                    default: "alpine"
                }
            },
            async handler(ctx) {
                const { ip, kernel: kernelName } = ctx.params;

                const kernel = await ctx.call('v1.kernels.lookup', { name: kernelName });
                const authorizedKeys = await this.getAuthorizedKeys(ctx);

                const entity = {
                    ip,
                    password: crypto.randomBytes(16).toString('hex'),
                    kernel: kernel.id,
                    authorizedKeys
                };

                const found = await this.findEntity(ctx, {
                    query: {
                        ip
                    }
                });

                if (found) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} already exists`,
                        409,
                        "NODE_ALREADY_EXISTS",
                        { ip }
                    );
                }

                return this.createEntity(ctx, entity);
            }
        },


        setMLease: {
            rest: {
                method: "POST",
                path: "/:id/set-lease",
            },
            params: {
                id: { type: "string", optional: false },
                lease: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id, lease } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    lease
                });

                this.logger.info(`Node ${id} lease updated to ${lease} from ${node.lease}`);

                return updatedNode;
            }
        },

        getAuthorizedKeys: {
            rest: {
                method: "GET",
                path: "/authorized-keys",
            },
            params: {
                id: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                return node.authorizedKeys;
            }
        },


        setAuthorizedKeys: {
            rest: {
                method: "POST",
                path: "/authorized-keys",
            },
            params: {
                id: { type: "string", optional: false },
                authorizedKeys: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id, authorizedKeys } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    authorizedKeys
                });

                this.logger.info(`Node ${id} authorized keys updated to ${authorizedKeys} from ${node.authorizedKeys}`);

                return updatedNode;
            }
        },

    },

    events: {},

    methods: {
        async getNodeById(ctx, id) {
            return this.resolveEntities(ctx, { id });
        },
        async getNodeByIp(ctx, ip) {
            return this.findEntity(ctx, {
                query: {
                    ip
                }
            });
        },
        async getAuthorizedKeys(ctx) {
            const stats = await fs.stat(this.settings.authorizedKeys).catch(() => false);
            if (!stats) {
                return '';
            }

            return fs.readFile(this.settings.authorizedKeys, 'utf8');
        }
    },

    created() {

    },

    async started() {

    },

    async stopped() {
    }
}