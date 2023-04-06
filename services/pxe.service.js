"use strict";

const YAML = require('json2yaml')
const tftp = require("tftp");
const serveStatic = require('serve-static')
const finalhandler = require('finalhandler')
const http = require('http');
const fs = require('fs').promises

/** @type {ServiceSchema} */
module.exports = {
	name: "pxe",
	version: 1,
	/**
	 * Settings
	 */
	settings: {
		address: '10.60.50.1',
		port: 8088,
		k3osVersion: 'v0.21.5-k3s2r1',
		server_url: 'http://10.60.50.1:6443',
		token: 'K10ee6a8322a59188a860809a0ce5e39c370c2a4a267dc79fb14c9ba723902cbf7c::server:801c5b7678e8a6470c0141d94157fc71',
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
		bootSet: {
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
			const json = {
				ssh_authorized_keys: [
					...keys
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

					k3s_args: [
						'agent'
					]
				}
			}

			const yaml = YAML.stringify(json)

			res.end(yaml);

			this.bootSet.add(ip, json)
		},


		async createTFTPServer() {
			const server = tftp.createServer({
				port: 69,
				address: this.settings.address,
				denyPUT: true
			}, (req, res) => {
				req.on("error", (error) => {
					//Error from the request
					console.error(error);
				});
console.log(req.stats)
				if (this.bootSet.has(req.stats.remoteAddress)) {
					return;
				}

				//Call the default request listener
				this.requestListener(req, res);
			});
			server.host = this.settings.address
			this.tftpServer = server;

			server.on("error", (error) => {
				//Errors from the main socket
				console.error(error);
			});

			server.listen();
		},
		async createHTTPServer() {

			const serve = serveStatic('./public')

			const server = http.createServer((req, res) => {
				console.log(req.url);
				if (req.url == '/k3os/config') {
					this.handleYamlConfig(req, res)
				} else {
					serve(req, res, finalhandler(req, res))
				}
			});
			this.httpServer = server;

			server.listen(this.settings.port, this.settings.address, () => {
				console.log(`Server running at http://${this.settings.address}:${this.settings.port}/`);
			});
		}
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {
		this.bootSet = new Set();
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
