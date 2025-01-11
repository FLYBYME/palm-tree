"use strict";
const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;

const os = require("os");
const path = require("path");
const Moniker = require('moniker');

const Lock = require("../lib/lock");

const dhcp = require("@network-utils/dhcp");

const ConfigMixin = require("../mixins/config.mixin");



/** 
 * 
 */
module.exports = {
    name: "dhcp",
    version: 1,

    mixins: [
        DbService({
            adapter: {
                type: "NeDB",
                options: "./db/dhcp.db"
            }
        }),
        ConfigMixin
    ],

    /**
     * Settings
     */
    settings: {
        fields: {
            ip: { type: "string" },
            mac: { type: "string" },

            // next-server
            nextServer: { type: "string" },
            // tftp-server
            tftpServer: { type: "string" },
            // boot-file
            bootFile: { type: "string" },
            // netmask
            netmask: { type: "string" },
            // broadcast
            broadcast: { type: "string" },
            // lease-time
            leaseTime: { type: "number" },

            discoverTime: { type: "number", required: false },
            offerTime: { type: "number", required: false },
            requestTime: { type: "number", required: false },
            releaseTime: { type: "number", required: false },

            node: {
                type: "string",
                required: true,
                populate: {
                    action: "v1.nodes.resolve"
                }
            },

            id: { type: "string", primaryKey: true, columnName: "_id" /*, generated: "user"*/ },
            createdAt: {
                type: "number",
                readonly: true,
                onCreate: () => Date.now(),
                columnType: "double"
            },
            updatedAt: {
                type: "number",
                readonly: true,
                onUpdate: () => Date.now(),
                columnType: "double"
            },
            deletedAt: { type: "number", readonly: true, onRemove: () => Date.now() }
        },

        scopes: {
            notDeleted: {
                deletedAt: { $exists: false }
            },
        },

        // Configure the scope as default scope
        defaultScopes: ["notDeleted"],

        // DHCP settings
        config: {
            'dhcp.port': 67, // DHCP server port
            'dhcp.serverAddress': "10.1.10.1", // DHCP server IP address
            'dhcp.gateways': ["10.1.10.1"],
            'dhcp.dns': ["1.1.1.1"],
            'dhcp.range': [10, 99],

            // pxe
            'dhcp.nextServer': "10.1.10.1",
            'dhcp.tftpServer': "10.1.10.1",
            'dhcp.bootFile': "/ipxe.efi",
            'dhcp.leaseTime': 3600
        },
    },

    /**
     * Dependencies
     */
    dependencies: [],

    /**
     * Actions
     */
    actions: {
        lookup: {
            rest: {
                method: "GET",
                path: "/lookup/:ip",
            },
            params: {
                ip: { type: "string", optional: false }
            },
            async handler(ctx) {
                return this.getByIp(ctx, ctx.params.ip);
            }
        },


        clearDB: {
            rest: {
                method: "POST",
                path: "/clear"
            },
            async handler(ctx) {
                const count = await this.countEntities(null, {});
                if (count > 0) {
                    await this.removeEntities(null, {});
                    this.logger.info(`DHCP Server leases cleared`);
                }
                return { message: `${count} leases deleted.` };
            },
        },
    },

    /**
     * Events
     */
    events: {
        async "nodes.removed"(ctx) {
            const node = ctx.params.data;
            const found = await this.findEntity(ctx, { query: { node: node.id } });
            if (found) {
                await this.removeEntity(ctx, { id: found.id });
            }

            this.logger.info(`DHCP Server node ${node.id} removed`);
        }
    },

    /**
     * Methods
     */
    methods: {

        async createServer() {
            const serverAddress = this.config.get('dhcp.serverAddress') || '0.0.0.0';
            const gateways = this.config.get('dhcp.gateways') || ['0.0.0.0'];
            const dns = this.config.get('dhcp.dns') || ['0.0.0.0'];

            const server = new dhcp.Server({
                serverId: serverAddress,
                gateways: gateways,
                domainServer: dns,
            });

            this.server = server;

            this.attachEvents(server);

            server.bind();

            this.logger.info('DHCP Server created');
        },

        attachEvents(server) {
            server.on('listening', () => {
                const address = server.address;
                this.logger.info(`DHCP Server listening on ${address.address}:${address.port}`);
            });
            server.on('discover', (event) => {
                const ctx = new Context(this.broker);
                this.handleDiscover(ctx, event);
            });
            server.on('request', (event) => {
                const ctx = new Context(this.broker);
                this.handleRequest(ctx, event);
            });
            server.on('inform', (event) => {
                const ctx = new Context(this.broker);
                this.logger.info(`DHCP Server inform from ${event.packet.chaddr}`);
            });
            server.on('release', (event) => {
                const ctx = new Context(this.broker);
                this.logger.info(`DHCP Server release from ${event.packet.chaddr}`);
            });
            server.on('decline', (event) => {
                const ctx = new Context(this.broker);
                this.logger.info(`DHCP Server decline from ${event.packet.chaddr}`);
            });
            server.on('dhcp', (event) => {
                const ctx = new Context(this.broker);
                //this.logger.info(`DHCP Server dhcp from ${event.packet.chaddr}`);
            });
        },

        async stopServer() {
            if (this.server) {
                await this.server.close();
                this.logger.info('DHCP Server stopped');
            } else {
                this.logger.info('DHCP Server already stopped');
            }
        },

        getByMac(ctx, mac) {
            return this.findEntity(ctx, { query: { mac } });
        },

        getByIp(ctx, ip) {
            return this.findEntity(ctx, { query: { ip } });
        },

        async createNewLease(ctx, mac) {
            const range = this.config.get('dhcp.range');
            const lowerRange = range[0];
            const upperRange = range[1];
            const addressSplit = this.config.get('dhcp.serverAddress').split('.');
            await this.lock.acquire('dhcp');
            for (let i = lowerRange; i <= upperRange; i++) {
                const ip = `${addressSplit[0]}.${addressSplit[1]}.${addressSplit[2]}.${i}`;
                const result = await this.findEntity(ctx, { query: { ip } });
                if (!result) {
                    this.logger.info(`DHCP Server creating new lease for ${ip}`);

                    // register node
                    let node = await ctx.call('v1.nodes.lookup', { ip });
                    if (!node) {
                        node = await ctx.call('v1.nodes.register', { ip });
                        this.logger.info(`DHCP Server node registered for ${ip} with id ${node.id}`);
                    }

                    return this.createEntity(ctx, {
                        ip,
                        mac,
                        node: node.id,
                        nextServer: this.config.get('dhcp.serverAddress'),
                        tftpServer: this.config.get('dhcp.tftpServer'),
                        bootFile: this.config.get('dhcp.bootFile'),
                        leaseTime: this.config.get('dhcp.leaseTime'),
                    }).then(async (entity) => {
                        await this.lock.release('dhcp');
                        return entity;
                    })
                }
            }

            await this.lock.release('dhcp');

            this.logger.info(`DHCP Server no available IP address for ${mac}`);

            return null;
        },

        async setDHCPOptions(ctx, packet, node, lease) {
            packet.options.push(new dhcp.HostnameOption(node.hostname));
            packet.options.push(new dhcp.DomainNameOption('cloud.local'));
            packet.options.push(new dhcp.AddressRequestOption(lease.ip));
            packet.options.push(new dhcp.DHCPServerIdOption(lease.nextServer));
            packet.options.push(new dhcp.SubnetMaskOption(this.settings.dhcp.netmask));
            packet.options.push(new dhcp.BroadcastAddressOption('255.255.255.255'));
            packet.options.push(new dhcp.AddressTimeOption(lease.leaseTime));
            packet.options.push(new dhcp.RenewalTimeOption(lease.leaseTime));
            packet.options.push(new dhcp.RebindingTimeOption(lease.leaseTime));

            if (node.stage !== "provisioned") {
                packet.options.push(new dhcp.BootFileOption(lease.bootFile));
                packet.options.push(new dhcp.TftpServerOption(lease.tftpServer));
            }

            packet.options.push(new dhcp.GatewaysOption([lease.nextServer]));
            //packet.options.push(new dhcp.DomainServerOption([lease.nextServer]));
            packet.options.push(new dhcp.BroadcastAddressOption('255.255.255.255'));
        },

        async createPacket(ctx, pkt, node, lease) {

            const packet = new dhcp.Packet();
            packet.op = dhcp.BOOTMessageType.reply;
            packet.xid = pkt.xid;// transaction id
            packet.flags = pkt.flags;// flags 
            packet.chaddr = pkt.chaddr;// client mac address
            packet.siaddr = lease.nextServer;// 
            packet.giaddr = lease.nextServer;// gateway address
            packet.yiaddr = lease.ip;

            return packet;
        },


        /**
         * Handle DHCP discover request
         * @param {Context} ctx - moleculer context
         * @param {object} event - DHCP event
         * @param {dhcp.Packet} event.packet - DHCP packet
         * @returns {Promise<dhcp.Packet>} - DHCP offer packet
         */
        async handleDiscover(ctx, event) {
            const pkt = event.packet;

            // get lease by mac address
            let lease = await this.getByMac(ctx, pkt.chaddr);
            if (!lease) {
                // if no lease, create a new one
                lease = await this.createNewLease(ctx, pkt.chaddr);
            }

            if (!lease) {
                this.logger.info(`DHCP Server no available IP address for ${pkt.chaddr}`);
                return;
            }

            // resolve node by id
            const node = await ctx.call('v1.nodes.resolve', { id: lease.node });
            if (!node) {
                this.logger.info(`DHCP Server no available node for ${pkt.chaddr}`);
                return;
            }

            const offer = new dhcp.Packet();
            offer.op = dhcp.BOOTMessageType.reply;
            offer.xid = pkt.xid;// transaction id
            offer.flags = pkt.flags;// flags 
            offer.chaddr = pkt.chaddr;// client mac address
            offer.siaddr = lease.nextServer;// server ip
            offer.giaddr = lease.nextServer;// gateway address
            offer.yiaddr = lease.ip;

            // set DHCP message type option (53)
            offer.options.push(new dhcp.DHCPMessageTypeOption(dhcp.DHCPMessageType.offer));

            // set subnet mask option (1)
            offer.options.push(new dhcp.SubnetMaskOption('255.255.255.0'));

            // set gateway options (3)
            offer.options.push(new dhcp.GatewaysOption([lease.nextServer]));

            // set domain server option (6)
            offer.options.push(new dhcp.DomainServerOption(['1.1.1.1']));

            // set hostname option (12)
            offer.options.push(new dhcp.HostnameOption(node.hostname));

            // set broadcast address option (28)
            offer.options.push(new dhcp.BroadcastAddressOption('10.1.10.255'));

            // set address time option (51)
            offer.options.push(new dhcp.AddressTimeOption('23.186.168.1'));

            // set DHCP server ID option (54)
            offer.options.push(new dhcp.DHCPServerIdOption(this.server.serverId));

            // if node is not provisioned, set TFTP server and boot file options (66, 67)
            if (node.stage !== "provisioned") {
                offer.options.push(new dhcp.TftpServerOption(lease.tftpServer));
                offer.options.push(new dhcp.BootFileOption(lease.bootFile));
            }

            this.server.send(offer);

            this.logger.info(`DHCP Server discover to ${pkt.chaddr}`);

            // update lease with discover time
            await this.updateEntity(ctx, { id: lease.id, discoverTime: new Date() });

            return offer;
        },
        async handleRequest(ctx, event) {
            const pkt = event.packet;

            const lease = await this.getByMac(ctx, pkt.chaddr);
            if (!lease) {
                this.logger.info(`DHCP Server no available IP address for ${pkt.chaddr}`);
                return;
            }

            const node = await ctx.call('v1.nodes.resolve', { id: lease.node });
            if (!node) {
                this.logger.info(`DHCP Server no available node for ${lease.mac}`);
                return;
            }

            const ack = await this.server.createAck(pkt);

            ack.xid = event.packet.xid;// transaction id
            ack.flags = event.packet.flags;// flags 
            ack.chaddr = event.packet.chaddr;// client mac address
            ack.siaddr = lease.nextServer;// server address
            ack.giaddr = lease.nextServer;// gateway address
            ack.yiaddr = lease.ip;

            // set DHCP hostname option (12)
            ack.options.push(new dhcp.HostnameOption(node.hostname));

            // set broadcast address option (28)
            ack.options.push(new dhcp.BroadcastAddressOption('255.255.255.255'));

            // if node is not provisioned, set TFTP server and boot file options (66, 67)
            if (node.stage !== "provisioned") {
                ack.options.push(new dhcp.BootFileOption(lease.bootFile));
                ack.options.push(new dhcp.TftpServerOption(lease.tftpServer));
            }

            this.server.send(ack);

            this.logger.info(`DHCP Server request ack to ${lease.mac}`);

            // update lease with request time
            await this.updateEntity(ctx, { id: lease.id, requestTime: new Date() });

            return ack;
        },
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        this.server = null;
        this.lock = new Lock();
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {
        await this.createServer();
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {
        await this.stopServer();
    }
};