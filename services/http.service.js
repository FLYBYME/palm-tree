const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime');
const yaml = require('json2yaml')
const handler = require('serve-handler');
const { createReadStream, createWriteStream } = require('fs');


/**
 * http server service
 */

module.exports = {
    name: "http",
    version: 1,

    mixins: [

    ],

    settings: {
        http: {
            port: 80,
            address: '0.0.0.0',
            root: './public',
        },
        ssl: {
            key: null,
            cert: null
        }
    },

    actions: {

    },

    events: {},

    methods: {
        async createHTTPServer() {
            const port = this.settings.http.port || 80;
            const host = this.settings.http.address || '0.0.0.0';
            this.httpServer = http.createServer((req, res) => {
                this.onHTTPRequest(req, res);
            });

            this.httpServer.on('error', (err) => {
                this.logger.error('HTTP Server error', err);
            });
            this.httpServer.on('listening', () => {
                this.logger.info(`HTTP Server started on http://${host}:${port}`);
            });
            this.httpServer.on('close', () => {
                this.logger.info('HTTP Server closed');
            });
            this.httpServer.listen(port, host);
        },

        async closeServer() {
            if (this.httpServer) {
                await this.httpServer.close();
            }
        },

        async onHTTPRequest(req, res) {
            const ctx = new Context(this.broker);
            if (req.url == '/k3os/config') {
                await this.handleK3OSConfig(ctx, req, res);
            } else if (req.url == '/ssh_keys') {
                await this.handleSSHKeys(ctx, req, res);
            } else if (req.url == '/apkovl') {
                await this.handleApkOvlUpload(ctx, req, res);
            } else {
                await this.handleMirror(ctx, req, res);
            }
        },

        async handleApkOvlUpload(ctx, req, res) {
            const ip = req.socket.remoteAddress.replace(/^.*:/, '');

            this.logger.info(`${ip} uploading apkovl`);

            const node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }

            const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                return this.sendError(req, res, 404, `Kernel name ${node.kernel} not found`);
            }

            const root = this.settings.http.root;
            const filePath = path.join(root, kernel.apkovl);
            // save file
            const fileStream = createWriteStream(filePath);
            req.pipe(fileStream);
            await new Promise((resolve, reject) => {
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end('OK');
        },

        async handleSSHKeys(ctx, req, res) {
            const ip = req.socket.remoteAddress.replace(/^.*:/, '');
            const node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }

            const authorizedKeys = node.authorizedKeys;
            if (!authorizedKeys) {
                return this.sendError(req, res, 404, `Node with ip ${ip} has no authorized keys`);
            }

            res.setHeader('Content-Type', 'text/plain');
            res.end(authorizedKeys);
        },

        async sendFileResponse(ctx, req, res, filePath, fileSize) {
            res.setHeader('Content-Type', mime.lookup(filePath));
            res.setHeader('Content-Length', fileSize);
            const fileStream = createReadStream(filePath);
            fileStream.pipe(res);
            return new Promise((resolve, reject) => {
                fileStream.on('end', resolve);
                fileStream.on('error', reject);
            });
        },

        async sendError(req, res, code, message) {
            res.statusCode = code;
            res.setHeader('Content-Type', 'text/html');
            res.end(message);
            this.logger.warn(`Sending error "${message}" to ${req.socket.remoteAddress}`);
        },

        /**
         * serve static files from public folder
         */
        async serveStatic(ctx, cache) {

            if (cache.isDownloaded) {
                while (cache.requests.length > 0) {
                    const request = cache.requests.shift();
                    this.sendFileResponse(ctx, request.req, request.res, cache.filePath, cache.size);
                }
                return cache;
            }

            this.logger.info(`File ${cache.filePath} not found`);
        },

        async handleMirror(ctx, req, res) {
            const ip = req.socket.remoteAddress.replace(/^.*:/, '');
            const node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }
            // get the kernel name
            const kernelName = req.url.split('/')[1];
            if (!kernelName) {
                return this.sendError(req, res, 404, `Kernel name ${kernelName} not found`);
            }

            const kernel = await ctx.call('v1.kernels.lookup', { name: kernelName });
            if (!kernel) {
                return this.sendError(req, res, 404, `Kernel name ${kernelName} not found`);
            }

            // get cache entry
            let cache = this.cache.get(req.url);
            if (!cache) {
                // create new cache entry
                cache = await this.createCacheEntry(ctx, req.url, kernel);
            }

            cache.requests.push({ ctx, req, res });

            if (kernel.name == 'apline' && req.url == kernel.modloop) {
                // update node state
                await ctx.call('v1.nodes.setStatus', {
                    id: node.id,
                    status: 'running'
                });
            }

            if (cache.isDownloaded) {
                this.logger.info(`Cache entry hit is downloaded for ${req.url}`);
                return this.serveStatic(ctx, cache);
            }

            if (!cache.isDownloading) {
                return this.downloadCacheEntry(ctx, cache);
            }

            this.logger.info(`Cache entry hit for ${req.url}`);
            return cache;
        },

        async downloadCacheEntry(ctx, cache) {

            // download file
            cache.isDownloading = true;

            const kernel = cache.kernel;
            const cacheURL = cache.url;
            const root = this.settings.http.root;

            const filePath = path.resolve(`${root}/${cacheURL}`);

            // check if file exists
            const stat = await fs.stat(filePath).catch(() => null);
            if (stat) {
                cache.isDownloaded = true;
                cache.isDownloading = false;
                cache.size = stat.size;
                cache.lastModified = stat.mtime;
                cache.lastAccessed = Date.now();
                cache.filePath = filePath;
                this.logger.info(`Cache entry found on disk for ${cacheURL}`);
                return this.serveStatic(ctx, cache);
            }

            this.logger.info(`Downloading file ${cacheURL} to ${filePath}`);

            const url = kernel.archive + cacheURL;

            return this.downloadFile(ctx, url, filePath, cache);
        },

        async downloadFile(ctx, url, filePath, cache) {
            return http.get(url, async (response) => {
                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.error(`Error downloading file ${url} to ${filePath}`);
                    return this.sendError(ctx, null, 404, `Error downloading file ${url} to ${filePath}`);
                }

                const contentLength = response.headers['content-length'];
                if (contentLength) {
                    cache.size = parseInt(contentLength);
                }
                cache.lastModified = new Date(response.headers['last-modified']);
                cache.lastAccessed = Date.now();

                const fileStream = createWriteStream(filePath);

                response.pipe(fileStream);

                await new Promise((resolve, reject) => {
                    fileStream.on('finish', resolve);
                    fileStream.on('error', reject);
                });

                cache.isDownloading = false;
                cache.isDownloaded = true;

                cache.filePath = filePath;

                if (!cache.size) {
                    const stats = await fs.stat(filePath).catch(() => false);
                    if (stats) {
                        cache.size = stats.size;
                    } else {
                        cache.isDownloading = false;
                        cache.isDownloaded = false;

                        while (cache.requests.length > 0) {
                            const request = cache.requests.shift();
                            this.sendError(request.req, request.res, 404, `File ${url} or ${filePath} not found`);
                        }

                        return;
                    }
                }

                return this.serveStatic(ctx, cache);

            })



        },

        async createCacheEntry(ctx, url, kernel) {
            const cache = {
                isDownloaded: false,
                isDownloading: false,

                filePath: null,

                requests: [],// array of pending requests

                url,
                kernel,

                size: 0,

                lastAccessed: Date.now(),
                lastModified: Date.now()
            };
            this.cache.set(url, cache);
            return cache;
        },

        async handleK3OSConfig(ctx, req, res) {

            const ip = req.socket.remoteAddress.replace(/^.*:/, '');
            const node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }

            const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                return this.sendError(req, res, 404, `Kernel name ${node.kernel} not found`);
            }

            const keys = await ctx.call('v1.nodes.getAuthorizedKeys', { id: node.id });
            if (!keys) {
                return this.sendError(req, res, 404, `Keys for node ${node.id} not found`);
            }

            const k3sArgs = [];
            const config = {
                hostname: node.hostname,
                ssh_authorized_keys: keys,
                write_files: [],
                init_cmd: [],
                boot_cmd: [],
                run_cmd: [],
                k3os: {
                    data_sources: [],
                    modules: ['kvm', 'nvme'],
                    dns_nameservers: ['1.1.1.1'],
                    ntp_servers: ['pool.ntp.org'],
                    labels: { ...(node.labels || {}) },
                    taints: [...(node.taints || [])],
                    k3s_args: k3sArgs,
                    token: node.token
                }
            };

            if (!node.password) {
                const password = crypto.randomBytes(16).toString('hex');
                await ctx.call('v1.nodes.setPassword', { id: node.id, password });
                config.k3os.password = password;
            } else {
                config.k3os.password = node.password;
            }

            if (!node.controlNode) {
                const controlNode = await ctx.call('v1.nodes.controlNode');
                config.k3os.server_url = `https://${controlNode.ip}:6443`;
            }

            // Append K3S arguments based on the controlNode flag
            if (node.controlNode) {
                k3sArgs.push(
                    'server',
                    '--cluster-init',
                    '--disable-cloud-controller',
                    '--cluster-domain=cloud.one-host.ca',
                    '--disable=local-storage',
                    '--disable=servicelb',
                    '--disable=traefik',
                    `--tls-san=${node.ip}`,
                    `--token=${node.token}`,
                    '--kube-apiserver-arg=service-node-port-range=1-65000',
                    `--kube-apiserver-arg=advertise-address=${node.ip}`,
                    `--kube-apiserver-arg=external-hostname=${node.ip}`
                );
            } else {
                k3sArgs.push('agent');
            }

            // Respond with the YAML configuration
            res.end(yaml.stringify(config));

            // update status
            await ctx.call('v1.nodes.setStatus', {
                id: node.id,
                status: 'running'
            });
        }

    },

    created() {
        this.httpServer = null;
        this.cache = new Map();
    },

    async started() {
        await this.createHTTPServer();
    },

    async stopped() {
        await this.closeServer();
    }
}