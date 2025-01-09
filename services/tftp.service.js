const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;
const tftp = require("tftp");
const path = require('path');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
/**
 * Netboot tftp server
 */

module.exports = {
    name: "tftp",
    version:1,

    mixins: [

    ],

    settings: {
        tftp: {
            port: 69,
            address: '0.0.0.0',
            root: './public',
            ipxe: 'ipxe.efi',
            main: 'main.ipxe'
        }
    },

    actions: {

    },

    events: {},

    methods: {
        async createTFTPServer() {
            const port = this.settings.tftp.port || 69;
            const host = this.settings.tftp.address || '0.0.0.0';
            const root = this.settings.tftp.root || './public';

            this.tftpServer = tftp.createServer({
                root,
                port,
                host
            }, (req, res) => {
                this.onTFTPRequest(req, res);
            });

            this.tftpServer.on('listening', () => {
                this.logger.info(`TFTP Server started on ${host}:${port}`);
            });

            this.tftpServer.on('error', (err) => {
                this.logger.error('TFTP Server error', err);
            });

        },

        async startTFTPServer() {
            const port = this.settings.tftp.port || 69;
            const host = this.settings.tftp.address || '0.0.0.0';

            this.tftpServer.listen(port, host);
        },

        async stopTFTPServer() {
            this.tftpServer.close();
        },

        async onTFTPRequest(req, res) {
            const ctx = new Context(this.broker);
            const ip = req.stats.remoteAddress.replace(/^.*:/, '');

            req.on("error", (error) => {
                this.logger.error(`[${req.stats.remoteAddress}:${req.stats.remotePort}] (${req.file}) ${error.message}`);
            });

            req.on("end", () => {
                this.logger.info(`[${req.stats.remoteAddress}:${req.stats.remotePort}] (${req.file}) done`);
            });

            if (req.file === this.settings.tftp.ipxe) {
                return this.handleIpxeRequest(ctx, req, res, ip);
            }

            if (req.file === this.settings.tftp.main) {
                return this.handleMainRequest(ctx, req, res, ip);
            }

            this.tftpServer.requestListener(req, res);
        },

        async handleIpxeRequest(ctx, req, res, ip) {
            // node first contact...

            let node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }

            const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                return this.sendError(req, res, 404, `Kernel name ${node.kernel} not found`);
            }

            return this.serveFile(req, res, req.file);
        },

        async handleMainRequest(ctx, req, res, ip) {
            // node first contact...
            this.logger.info(`[${req.stats.remoteAddress}:${req.stats.remotePort}] (${req.file}) serving boot file...`);

            const node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }

            const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                return this.sendError(req, res, 404, `Kernel name ${node.kernel} not found`);
            }

            const bootFile = await this.generateBootFile(ctx, node, kernel);

            await ctx.call('v1.nodes.setStatus', {
                id: node.id,
                status: 'booting'
            });

            return this.serveFile(req, res, null, bootFile);
        },

        async serveFile(req, res, file, contents) {
            if (contents) {
                res.setSize(contents.length);
                res.end(contents);
            } else {
                const filename = path.resolve(`${this.settings.tftp.root}/${file}`);
                const stat = await fs.stat(filename).catch(() => null);
                if (!stat) {
                    return this.sendError(req, res, 404, `File ${filename} not found`);
                }

                if (stat.isDirectory()) {
                    return this.sendError(req, res, 404, `File ${filename} is a directory`);
                }

                var offset = 0;
                if (req.stats.userExtensions.offset !== undefined) {
                    offset = ~~req.stats.userExtensions.offset;
                    if (offset < 0) {
                        return req.abort("The offset must be a positive integer");
                    }
                }
                const size = stat.size - offset;
                res.setSize(size < 0 ? 0 : size);

                const fileStream = createReadStream(filename, { start: offset });
                fileStream.on('error', (error) => {
                    this.logger.error(`[${req.stats.remoteAddress}:${req.stats.remotePort}] (${req.file}) file stream error: ${error.message}`);
                    req.abort(tftp.EIO);
                })
                fileStream.pipe(res);

                this.logger.info(`Sending file ${filename} size ${stat.size} to ${req.stats.remoteAddress}:${req.stats.remotePort}`);
            }
        },

        async sendError(req, res, code, message) {
            req.abort(`[${req.stats.remoteAddress}:${req.stats.remotePort}] (${req.file}) ${message}`);
            this.logger.warn(`[${req.stats.remoteAddress}:${req.stats.remotePort}] (${req.file}) ${message}`);
        },

        async generateBootFile(ctx, node, kernel) {
            const bootFile = await ctx.call('v1.kernels.generateBootFile', {
                node: node.id,
                kernel: kernel.id,
            });

            return bootFile;
        }

    },

    created() {
        this.createTFTPServer();
    },

    async started() {
        await this.startTFTPServer();
    },

    async stopped() {
        await this.stopTFTPServer();
    }
}