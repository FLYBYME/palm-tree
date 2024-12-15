"use strict";

const yaml = require('json2yaml')
const tftp = require("tftp");
const serveStatic = require('serve-static')
const finalhandler = require('finalhandler')
const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const Moniker = require('moniker');
const os = require('os');
const path = require('path');
const Extract = require('tar-stream').Extract;
const mime = require('mime');

const fsConstants = require('fs').constants;
const { createReadStream, createWriteStream } = require('fs');


/** @type {ServiceSchema} */
module.exports = {
	name: "pxe",
	version: 1,
	/**
	 * Settings
	 */
	settings: {
		tftp: {
			port: 69,
			address: '10.1.10.1',
			root: './public',
		},
		http: {
			port: 80,
			address: '0.0.0.0',
			root: './public',
		},
		alpine: {
			version: '3.14.0',
			arch: 'x86_64',
		},
		k3os: {
			version: 'v0.21.5-k3s2r1',
			arch: 'x86_64',
		},
		ubuntu: {
			version: '20.04.6',
			arch: 'x86_64',
		},
		server: '10.1.10.1',

		sshAuthorizedKeys: '/root/.ssh/authorized_keys',

		clients: {
			'10.1.10.2': {
				ip: '10.1.10.2',
				mac: '00:00:00:00:00:00',
				os: 'k3os',
				arch: 'x86_64',
				k3os: {
					version: 'v0.21.5-k3s2r1',
					controlNode: true,
					install_device: '/dev/nvme0n1',
				}
			}
		}
	},

	/**
	 * Dependencies
	 */
	dependencies: [],

	/**
	 * Actions
	 */
	actions: {

	},

	/**
	 * Events
	 */
	events: {

	},

	/**
	 * Methods
	 */
	methods: {
		/**
		 * create tftp server
		 */
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

			this.tftpServer.listen(port, host);
		},

		/**
		 * create http server
		 */
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
				this.logger.info(`HTTP Server started on ${host}:${port}`);
			});

			this.httpServer.listen(port, host);
		},

		/**
		 * stop tftp server
		 */
		async stopTFTPServer() {
			if (this.tftpServer) {
				this.tftpServer.close();
				this.logger.info('TFTP Server stopped');
			}
		},

		/**
		 * stop http server
		 */
		async stopHTTPServer() {
			if (this.httpServer) {
				this.httpServer.close();
				this.logger.info('HTTP Server stopped');
			}
		},

		/**
		 * on http request
		 */
		async onHTTPRequest(req, res) {

			if (req.url == '/k3os/config') {
				await this.handleK3OSConfig(req, res);
			} else if (req.url.startsWith('/mirror/')) {
				await this.handleMirror(req, res);
			} else {
				// serve static files
				await this.serveStatic(req, res);
			}
		},

		/**
		 * handle k3os config for cluster
		 */
		async handleK3OSConfig(req, res) {

			res.statusCode = 200;
			res.setHeader('Content-Type', 'text/yaml');

			// Read SSH authorized keys
			const keys = await fs.readFile(this.settings.sshAuthorizedKeys, 'utf8')
				.then((data) => data.split('\n').filter((str) => str.trim() !== ''));

			const ip = req.socket.remoteAddress.replace(/^.*:/, '');
			const client = this.getClient(ip);

			if (!client) {
				this.logger.warn(`No client found for IP: ${ip}`);
				res.end('');
				return;
			}

			const controlNode = Array.from(this.clients.values()).find(c => c.k3os.controlNode);
			const controlNodeURL = controlNode ? `https://${controlNode.ip}:6443` : '';
			const token = this.settings.k3os.token || crypto.randomBytes(16).toString('hex');

			// Generate random password
			const password = crypto.randomBytes(16).toString('hex');

			// Base K3OS configuration
			const k3sArgs = [];
			const k3sConfig = {
				ssh_authorized_keys: keys,
				hostname: client.hostname,
				write_files: [],
				init_cmd: [],
				boot_cmd: [],
				run_cmd: [],
				k3os: {
					data_sources: [],
					modules: ['kvm', 'nvme'],
					dns_nameservers: ['1.1.1.1'],
					ntp_servers: ['pool.ntp.org'],
					password,
					server_url: client.k3os.controlNode ? undefined : controlNodeURL,
					token,
					labels: { ...(client.labels || {}) },
					taints: [...(client.taints || [])],
					k3s_args: k3sArgs,
				},
			};

			// Append K3S arguments based on the controlNode flag
			if (client.k3os.controlNode) {
				k3sArgs.push(
					'server',
					'--cluster-init',
					'--disable-cloud-controller',
					'--cluster-domain=cloud.one-host.ca',
					'--disable=local-storage',
					'--disable=servicelb',
					'--disable=traefik',
					`--tls-san=${ip}`,
					`--token=${token}`,
					'--kube-apiserver-arg=service-node-port-range=1-65000',
					`--kube-apiserver-arg=advertise-address=${ip}`,
					`--kube-apiserver-arg=external-hostname=${ip}`
				);
			} else {
				k3sArgs.push('agent');
			}

			// Respond with the YAML configuration
			res.end(yaml.dump(k3sConfig));

		},

		/**
		 * on tftp request for main.ipxe
		 */
		async onTFTPRequest(req, res) {
			const ip = req.stats.remoteAddress.replace(/^.*:/, '');

			req.on("error", (error) => {
				this.logger.error(`[${req.stats.remoteAddress}:${req.stats.remotePort}] (${req.file}) ${error.message}`);
			});

			if (req.file === 'ipxe.efi') {
				this.handleIpxeRequest(ip);
			}

			if (req.file === 'main.ipxe') {
				this.handleMainIpxeRequest(req, res, ip);
				return;
			}

			if (req.method === 'GET') {
				this.serveFile(req, res, ip);
				return;
			}

			this.logger.info(`File ${req.file} not found`);
			req.abort(`File ${req.file} not found`);
		},

		handleIpxeRequest(ip) {
			if (this.clients.has(ip)) {
				return;
			}
			const client = {
				ip,
				mac: null,
				os: 'alpine',
				arch: 'x86_64',
				stage: 'ipxe',
				hostname: Moniker.choose(),
				k3os: {
					controlNode: false,
					labels: {},
					taints: [],
				},
			};

			if (this.settings.clients[ip]) {
				const config = this.settings.clients[ip];
				Object.assign(client, {
					os: config.os,
					arch: config.arch,
					hostname: config.hostname || client.hostname,
					k3os: config.k3os || client.k3os,
				});
				this.logger.info(`Client ${ip} found`);
			}

			this.clients.set(ip, client);
		},

		async handleMainIpxeRequest(req, res, ip) {
			const client = this.clients.get(ip);

			if (!client) {
				this.logger.info(`Client ${ip} not found`);
				req.abort(`Client ${ip} not found`);
				return;
			}

			const bootFile = await this.generateBootFile(client);

			if (!bootFile) {
				this.logger.info(`Boot file not found for ${client.os} ${client.arch}`);
				req.abort(`Boot file not found for ${client.os} ${client.arch}`);
				return;
			}

			res.setSize(bootFile.length);
			res.end(bootFile);
			this.logger.info(`Sending boot file to ${client.ip}`);
		},

		async serveFile(req, res, ip) {
			const filename = path.resolve(`${this.settings.tftp.root}/${req.file}`);

			const stat = await fs.stat(filename).catch(() => null);
			if (!stat) {
				this.logger.info(`File ${req.file} not found`);
				req.abort(`File ${req.file} not found`);
				return;
			}

			if (stat.isDirectory()) {
				this.logger.info(`File ${req.file} is a directory`);
				req.abort(`File ${req.file} is a directory`);
				return;
			}

			this.logger.info(`Sending file ${req.file} to ${ip}`);
			res.setSize(stat.size);

			const fileStream = createReadStream(filename);
			fileStream.pipe(res);
		},

		/**
		 * serve static files
		 */
		async serveStatic(req, res) {
			const kernelType = req.url.split('/')[1];
			const clientIP = req.socket.remoteAddress.replace(/^.*:/, '');

			const kernal = this.kernels.get(kernelType);
			if (!kernal) {
				this.logger.info(`Kernel ${kernelType} not found`);
				res.setHeader('Content-Type', 'text/html');
				res.statusCode = 404;
				res.end('Kernel not found');
				return;
			}

			const resolvedPath = path.resolve(`${this.settings.http.root}/${req.url}`);
			const stats = await fs.stat(resolvedPath).catch(() => false);
			if (stats) {
				res.setHeader('Content-Type', mime.lookup(req.url));
				res.setHeader('Content-Length', stats.size);
				const fileStream = createReadStream(resolvedPath);
				fileStream.pipe(res);
				this.logger.info(`Sending file ${req.url} to ${clientIP}`);
				return;
			}

			res.setHeader('Content-Type', 'text/html');
			res.statusCode = 404;
			res.end('File not found');


			this.logger.info(`File ${req.url} not found for ${clientIP}`);
		},

		/**
		 * generate ipxe boot file
		 */
		async generateBootFile(client) {

			const type = client.os;
			const arch = client.arch;

			const kernel = this.kernels.get(type);

			let bootFile = '#!ipxe\n';
			bootFile += 'dhcp\n';
			bootFile += 'echo next-server is ${next-server}\n';
			bootFile += 'echo filaneme is ${filename}\n';
			bootFile += 'echo MAC address is ${net0/mac}\n';
			bootFile += 'echo IP address is ${ip}\n';


			if (type == 'alpine') {

				bootFile += 'set vmlinuz ' + kernel.vmlinuz + '\n';
				bootFile += 'echo vmlinuz is ${vmlinuz}\n';
				bootFile += 'set initramfs ' + kernel.initramfs + '\n';
				bootFile += 'echo initramfs is ${initramfs}\n';
				bootFile += 'set modloop ' + kernel.modloop + '\n';
				bootFile += 'echo modloop is ${modloop}\n';


				// repository
				bootFile += 'set repo ' + kernel.repo + '\n';
				bootFile += 'echo repo is ${repo}\n';

				// kernal cmdline
				bootFile += 'set cmdline ' + kernel.cmdline + '\n';
				bootFile += 'echo cmdline is ${cmdline}\n';

				let apkovl = '';
				if (kernel.apkovl) {
					bootFile += 'set apkovl ' + kernel.apkovl + '\n';
					bootFile += 'echo apkovl is ${apkovl}\n';
					apkovl = ' apkovl=${apkovl}';
				}

				bootFile += 'kernel ${vmlinuz} ${cmdline} modloop=${modloop} alpine_repo=${repo}' + apkovl + '\n';
				bootFile += 'initrd ${initramfs}\n';

				bootFile += 'boot\n';
			} else if (type == 'k3os') {

				let installParams = `k3os.install.silent=true k3os.install.power_off=true k3os.mode=install`;
				installParams += ` k3os.install.config_url=${kernel.config_url} k3os.install.device=${client.k3os.install_device || kernel.install_device}`;

				const bootParams = `printk.devkmsg=on k3os.install.iso_url=${kernel.iso_url} console=ttyS0 console=tty1 initrd=initrd.magic`;

				bootFile += 'set kernel ' + kernel.kernel + '\n';
				bootFile += 'echo kernel is ${kernel}\n';

				bootFile += 'set initramfs ' + kernel.initramfs + '\n';
				bootFile += 'echo initramfs is ${initramfs}\n';

				bootFile += `set cmdline ${installParams} ${bootParams}\n`;
				bootFile += 'echo cmdline is ${cmdline}\n';

				bootFile += 'kernel ${kernel} ${cmdline}\n';
				bootFile += 'initrd ${initramfs}\n';

				bootFile += 'boot\n';

			}

			return bootFile;
		},

		/**
		 * load kernel
		 */
		async loadKernel(type) {

			if (this.kernels.has(type)) {
				return this.kernels.get(type);
			}

			const kernel = {};

			const server = `http://${this.settings.server}/`;

			if (type == 'alpine') {

				const alpineVersion = this.settings.alpine.version;

				kernel.cmdline = 'console=tty0 modules=loop,squashfs quiet nomodeset';

				kernel.vmlinuz = `${server}alpine/netboot/${alpineVersion}/vmlinuz-lts`;
				kernel.initramfs = `${server}alpine/netboot/${alpineVersion}/initramfs-lts`;
				kernel.modloop = `${server}alpine/netboot/${alpineVersion}/modloop-lts`;
				kernel.repo = `${server}mirror/alpine/v3.14/main/`;

				kernel.archive = 'http://dl-cdn.alpinelinux.org/';
			} else if (type == 'k3os') {

				const k3osVersion = this.settings.k3os.version;

				kernel.kernel = `${server}k3os/${k3osVersion}/k3os-vmlinuz-amd64`;
				kernel.initramfs = `${server}k3os/${k3osVersion}/k3os-initrd-amd64`;
				kernel.config_url = `${server}k3os/config`;
				kernel.iso_url = `${server}k3os/${k3osVersion}/k3os-amd64.iso`;
				kernel.install_device = '/dev/mmcblk0';
			}

			this.kernels.set(type, kernel);

			return kernel;
		},

		/**
		 * handle apt/apk file cache
		 */
		async handleMirror(req, res) {
			const splitURL = req.url.split('/');
			splitURL.shift(); splitURL.shift(); // Remove /mirror
			const kernelType = splitURL[0]
			const filePath = splitURL.join('/');
			const root = this.settings.http.root;
			const resolvedPath = path.resolve(`${root}/${filePath}`);
			const clientIP = req.socket.remoteAddress;


			// Helper function to send a file as a response
			const sendFileResponse = async (res, filePath, size) => {
				res.setHeader('Content-Type', mime.lookup(filePath));
				res.setHeader('Content-Length', size);
				const fileStream = createReadStream(filePath);
				fileStream.pipe(res);
				return new Promise((resolve, reject) => {
					fileStream.on('end', resolve);
					fileStream.on('error', reject);
				});
			};

			try {
				// Check if file exists in cache
				if (this.cache.has(resolvedPath)) {
					const cache = this.cache.get(resolvedPath);

					if (cache.downloaded) {
						// Serve the cached file
						await sendFileResponse(res, resolvedPath, cache.size);
						this.logger.info(`[${clientIP}] Cached ${req.method} ${req.url}`);
					} else {
						// Queue the request until the file is downloaded
						cache.requests.push({ req, res });
						this.logger.info(`[${clientIP}] Queued ${req.method} ${req.url}`);
					}

					return;
				}

				// Get the kernel configuration
				const kernel = this.kernels.get(kernelType);
				if (!kernel) {
					res.statusCode = 404;
					res.end(`Kernel ${kernelType} not found`);
					this.logger.warn(`[${clientIP}] Kernel ${kernelType} not found`);
					return;
				}

				// Create a new cache entry
				const cache = {
					downloaded: false,
					requests: [],
					size: 0,
					path: resolvedPath,
					lastAccessed: Date.now()
				};
				cache.requests.push({ req, res });
				this.cache.set(resolvedPath, cache);

				// Check if the file already exists locally
				const fileStats = await fs.stat(resolvedPath).catch(() => null);
				if (fileStats) {
					cache.downloaded = true;
					cache.size = fileStats.size;
					cache.lastAccessed = fileStats.mtime;

					// Serve the file to all queued requests
					await Promise.all(
						cache.requests.map(({ res }) => sendFileResponse(res, resolvedPath, cache.size))
					);

					this.logger.info(`[${clientIP}] Serving from file ${req.method} ${req.url}`);
					return;
				}

				// Create the directory if it doesn't exist
				const dir = path.dirname(resolvedPath);
				await fs.mkdir(dir, { recursive: true });

				this.logger.info(`[${clientIP}] Downloading file: ${kernel.archive}${filePath}`);

				// File doesn't exist locally; download it
				const fileStream = createWriteStream(resolvedPath);
				const downloadUrl = `${kernel.archive}${filePath}`;
				const isHttps = downloadUrl.startsWith('https:');

				const request = (isHttps ? https : http).get(downloadUrl, (response) => {
					response.pipe(fileStream);

					response.on('end', async () => {
						cache.downloaded = true;
						cache.size = parseInt(response.headers['content-length'], 10) || 0;
						cache.lastAccessed = new Date();

						// Serve the file to all queued requests
						await Promise.all(
							cache.requests.map(({ res }) => sendFileResponse(res, resolvedPath, cache.size))
						);

						this.logger.info(`[${clientIP}] File downloaded ${req.method} ${req.url}`);
					});

					response.on('error', (error) => {
						this.logger.error(`[${clientIP}] Error downloading file: ${error.message}`);
						cache.requests.forEach(({ res }) => {
							res.statusCode = 500;
							res.end('Failed to download file');
						});
					});
				});

				request.on('error', (error) => {
					this.logger.error(`[${clientIP}] Error downloading file: ${error.message}`);
					cache.requests.forEach(({ res }) => {
						res.statusCode = 500;
						res.end('Failed to download file');
					});
				});

				fileStream.on('error', (error) => {
					this.logger.error(`[${clientIP}] Error saving file: ${error.message}`);
					cache.requests.forEach(({ res }) => {
						res.statusCode = 500;
						res.end('Failed to save file');
					});
				});
			} catch (error) {
				this.logger.error(`[${clientIP}] Unexpected error: ${error.message}`);
				res.statusCode = 500;
				res.end('Internal server error');
			}
		},

		/**
		 * check if file has expired
		 * @param {string} filePath
		 * @returns {boolean}
		 */
		isFileExpired(filePath) {
			const cache = this.cache.get(filePath);
			const now = new Date().getTime();
			return now - cache.lastAccessed > CACHE_EXPIRATION;
		},

		/**
		 * check expired files
		 */
		checkCache() {
			this.cache.forEach((cache, filePath) => {
				if (this.isFileExpired(filePath)) {
					this.cache.delete(filePath);
					this.logger.info(`File ${filePath} expired`);
				}
			});
		},
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {
		this.kernels = new Map();
		this.cache = new Map();
		this.clients = new Map();
		this.intervalCheck = null;
	},
	/**
	 * Service started lifecycle event handler
	 */
	async started() {
		await this.createTFTPServer();
		await this.createHTTPServer();
		await this.loadKernel('alpine');
		await this.loadKernel('k3os');
	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {
		await this.stopTFTPServer();
		await this.stopHTTPServer();
	}
};
