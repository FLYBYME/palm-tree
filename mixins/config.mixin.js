
"use strict";
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;

module.exports = {
    name: "config",
    version: 1,

    dependencies: [{
        name: "config",
        version: 1,
    }],


    created() {
        const { broker } = this;
        const cache = this.configCache = new Map();
        this.config = {
            async get(key) {
                let config = cache.get(key);
                if (!config) {
                    config = await broker.call("v1.config.get", { key });
                    cache.set(key, config);
                }
                return config;
            },
            async set(key, value) {
                const config = await broker.call("v1.config.set", { key, value });
                cache.set(key, config);
                return config;
            }
        }
    },
    async started() {
        const keys = Object.keys(this.settings.config || {});
        for (const key of keys) {
            const value = this.settings.config[key];
            const found = await this.config.get(key);
            if (!found) {
                await this.config.set(key, value);
            }
        }
        const all = await this.broker.call("v1.config.all");
        for (const key in all) {
            this.configCache.set(key, all[key]);
        }

        this.logger.info('Config loaded');
    }
};