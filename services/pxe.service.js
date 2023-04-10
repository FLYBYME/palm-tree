"use strict";

const YAML = require('json2yaml')
const tftp = require("tftp");
const serveStatic = require('serve-static')
const finalhandler = require('finalhandler')
const http = require('http');
const fs = require('fs').promises
const Moniker = require('moniker');

/** @type {ServiceSchema} */
module.exports = {
	name: "pxe",
	version: 1,
	/**
	 * Settings
	 */
	settings: {
		address: '10.60.50.2',
		port: 8088,
		k3osVersion: 'v0.21.5-k3s2r1',
		server_url: 'https://10.60.50.250:6443',
		token: 'onehostcloudk3s',
		password: 'mygreatpassword',
		ssh_authorized_keys: '/home/ubuntu/.ssh/authorized_keys'
	},

	/**
	 * Dependencies
	 */
	dependencies: [],

	/**
	 * Actions
	 */
	actions: {
		keys: {
			params: {
				//user: { type: "string", optional: true }
			},
			/** @param {Context} ctx  */
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				const data = []
				for (const value of this.bootSet.keys()) {
					data.push(value)
				}
				return data
			}
		},
		values: {
			params: {
				//user: { type: "string", optional: true }
			},
			/** @param {Context} ctx  */
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				const data = []
				for (const value of this.bootSet.values()) {
					data.push(value)
				}
				return data
			}
		},
		writeconfig: {
			params: {
				//user: { type: "string", optional: true }
			},
			/** @param {Context} ctx  */
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				const data = []
				let dbCount = 0;
				for (const [ip, json] of this.bootSet.entries()) {

					const labels = {}

					if (ip == '10.60.50.250') {
						labels["k8s.one-host.ca/control-plane"] = true
						labels["k8s.one-host.ca/roles-compute"] = false
						labels["k8s.one-host.ca/roles-dns"] = true
						labels["k8s.one-host.ca/roles-router"] = true
					} else {
						if (dbCount++ < 2) {
							labels["k8s.one-host.ca/roles-compute"] = false
							labels["k8s.one-host.ca/roles-database"] = true
						} else {
							labels["k8s.one-host.ca/roles-compute"] = true
						}
					}

					data.push({
						"hostname": json.hostname,
						"fqdn": json.hostname + ".nto.one-host.ca",
						"username": "rancher",
						"internal": ip,
						"cpe": ip,
						"ipv4": "",
						"ipv6": "",
						"wireguard": "",
						"storage": "flash",
						"zone": "nto",
						"labels": labels
					})
				}


				await fs.writeFile('./config.json', JSON.stringify(data))
				return data
			}
		}
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
		async handleYamlConfig(req, res) {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'text/yaml');

			const keys = await fs.readFile(this.settings.ssh_authorized_keys, 'utf8')
				.then((res) => res.split('\n').filter((str) => str !== ''))

			const ip = req.socket.remoteAddress.replace(/^.*:/, '')

			let isMaster = this.settings.server_url == `https://${ip}:6443`
			
			const k3s_args = []
			if (isMaster) {
				k3s_args.push(...['server', '--cluster-init', '--disable-cloud-controller', '--cluster-domain=cloud.one-host.ca',
					'--disable=local-storage',
					'--disable=servicelb', '--disable=traefik', '--tls-san=' + ip, '--token=' + this.settings.token,
					'--kube-apiserver-arg=service-node-port-range=1-65000', '--kube-apiserver-arg=advertise-address=' + ip,
					'--kube-apiserver-arg=external-hostname=' + ip])
				k3s_args.push('--private-registry=/var/lib/rancher/k3s/registries.yaml')
				this.logger.warn(`server new url is ${this.settings.server_url}`)
			} else {
				k3s_args.push('agent')
				k3s_args.push('--private-registry=/var/lib/rancher/k3s/registries.yaml')
			}



			const json = {
				ssh_authorized_keys: [
					...keys
				],
				hostname: `k3os-${Moniker.choose()}`,
				write_files: [
					{
						"content": "mirrors:\n  10.60.50.2:5000:\n    endpoint:\n      - \"http://10.60.50.2:5000\"",
						"encoding": "",
						"owner": "",
						"path": "/var/lib/rancher/k3s/registries.yaml",
						"permissions": ""
					}
				],
				init_cmd: [],
				boot_cmd: [],
				run_cmd: [],
				k3os: {
					data_sources: [],
					modules: ['kvm', 'nvme'],
					dns_nameservers: [
						'1.1.1.1'
					],
					ntp_servers: [
						'pool.ntp.org'
					],
					password: this.settings.password,
					server_url: this.settings.server_url,
					token: this.settings.token,
					labels: {
						...(this.settings.labels || {})
					},
					taints: [...(this.settings.taints || [])],

					k3s_args: k3s_args
				}
			}

			if (isMaster) {
				delete json.k3os.server_url
			}

			const yaml = YAML.stringify(json)

			res.end(yaml);

			this.bootSet.set(ip, json)
			console.log(json)
		},


		async createTFTPServer() {
			const server = tftp.createServer({
				port: 69,
				root: './public',
				address: this.settings.address,
				denyPUT: true
			}, (req, res) => {
				if (server._closed) return;
				if (req._listenerCalled || req._aborted) return;
				req._listenerCalled = true;
				req.on("error", (error) => {
					//Error from the request
					this.logger.info('tftp', req.stats.remoteAddress, req.file, error.message);
				});
				this.logger.info('tftp', req.stats.remoteAddress, req.file, `Bootset:${this.bootSet.has(req.stats.remoteAddress)}`)
				if (this.bootSet.has(req.stats.remoteAddress)) {
					return;
				}

				var filename = server.root + "/" + req.file;

				if (req.method === "GET") {
					server._get(filename, req, res);
				} else {
					server._put(filename, req);
				}
				//Call the default request listener
				server.requestListener(req, res);
			});
			server.host = this.settings.address
			this.tftpServer = server;

			server.on("error", (error) => {
				//Errors from the main socket
				console.error(error);
			});

			server.listen();

			this.logger.info(`TFTP server running at tftp://${this.settings.address}:69/`);
		},
		async createHTTPServer() {

			const serve = serveStatic('./public')

			const server = http.createServer((req, res) => {
				this.logger.info('http', req.socket.remoteAddress, req.url)
				if (req.url == '/k3os/config') {
					this.handleYamlConfig(req, res)
				} else {
					serve(req, res, finalhandler(req, res))
				}
			});
			this.httpServer = server;

			server.listen(this.settings.port, this.settings.address, () => {
				this.logger.info(`HTTP server running at http://${this.settings.address}:${this.settings.port}/`);
			});
		}
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {
		this.bootSet = new Map();
	},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {
		await this.createTFTPServer()
		await this.createHTTPServer()
	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {
		if (this.tftpServer) {
			this.tftpServer.close()
		}
		if (this.httpServer) {
			this.httpServer.close()
		}
	}
};
