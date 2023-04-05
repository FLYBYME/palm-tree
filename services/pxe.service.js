"use strict";


const tftp = require("tftp");
const serveStatic = require('serve-static')
const finalhandler = require('finalhandler')
const http = require('http')

/** @type {ServiceSchema} */
module.exports = {
	name: "pxe",
	version: 1,
	/**
	 * Settings
	 */
	settings: {
		address: '10.60.50.1',
		port: 8080,
		k3osVersion: 'v0.21.5-k3s2r1'
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

				return this.bootSet
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


				//Call the default request listener
				this.requestListener(req, res);
			});
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
				if (req.url == 'hello') {
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/plain');
					res.end('Hello, World!\n');
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
