"use strict";
const Config = require("config-service");

module.exports = {
    name: "config",
    version: 1,

    mixins: [
        Config.Service,
    ],
};