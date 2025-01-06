"use strict";
const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;

const os = require("os");
const path = require("path");
const Moniker = require('moniker');

const Lock = require("../lib/lock");

const dhcp = require("@network-utils/dhcp");



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
        })
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


            leaseStartTime: { type: "number", required: false },
            leaseEndTime: { type: "number", required: false },

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
        dhcp: {
            port: 67, // DHCP server port
            serverAddress: "10.1.10.1", // DHCP server IP address
            gateways: ["10.1.10.1"],
            dns: ["10.1.10.1"],
            range: [10, 99],

            // pxe
            nextServer: "10.1.10.1",
            tftpServer: "10.1.10.1",
            bootFile: "/ipxe.efi",
            leaseTime: 3600
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

    },

    /**
     * Events
     */
    events: {},

    /**
     * Methods
     */
    methods: {

        async createServer() {
            const serverAddress = this.settings.dhcp.serverAddress || '0.0.0.0';
            const gateways = this.settings.dhcp.gateways || ['0.0.0.0'];
            const dns = this.settings.dhcp.dns || ['0.0.0.0'];

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
                this.logger.info('DHCP Server started');
            });
            server.on('discover', (event) => {
                const ctx = new Context(this.broker);
                this.handleDiscover(ctx, event);
            });
            server.on('request', (event) => {
                const ctx = new Context(this.broker);
                this.handleRequest(ctx, event);
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

        async createNewLease(ctx, mac) {
            const lowerRange = this.settings.dhcp.range[0];
            const upperRange = this.settings.dhcp.range[1];
            const addressSplit = this.settings.dhcp.serverAddress.split('.');
            const hostname = Moniker.choose();
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
                        nextServer: this.settings.dhcp.nextServer,
                        tftpServer: this.settings.dhcp.tftpServer,
                        bootFile: this.settings.dhcp.bootFile,
                        leaseTime: this.settings.dhcp.leaseTime,
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


        async handleDiscover(ctx, event) {
            const pkt = event.packet;

            let lease = await this.getByMac(ctx, pkt.chaddr);
            if (!lease) {
                lease = await this.createNewLease(ctx, pkt.chaddr);
            }

            if (!lease) {
                this.logger.info(`DHCP Server no available IP address for ${pkt.chaddr}`);
                return;
            }

            const node = await ctx.call('v1.nodes.resolve', { id: lease.node });
            if (!node) {
                this.logger.info(`DHCP Server no available node for ${pkt.chaddr}`);
                return;
            }

            const offer = new dhcp.Packet();
            offer.yiaddr = lease.ip;
            offer.op = dhcp.BOOTMessageType.reply;
            offer.giaddr = pkt.giaddr;// gateway
            offer.xid = pkt.xid;// transaction id
            offer.flags = pkt.flags;// flags 
            offer.chaddr = pkt.chaddr;// client mac address
            offer.siaddr = this.settings.dhcp.serverAddress;

            offer.options.push(new dhcp.DHCPMessageTypeOption(dhcp.DHCPMessageType.offer));// #53
            offer.options.push(new dhcp.SubnetMaskOption(this.server.netmask));// #1

            if (this.server.gateways.length) {
                offer.options.push(new dhcp.GatewaysOption(this.server.gateways));// #3
            }

            if (this.server.domainServer.length) {
                offer.options.push(new dhcp.DomainServerOption(this.server.domainServer));// #6
            }

            offer.options.push(new dhcp.AddressTimeOption(this.server.addressTime));// #51
            offer.options.push(new dhcp.DHCPServerIdOption(this.server.serverId));// #54
            offer.options.push(new dhcp.TftpServerOption(lease.tftpServer));// #66
            offer.options.push(new dhcp.BootFileOption(lease.bootFile));// #67
            offer.options.push(new dhcp.HostnameOption(node.hostname));// #12

            this.server.send(offer);

            this.logger.info(`DHCP Server discover to ${pkt.chaddr}`);
        },
        async handleRequest(ctx, event) {
            const ack = this.server.createAck(event.packet);

            const lease = await this.getByMac(ctx, event.packet.chaddr);
            if (!lease) {
                this.logger.info(`DHCP Server no available IP address for ${event.packet.chaddr}`);
                return;
            }

            const node = await ctx.call('v1.nodes.resolve', { id: lease.node });
            if (!node) {
                this.logger.info(`DHCP Server no available node for ${pkt.chaddr}`);
                return;
            }

            ack.yiaddr = lease.ip;
            ack.siaddr = this.settings.dhcp.serverAddress;

            ack.options.push(new dhcp.TftpServerOption(lease.tftpServer));// #66
            ack.options.push(new dhcp.BootFileOption(lease.bootFile));// #67
            ack.options.push(new dhcp.HostnameOption(node.hostname));// #12

            this.server.send(ack);

            this.logger.info(`DHCP Server request ack to ${event.packet.chaddr}`);
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