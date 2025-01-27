const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;

const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime');
const yaml = require('json2yaml')
const { createReadStream, createWriteStream } = require('fs');
const crypto = require('crypto');
const tar = require('tar');

const Config = require("config-service");

/**
 * http server service
 */

module.exports = {
    name: "http",
    version: 1,

    mixins: [
        Config.Mixin
    ],

    settings: {
        config: {
            "http.port": 80,
            "http.address": '0.0.0.0',
            "http.root": './public',
            "http.ssl.key": null,
            "http.ssl.cert": null
        }
    },

    actions: {
        downloadFile: {
            rest: {
                method: "POST",
                path: "/downloader",
            },
            params: {
                url: { type: "string", optional: false },
                path: { type: "string", optional: false },
                kernel: { type: "string", optional: false },
            },
            async handler(ctx) {
                const url = ctx.params.url;
                const root = this.config.get('http.root');
                const localPath = ctx.params.path;
                const kernelName = ctx.params.kernel;

                const filePath = path.resolve(`${root}/${localPath}`);

                const kernel = await ctx.call('v1.kernels.lookup', { name: kernelName });
                if (!kernel) {
                    throw new MoleculerClientError(
                        `Kernel name ${kernelName} not found`,
                        404,
                        "KERNEL_NOT_FOUND",
                        { id: kernelName }
                    );
                }
                // create cache entry
                const cache = await this.createCacheEntry(ctx, localPath, kernel);

                await this.downloadFile(ctx, url, filePath, cache);

                return cache;
            }
        },
        extractFile: {
            rest: {
                method: "POST",
                path: "/extractor",
            },
            params: {
                file: { type: "string", optional: false },
                path: { type: "string", optional: false },
                kernel: { type: "string", optional: false },
            },
            async handler(ctx) {
                const root = this.config.get('http.root');
                const file = ctx.params.file;
                const localPath = ctx.params.path;
                const kernelName = ctx.params.kernel;

                const kernel = await ctx.call('v1.kernels.lookup', { name: kernelName });
                if (!kernel) {
                    throw new MoleculerClientError(
                        `Kernel name ${kernelName} not found`,
                        404,
                        "KERNEL_NOT_FOUND",
                        { id: kernelName }
                    );
                }
                // extract file to local path
                await this.extractFile(ctx, file, localPath, kernel);

                // read dir and create cache entry
                const dir = path.resolve(`${root}/${localPath}`);
                const files = await fs.readdir(dir);

            }
        },


        cache: {
            rest: {
                method: "GET",
                path: "/cache",
            },
            async handler(ctx) {
                const result = [];

                for (const [key, cache] of this.cache) {
                    // remove requests from cache
                    const json = JSON.parse(JSON.stringify(cache));
                    json.requests = cache.requests.length;
                    result.push(json);
                }

                return result;
            }
        },

        clearCache: {
            rest: {
                method: "DELETE",
                path: "/cache",
            },
            async handler(ctx) {
                this.cache.clear();
                return {
                    success: true,
                    message: 'Cache cleared'
                }
            }
        },


    },

    events: {},

    methods: {
        async createHTTPServer() {
            const port = this.config.get('http.port') || 80;
            const host = this.config.get('http.address') || '0.0.0.0';
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
            } else if (req.url == '/coreos/ignition') {
                await this.handleIgnitionConfig(ctx, req, res);
            } else if (req.url == '/ssh_keys') {
                await this.handleSSHKeys(ctx, req, res);
            } else if (req.url == '/apkovl') {
                await this.handleApkOvlUpload(ctx, req, res);
            } else {
                await this.handleMirror(ctx, req, res);
            }
        },

        async handleIgnitionConfig(ctx, req, res) {
            const ip = req.socket.remoteAddress.replace(/^.*:/, '');

            this.logger.info(`${ip} requesting ignition config`);

            const node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }

            const kernel = await ctx.call('v1.kernels.resolve', { id: node.kernel });
            if (!kernel) {
                return this.sendError(req, res, 404, `Kernel name ${node.kernel} not found`);
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                "ignition": { "version": "3.0.0" },
                "systemd": {
                    "units": [{
                        "name": "example.service",
                        "enabled": true,
                        "contents": "[Service]\nType=oneshot\nExecStart=/usr/bin/echo Hello World\n\n[Install]\nWantedBy=multi-user.target"
                    }]
                }
            }));
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

            const root = this.config.get('http.root');
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

        /**
         * Handles HTTP requests for mirrored files.
         * @param {Context} ctx - Moleculer context object
         * @param {Object} req - HTTP request object
         * @param {Object} res - HTTP response object
         */
        async handleMirror(ctx, req, res) {
            const ip = req.socket.remoteAddress.replace(/^.*:/, '');

            // Lookup node by IP address
            const node = await ctx.call('v1.nodes.lookup', { ip });
            if (!node) {
                return this.sendError(req, res, 404, `Node with ip ${ip} not found`);
            }

            // Extract kernel name from URL
            const kernelName = req.url.split('/')[1];
            if (!kernelName) {
                return this.sendError(req, res, 404, `Kernel name ${kernelName} not found`);
            }

            // Lookup kernel by name
            const kernel = await ctx.call('v1.kernels.lookup', { name: kernelName });
            if (!kernel) {
                return this.sendError(req, res, 404, `Kernel name ${kernelName} not found`);
            }

            // Retrieve or create cache entry
            let cache = this.cache.get(req.url);
            if (!cache) {
                cache = await this.createCacheEntry(ctx, req.url, kernel);
            }

            // Queue request for processing
            cache.requests.push({ ctx, req, res });

            // Update node status if specific conditions are met
            if (kernel.name == 'alpine' && req.url == `/${kernel.modloop}`) {
                await ctx.call('v1.nodes.setStatus', {
                    id: node.id,
                    status: 'running'
                });
            }

            // Serve file if already downloaded
            if (cache.isDownloaded) {
                this.logger.info(`Cache entry hit is downloaded for ${req.url}`);
                return this.serveStatic(ctx, cache);
            }

            // Start download if not already downloading
            if (!cache.isDownloading) {
                return this.downloadCacheEntry(ctx, cache);
            }

            this.logger.info(`Cache entry hit for ${req.url}`);

            return cache;
        },

        /**
         * Downloads a cache entry if it is not already downloading.
         * @param {Context} ctx - Moleculer context object
         * @param {Object} cache - Cache entry object
         */
        async downloadCacheEntry(ctx, cache) {

            // download file
            cache.isDownloading = true;

            const kernel = cache.kernel;
            const cacheURL = cache.url;
            const root = this.config.get('http.root');

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
            return (url.startsWith('http://') ? http : https).get(url, async (response) => {
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

                // create directory
                await fs.mkdir(path.dirname(filePath), { recursive: true });

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
            });
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

            if (node.controlNode && !node.token) {
                const token = crypto.randomBytes(32).toString('hex');
                await ctx.call('v1.nodes.setToken', { id: node.id, token });
                node.token = token;
            } else {
                const controlNode = await ctx.call('v1.nodes.controlNode', { group: node.group });
                await ctx.call('v1.nodes.setToken', { id: controlNode.id, token: controlNode.token });
                node.token = controlNode.token;
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
                const controlNode = await ctx.call('v1.nodes.controlNode', { group: node.group });
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
            await ctx.call('v1.nodes.setStage', {
                id: node.id,
                stage: 'provisioned'
            });

            this.logger.info(`Node ${node.name} has been configured for K3OS. Control Node: ${node.controlNode}`);
        },

        /**
         * Extract file from kernel
         * 
         * @param {Context} ctx - Moleculer context object
         * @param {Object} file - File object
         * @param {String} localPath - Local path
         * @param {Object} kernel - Kernel object
         * 
         * @returns {Promise<void>}
         */
        async extractFile(ctx, file, localPath, kernel) {
            // create dir
            await fs.mkdir(localPath, { recursive: true });
            // tar extract
            await tar.extract({
                file: file,
                cwd: localPath,
                strip: 1
            });
        },

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