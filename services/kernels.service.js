const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;

/**
 * Netboot Kernel Service
 */

module.exports = {
    name: "kernels",

    mixins: [
        DbService({
            adapter: {
                type: "NeDB",
                options: "./kernels.db"
            }
        })
    ],

    settings: {
        fields: {

            name: { type: "string", required: true },
            version: { type: "string", required: true },
            arch: {
                type: "string",
                enum: [
                    "x86_64",
                    "aarch64"
                ],
                required: true
            },

            // vmlinuz, initramfs, modloop, repo, archive
            vmlinuz: { type: "string", required: true },
            initramfs: { type: "string", required: true },
            modloop: { type: "string", required: false },
            iso: { type: "string", required: false },
            repo: { type: "string", required: false },
            archive: { type: "string", required: false },

            cmdline: { type: "string", required: false },
            
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


    },

    actions: {

    },

    events: {},

    methods: {

    },

    created() {

    },

    async started() {

    },

    async stopped() {

    }
}