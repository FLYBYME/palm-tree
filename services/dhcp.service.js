"use strict";

const dhcp = require("dhcpjs");
const os = require("os");
const path = require("path");
const Moniker = require('moniker');

const EventEmitter = require('events').EventEmitter;
const util = require('util');
const dgram = require('dgram');
const { get } = require("http");
const client = require("tftp/lib/client");
const V4Address = require('ip-address').Address4;
const Protocol = require('dhcpjs').Protocol;

const Responder = function (options) {
    EventEmitter.call(this);

    this.options = options || {};

    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => {
        logger.error(`Responder error:\n${err.stack}`);
    });

}

util.inherits(Responder, EventEmitter);

Responder.prototype.bind = function (host) {
    let that = this;

    this.socket.bind({ address: host }, () => {
        that.socket.setTTL(1);
        that.socket.setBroadcast(true);
        console.info('bound to', host);
    });
}

Responder.prototype.close = function () {
    this.socket.close();
}

Responder.prototype.broadcastPacket = function (pkt, cb) {
    let port = 68;
    let host = this.options.broadcast || '255.255.255.255';
    this.socket.send(pkt, 0, pkt.length, port, host, cb);
}

Responder.prototype.createPacket = function (pkt) {
    if (!('xid' in pkt)) {
        throw new Error('pkt.xid required');
    }


    let ci = new Buffer(('ciaddr' in pkt) ? new V4Address(pkt.ciaddr).toArray() : [0, 0, 0, 0]);
    let yi = new Buffer(('yiaddr' in pkt) ? new V4Address(pkt.yiaddr).toArray() : [0, 0, 0, 0]);
    let si = new Buffer(('siaddr' in pkt) ? new V4Address(pkt.siaddr).toArray() : [0, 0, 0, 0]);
    let gi = new Buffer(('giaddr' in pkt) ? new V4Address(pkt.giaddr).toArray() : [0, 0, 0, 0]);

    if (!('chaddr' in pkt)) {
        throw new Error('pkt.chaddr required');
    }

    let hw = new Buffer(pkt.chaddr.split(':').map((part) => {
        return parseInt(part, 16);
    }));

    if (hw.length !== 6) {
        throw new Error('pkt.chaddr malformed, only ' + hw.length + ' bytes');
    }

    let p = new Buffer(1500);
    let i = 0;

    p.writeUInt8(pkt.op, i++);
    p.writeUInt8(pkt.htype, i++);
    p.writeUInt8(pkt.hlen, i++);
    p.writeUInt8(pkt.hops, i++);
    p.writeUInt32BE(pkt.xid, i); i += 4;
    p.writeUInt16BE(pkt.secs, i); i += 2;
    p.writeUInt16BE(pkt.flags, i); i += 2;
    ci.copy(p, i); i += ci.length;
    yi.copy(p, i); i += yi.length;
    si.copy(p, i); i += si.length;
    gi.copy(p, i); i += gi.length;
    hw.copy(p, i); i += hw.length;
    p.fill(0, i, i + 10); i += 10; // hw address padding
    p.fill(0, i, i + 192); i += 192;
    p.writeUInt32BE(0x63825363, i); i += 4;

    if (pkt.options && 'requestedIpAddress' in pkt.options) {
        p.writeUInt8(50, i++); // option 50
        let requestedIpAddress = new Buffer(new v4.Address(pkt.options.requestedIpAddress).toArray());
        p.writeUInt8(requestedIpAddress.length, i++);
        requestedIpAddress.copy(p, i); i += requestedIpAddress.length;
    }

    if (pkt.options && 'dhcpMessageType' in pkt.options) {
        p.writeUInt8(53, i++); // option 53
        p.writeUInt8(1, i++);  // length
        p.writeUInt8(pkt.options.dhcpMessageType.value, i++);
    }

    if (pkt.options && 'serverIdentifier' in pkt.options) {
        p.writeUInt8(54, i++); // option 54
        let serverIdentifier = new Buffer(new v4.Address(pkt.options.serverIdentifier).toArray());
        p.writeUInt8(serverIdentifier.length, i++);
        serverIdentifier.copy(p, i); i += serverIdentifier.length;
    }

    if (pkt.options && 'parameterRequestList' in pkt.options) {
        p.writeUInt8(55, i++); // option 55
        let parameterRequestList = new Buffer(pkt.options.parameterRequestList);

        if (parameterRequestList.length > 16) {
            throw new Error('pkt.options.parameterRequestList malformed');
        }

        p.writeUInt8(parameterRequestList.length, i++);
        parameterRequestList.copy(p, i); i += parameterRequestList.length;
    }

    if (pkt.options && 'clientIdentifier' in pkt.options) {
        let clientIdentifier = new Buffer(pkt.options.clientIdentifier);
        let optionLength = 1 + clientIdentifier.length;

        if (optionLength > 0xff) {
            throw new Error('pkt.options.clientIdentifier malformed');
        }

        p.writeUInt8(61, i++);           // option 61
        p.writeUInt8(optionLength, i++); // length
        p.writeUInt8(0, i++);            // hardware type 0
        clientIdentifier.copy(p, i); i += clientIdentifier.length;
    }

    // option 255 - end
    p.writeUInt8(0xff, i++);

    // padding
    if ((i % 2) > 0) {
        p.writeUInt8(0, i++);
    } else {
        p.writeUInt16BE(0, i++);
    }

    let remaining = 300 - i;
    if (remaining) {
        p.fill(0, i, i + remaining); i += remaining;
    }

    return p.slice(0, i);
}

Responder.prototype.createOfferPacket = function (request) {

    let pkt = {
        op: Protocol.BOOTPMessageType.BOOTPREPLY.value,
        htype: 0x01,
        hlen: 0x06,
        hops: 0x00,
        xid: 0x00000000,
        secs: 0x0000,
        flags: 0x0000,
        ciaddr: '0.0.0.0',// ciaddr is the IP address of the client
        yiaddr: this.options.address,// yiaddr is the IP address of the client
        siaddr: this.options.router,// siaddr is the IP address of the DHCP server
        giaddr: '0.0.0.0',// giaddr is the IP address of the gateway
    };

    pkt.xid = request.xid;
    pkt.chaddr = request.chaddr;
    pkt.options = request.options;


    return Responder.prototype.createPacket(pkt);
}

class Lease {
    constructor(ip) {
        this.ip = ip;
        this.mac = null;
        this.client = null;
    }

    setClient(client) {
        this.client = client;
    }

    setMac(mac) {
        this.mac = mac;
    }

    release() {
        this.client = null;
        this.mac = null;
    }
}


/** @type {ServiceSchema} */
module.exports = {
    name: "dhcp",
    version: 1,

    /**
     * Settings
     */
    settings: {
        dhcp: {
            port: 67, // DHCP server port
            address: "10.1.10.1", // DHCP server IP address
            domainName: "one-host.ca", // Domain name for DHCP clients
            range: 50, // Number of IPs in the pool
            bootFile: "ipxe.efi", // Boot file for PXE clients
            dns: ["1.1.1.1", "8.8.8.8"], // DNS servers for DHCP clients
            subnetMask: "255.255.255.0", // Subnet mask
            broadcast: "255.255.255.255",
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
        listLeases() {
            return this.leases;
        }
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
            // create the dhcp server
            const server = dhcp.createServer({

            });

            this.server = server;

            server.on('message', (m) => {
                let vender = [];
                if (m.options.vendorClassIdentifier) {
                    vender = m.options.vendorClassIdentifier.split(':');
                }

                let mType = m.op.value;

                const lease = this.getLease(m.chaddr.address);


                if (mType === Protocol.DHCPMessageType.DHCPDISCOVER.value && vender[0] === "PXEClient") {
                    let resp = new Responder({
                        address: lease.ip,
                        router: this.settings.dhcp.address,
                        broadcast: this.settings.dhcp.broadcast,
                        domainName: this.settings.dhcp.domainName,
                        dns: this.settings.dhcp.dns,
                        range: this.settings.dhcp.range,
                        bootFile: this.settings.dhcp.bootFile
                    });

                    resp.bind(this.settings.dhcp.address);

                    this.logger.info('PXEClient DHCPDISCOVER', m.xid);

                    let pkt = resp.createOfferPacket({
                        xid: m.xid,
                        chaddr: m.chaddr.address,
                        dhcpMessageType: Protocol.DHCPMessageType.DHCPOFFER.value,
                        options: {
                            
                        }
                    });

                    resp.broadcastPacket(pkt, (err) => {
                        if (err) {
                            this.logger.error(err);
                        } else {
                            this.logger.info("Offering IP to", m.xid);
                        }

                        resp.close();
                    });
                }
            });

            server.on('error', (error) => {
                this.logger.error('dhcp', error);
            });

            server.bind();

            this.logger.info('DHCP Server started');
        },

        getLease(mac) {

            let lease = this.leases.get(mac);

            if (!lease) {
                lease = this.available.shift();

                if (!lease) {
                    this.logger.error('No more leases available');
                    return null;
                }


                this.logger.info(`Assigning lease to ${mac} at ${lease.ip}`);

                lease.setMac(mac);

                this.leases.set(mac, lease);
            }


            return lease;
        },

        createLeasePool() {
            const split = this.settings.dhcp.address.split('.');

            const net = `${split[0]}.${split[1]}.${split[2]}`;
            for (let i = 0; i < this.settings.dhcp.range; i++) {
                this.available.push(new Lease(`${net}.${i + 10}`));
            }
        },



        async stopServer() {
            if (this.server) {
                await this.server.close();
                this.logger.info('DHCP Server stopped');
            } else {
                this.logger.info('DHCP Server already stopped');
            }
        },


    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        this.server = null;
        this.available = [];
        this.leases = new Map();

        this.createLeasePool();
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {
        //await this.createServer();
    },

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {
        await this.stopServer();
    }
};