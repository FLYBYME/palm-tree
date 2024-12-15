"use strict";

const YAML = require('json2yaml')
const tftp = require("tftp");
const serveStatic = require('serve-static')
const finalhandler = require('finalhandler')
const http = require('http');
const fs = require('fs').promises
const Moniker = require('moniker');
const dhcp = require('dhcp');
const os = require('os');

const dhcpMessageTypes = {
	1: 'DHCPDISCOVER',
	2: 'DHCPOFFER',
	3: 'DHCPREQUEST',
	4: 'DHCPDECLINE',
	5: 'DHCPACK',
	6: 'DHCPNAK',
	7: 'DHCPRELEASE',
	8: 'DHCPINFORM'
};


const stages = [
	"firstContact",
	"IPAssigned",
	"menu",
	"booting",
	"booted"
];

// This one is already defined but only has attr not config so will bug out if not redefined
dhcp.addOption(60, {
	name: 'Vendor Class-Identifier',
	type: 'ASCII',
	attr: 'vendorClassId',
	config: "vendorClassId"
});
// Adding extra DHCP options needed to boot into PXE. Context for the whole undefined PXE option 
// thing is in RFC4578
dhcp.addOption(97, {
	config: "ClientID",
	type: "ASCII",
	name: "UUID/GUID-based client identifier"
});
dhcp.addOption(93, {
	config: "clientSystem",
	type: "ASCII",
	name: "Client system architecture"
});
dhcp.addOption(94, {
	config: "clientNetwork",
	type: "ASCII",
	name: "Client network device interface"
});
dhcp.addOption(128, {
	config: "PXEOption1",
	type: "ASCII",
	name: "PXE undefined option 1, TFTP Server IP Address"
});
dhcp.addOption(129, {
	config: "PXEOption2",
	type: "ASCII",
	name: "PXE undefined option 2, Call Server IP Address"
});
dhcp.addOption(130, {
	config: "PXEOption3",
	type: "ASCII",
	name: "PXE undefined option 3, Discrimination string to identify vendor"
});
dhcp.addOption(131, {
	config: "PXEOption4",
	type: "ASCII",
	name: "PXE undefined option 4, Remote Statistics Server IP Address"
});
dhcp.addOption(132, {
	config: "PXEOption5",
	type: "ASCII",
	name: "PXE undefined option 5, 802.1Q VLAN ID"
});
dhcp.addOption(133, {
	config: "PXEOption6",
	type: "ASCII",
	name: "PXE undefined option 6, 802.1Q L2 Priority"
});
dhcp.addOption(134, {
	config: "PXEOption7",
	type: "ASCII",
	name: "PXE undefined option 7, Diffserv code point for VoIP signalling and media streams"
});
dhcp.addOption(135, {
	config: "PXEOption8",
	type: "ASCII",
	name: "PXE undefined option 8"
});

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
		ssh_authorized_keys: '/home/ubuntu/.ssh/authorized_keys',
		dhcp: {
			// System settings
			range: [
				"10.1.10.10", "10.1.10.99"
			],
			forceOptions: ['hostname'], // Options that need to be sent, even if they were not requested
			randomIP: true, // Get random new IP from pool instead of keeping one ip
			static: null,

			// Option settings (there are MUCH more)
			netmask: '255.255.255.0',
			router: [
				'10.1.10.2.1'
			],
			dns: ["8.8.8.8", "8.8.4.4"],
			hostname: "kacknup",
			broadcast: '10.1.10.2.255',
			server: '10.1.10.2.1', // This is us
			bootFile: null
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
		},

		/**
		 * create the dhcp server
		 */
		async createDHCP() {
			const hostname = os.hostname();
			const ip = await this.getIP();
			const ipSplit = ip.split('.');

			const range = [
				`${ipSplit[0]}.${ipSplit[1]}.${ipSplit[2]}.10`,
				`${ipSplit[0]}.${ipSplit[1]}.${ipSplit[2]}.200`
			]
			const config = {
				range,
				forceOptions: ['hostname'], // Options that need to be sent, even if they were not requested
				randomIP: true, // Get random new IP from pool instead of keeping one ip
				static: () => { },

				// Option settings (there are MUCH more)
				netmask: '255.255.255.0',
				router: ip,
				dns: ["8.8.8.8", "8.8.4.4"],
				hostname: hostname,
				broadcast: `${ipSplit[0]}.${ipSplit[1]}.${ipSplit[2]}.255`,
				server: ip,
				bootFile: (ip) => {

				}
			}

			this.dhcpServer = dhcp.createServer(config);

			this.dhcpServer.on('message', (message) => {
				this.logger.info('dhcp', dhcpMessageTypes[message.type], message.ip, message.options);
			});

			// bound
			this.dhcpServer.on('bound', (message) => {
				this.logger.info('dhcp', dhcpMessageTypes[message.type], message.ip, message.options);
			});

			// error
			this.dhcpServer.on('error', (error) => {
				this.logger.info('dhcp', error.message);
			});

			this.dhcpServer.listen();
		},

		/**
		 * stop the dhcp server
		 */
		async stopDHCP() {
			if (this.dhcpServer) {
				this.dhcpServer.close()
			}
		},

		/**
		 * get the ip of the machine
		 */
		async getIP() {
			const interfaces = os.networkInterfaces();
			for (const name of Object.keys(interfaces)) {
				for (const iface of interfaces[name]) {
					if (iface.family === 'IPv4' && !iface.internal) {
						return iface.address;
					}
				}
			}
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
		await this.createTFTPServer();
		await this.createHTTPServer();
		await this.createDHCP();
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
		await this.stopDHCP();
	}
};
