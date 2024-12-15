const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const { Client } = require('ssh2');
const fs = require('fs').promises;
const Moniker = require('moniker');
const wol = require('wake_on_lan');


module.exports = {
    name: "nodes",

    mixins: [
        DbService({
            adapter: {
                type: "NeDB",
                options: "./nodes.db"
            }
        })
    ],

    settings: {
        fields: {

            hostname: {
                type: "string",
                required: false,
                onCreate: (context) => {
                    return Moniker.choose();
                }
            },
            ip: { type: "string" },
            mac: { type: "string" },
            stage: {
                type: "string",
                enum: [// pxei boot process information gathering, sleeping, firstContact...
                    "firstContact",
                    "sleeping",
                    "contact",
                    "IPAssigned",
                ],
                default: "firstContact"
            },
            // storage data
            storage: {
                type: "array",
                items: {
                    type: "object",
                    fields: {
                        size: { type: "number" },
                        used: { type: "number" },
                        free: { type: "number" },
                        device: { type: "string" },
                        mount: { type: "string" }
                    }
                },
                required: false,
                default: []
            },


            // network data
            network: {
                type: "array",
                items: {
                    type: "object",
                    fields: {
                        name: { type: "string" }, // Interface name (e.g., eth0, wlan0)
                        ip: { type: "string", optional: true }, // IPv4 address
                        mac: { type: "string", optional: true }, // MAC address
                        mask: { type: "string", optional: true }, // Subnet mask
                        gateway: { type: "string", optional: true }, // Gateway
                        dns: { type: "array", items: { type: "string" }, optional: true } // DNS servers
                    }
                },
                required: false,
                default: []
            },


            // cpu data
            cpu: {
                type: "object",
                fields: {
                    model: { type: "string" },
                    cores: { type: "number" },
                    threads: { type: "number" },
                    clockMin: { type: "number" },
                    clockMax: { type: "number" },
                    cache: { type: "number" } // in KB
                },
                required: false,
                default: {}
            },


            // memory data
            memory: {
                type: "object",
                fields: {
                    total: { type: "number" },
                    free: { type: "number" },
                    used: { type: "number" }
                },
                required: false,
                default: {}
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


        id_ecdsa: "/root/.ssh/id_ecdsa",
    },

    actions: {
        register: {
            rest: {
                method: "POST",
                path: "/register",
            },
            params: {
                ip: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip } = ctx.params;

                const entity = {
                    ip,
                    stage: "firstContact"
                };

                const found = await this.findEntity(ctx, {
                    query: {
                        ip
                    }
                });

                if (found) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} already exists`,
                        409,
                        "NODE_ALREADY_EXISTS",
                        { ip }
                    );
                }

                return this.createEntity(ctx, entity);
            }
        },


        setMac: {
            rest: {
                method: "POST",
                path: "/set-mac",
            },
            params: {
                ip: { type: "string", optional: false },
                mac: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip, mac } = ctx.params;

                const node = await this.getNodeByIp(ip);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { ip }
                    );
                }

                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    mac
                });

                this.logger.info(`Node ${ip} mac updated to ${mac} from ${node.mac}`);

                return updatedNode;
            }
        },

        setStage: {
            rest: {
                method: "POST",
                path: "/set-stage",
            },
            params: {
                ip: { type: "string", optional: false },
                stage: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip, stage } = ctx.params;

                const node = await this.getNodeByIp(ip);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { ip }
                    );
                }

                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    stage
                });

                this.logger.info(`Node ${ip} stage updated to ${stage} from ${node.stage}`);

                return updatedNode;
            }
        },


        updateStorage: {
            rest: {
                method: "POST",
                path: "/update-storage",
            },
            params: {
                ip: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip } = ctx.params;

                const node = await this.getNodeByIp(ip);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { ip }
                    );
                }

                // Fetch storage info from the node
                const storageDevices = await this.fetchStorageDevices(node);

                if (!storageDevices || !storageDevices.length) {
                    throw new MoleculerClientError(
                        `Failed to fetch storage devices for node with IP ${ip}`,
                        500,
                        "FETCH_STORAGE_FAILED",
                        { ip }
                    );
                }

                // Update node's storage data in the database
                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    storage: storageDevices
                });

                this.logger.info(`Node ${ip} storage updated`);

                return updatedNode;
            }
        },
        updateCpu: {
            rest: {
                method: "POST",
                path: "/update-cpu",
            },
            params: {
                ip: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip } = ctx.params;

                const node = await this.getNodeByIp(ip);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { ip }
                    );
                }

                // Fetch CPU info from the node
                const cpuInfo = await this.fetchCpuInfo(node.ip);

                if (!cpuInfo) {
                    throw new MoleculerClientError(
                        `Failed to fetch CPU info for node with IP ${ip}`,
                        500,
                        "FETCH_CPU_FAILED",
                        { ip }
                    );
                }

                // Update node's CPU data in the database
                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    cpu: cpuInfo
                });

                this.logger.info(`Node ${ip} CPU updated`);

                return updatedNode;
            }
        },
        updateNetwork: {
            rest: {
                method: "POST",
                path: "/update-network",
            },
            params: {
                ip: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip } = ctx.params;

                const node = await this.getNodeByIp(ip);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { ip }
                    );
                }

                // Fetch network interfaces from the node
                const interfaces = await this.fetchNetworkInterfaces(ip);

                if (!interfaces || !interfaces.length) {
                    throw new MoleculerClientError(
                        `Failed to fetch network interfaces for node with IP ${ip}`,
                        500,
                        "FETCH_NETWORK_FAILED",
                        { ip }
                    );
                }

                // Update node's network data in the database
                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    network: interfaces
                });

                this.logger.info(`Node ${ip} network updated`);

                return updatedNode;
            }
        },

        reboot: {
            rest: {
                method: "POST",
                path: "/reboot",
            },
            params: {
                ip: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip } = ctx.params;

                const node = await this.getNodeByIp(ip);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with ip ${ip} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { ip }
                    );
                }

                this.logger.info(`Node ${ip} rebooted`);
                return this.rebootNode(node);
            }
        },

        wol: {
            rest: {
                method: "POST",
                path: "/wol",
            },
            params: {
                mac: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { mac } = ctx.params;
                return this.sendMagicPacket(mac);
            }
        },


        exec: {
            rest: {
                method: "POST",
                path: "/exec",
            },
            params: {
                ip: { type: "string", optional: false },
                command: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { ip, command } = ctx.params;
                return this.execCommand(ip, command);
            }
        },

        listConnections: {
            rest: {
                method: "GET",
                path: "/connections",
            },
            async handler(ctx) {
                return this.getConnections();
            }
        }
    },

    events: {},

    methods: {
        async sendMagicPacket(mac) {
            return new Promise((resolve, reject) => {
                wol.wake(mac, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        },

        readSSHKey() {
            return fs.readFile(this.settings.id_ecdsa, 'utf-8');
        },

        async closeAllConnections() {
            for (const [ip, connection] of this.connections) {
                await connection.end();
            }

            this.connections.clear();
        },

        async closeConnection(ip) {
            if (this.connections.has(ip)) {
                await this.connections.get(ip).end();
                this.connections.delete(ip);
            }
        },

        async openConnection(ip) {
            if (this.connections.has(ip)) {
                return this.connections.get(ip);
            }

            const connection = new Client();

            await connection.connect({
                host: ip,
                port: 22,
                username: "root",
                privateKey: this.sshKey
            });

            this.connections.set(ip, connection);

            this.logger.info(`Connecting to ${ip}`);

            return new Promise((resolve, reject) => {
                connection.on("ready", () => {
                    resolve(connection);
                    this.logger.info(`Connected to ${ip}`);
                });
                connection.on("error", (error) => {
                    reject(error);
                    this.logger.error(`Failed to connect to ${ip}: ${error.message}`);
                });
            });
        },

        listConnections() {
            return Array.from(this.connections.keys());
        },

        getConnection(ip) {
            return this.connections.get(ip);
        },

        async execCommand(ip, command) {
            const connection = await this.openConnection(ip);

            return new Promise((resolve, reject) => {
                connection.exec(command, (error, stream) => {
                    if (error) {
                        reject(error);
                    } else {
                        let output = "";
                        stream.on("data", (data) => {
                            console.log(ip, data.toString());
                            output += data;
                        });
                        stream.stderr.on("data", (data) => {
                            console.log(ip, data.toString());
                            output += data;
                        })
                        stream.on("error", (error) => {
                            reject(error);
                        });
                        stream.on("end", () => {
                            resolve(output);
                        });
                    }
                });
            });
        },

        async getNodeByIp(ip) {
            const found = await this.findEntity({
                query: {
                    ip
                }
            });

            return found;
        },

        async fetchStorageDevices(node) {
            const command = "df -h --output=size,used,avail,source,target";
            const output = await this.execCommand(node.ip, command);

            // Log the raw output for debugging
            console.log("Command output:", output);

            const devices = output
                .trim()
                .split("\n")
                .filter(
                    line => line.trim() !== "" &&
                        !line.startsWith("Size") && // Exclude header line
                        !line.includes("tmpfs") && // Exclude temporary filesystem
                        !line.includes("/dev/zram")
                )
                .map(line => {
                    this.logger.info(`Parsed line: ${line}`);
                    const [size, used, free, device, mount] = line.trim().split(/\s+/);

                    // Log each parsed item for debugging
                    this.logger.info({
                        size, used, free, device, mount
                    });

                    return {
                        size: parseFloat(size.replace(/[^0-9.]/g, "")), // Remove units
                        used: parseFloat(used.replace(/[^0-9.]/g, "")),
                        free: parseFloat(free.replace(/[^0-9.]/g, "")),
                        device,
                        mount
                    };
                });

            if (!devices.length) {
                throw new Error("No storage devices found");
            }

            return devices;
        },
        async fetchCpuInfo(node) {
            const command = `
                lscpu | grep -E 'Model name|CPU\\(s\\)|Thread|Core|MHz|Cache size'
            `; // Extracts CPU info using lscpu
            const output = await this.execCommand(node.ip, command);

            console.log("Command output:", output.trim().split("\n"));

            const [cores, online, model, coresPerCluster, threads, clockMax, clockMin, cache] = output.trim().split("\n");

            if (!model || !cores || !clockMin) {
                throw new Error("Invalid CPU info fetched");
            }

            return {
                model: model.split(":")[1].trim(),
                online: online.split(":")[1].trim(),
                cores: parseInt(cores.split(":")[1].trim()),
                threads: parseInt(threads.split(":")[1].trim()),
                clockMin: parseInt(clockMin.split(":")[1].trim()),
                clockMax: parseInt(clockMax.split(":")[1].trim()),
                cache: cache.split(":")[1].trim()
            };
        },
        async fetchNetworkInterfaces(ip) {
            const command = `
                ip -o addr show | awk '/inet / {print $2, $4, $6}'
            `; // Combines IP address and MAC address listing
            const output = await this.execCommand(ip, command);

            const lines = output.trim().split("\n");
            const interfaces = [];

            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length === 3 || parts.length === 2) {
                    const [name, ipWithMask, mac] = parts;
                    const [ip, mask] = ipWithMask && ipWithMask.split("/") || [];
                    interfaces.push({
                        name: name.replace(/:$/, ""), // Remove trailing colon
                        ip,
                        mask,
                        mac,
                        gateway: null, // Could fetch using `ip route` if needed
                        dns: [] // Could fetch using `/etc/resolv.conf` if needed
                    });
                }
            });

            if (!interfaces.length) {
                throw new Error("No network interfaces found");
            }

            return interfaces;
        },

        async rebootNode(node) {
            const command = "shutdown -r now"; // Reboots the node
            return this.execCommand(node.ip, command);
        },
    },

    created() {
        this.sshKey = null;
        this.connections = new Map();
    },

    async started() {
        this.sshKey = await this.readSSHKey();
    },

    async stopped() {
        this.sshKey = null;
        await this.closeAllConnections();
    }
}