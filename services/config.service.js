"use strict";
const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;

module.exports = {
    name: "config",
    version: 1,

    mixins: [
        DbService({
            createActions: false,
            adapter: {
                type: "NeDB",
                options: "./db/config.db"
            }
        })
    ],

    settings: {
        fields: {
            key: {
                type: "string",
                required: true
            },
            value: {
                type: "any",
                required: true
            },

            id: { type: "string", primaryKey: true, columnName: "_id" },
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

        defaultScopes: ["notDeleted"],
    },

    actions: {
        get: {
            rest: {
                method: "GET",
                path: "/get/:key",
            },
            params: {
                key: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { key } = ctx.params;

                const config = await this.findEntity(ctx, { query: { key } });
                if (!config) {
                    return null;
                }

                return config.value;
            }
        },
        set: {
            rest: {
                method: "POST",
                path: "/set",
            },
            params: {
                key: { type: "string", optional: false },
                value: { type: "any", optional: false }
            },
            async handler(ctx) {
                const { key, value } = ctx.params;

                const config = await this.findEntity(ctx, { query: { key } });
                if (!config) {
                    return this.createEntity(ctx, { key, value });
                } else {
                    return this.updateEntity(ctx, { id: config.id, value });
                }
            }
        },
        all: {
            rest: {
                method: "GET",
                path: "/all",
            },
            async handler(ctx) {
                const result = {};
                return this.findEntities(ctx, {})
                    .then((configs) => {
                        for (const config of configs) {
                            result[config.key] = config.value;
                        }
                        return result;
                    });
            }
        }
    },

    methods: {

    }
};