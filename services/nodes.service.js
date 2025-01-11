const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;

const fs = require('fs').promises;
const Moniker = require('moniker');
const crypto = require('crypto');

const NodeActionsMixin = require("../mixins/node.actions.mixin");

module.exports = {
    name: "nodes",
    version: 1,

    mixins: [
        DbService({
            adapter: {
                type: "NeDB",
                options: "./db/nodes.db"
            }
        }),
        NodeActionsMixin
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

            ip: {
                type: "string",
                required: true
            },

            lease: {
                type: "string",
                required: false,
                populate: {
                    action: "v1.dhcp.resolve"
                }
            },

            kernel: {
                type: "string",
                required: true,
                populate: {
                    action: "v1.kernels.resolve"
                }
            },

            password: { type: "string" },
            authorizedKeys: { type: "string" },

            stage: {
                type: "string",
                required: false,
                enum: [
                    "commissioning",
                    "commissioned",
                    "provisioning",
                    "provisioned"
                ],
                default: "commissioning"
            },

            status: {
                type: "string",
                required: false,
                enum: [
                    "rebooting",
                    "booting",
                    "running",
                    "pending",
                    "failed",
                    "unreachable",
                    "unknown"
                ],
                default: "unknown"
            },

            // core count
            cores: { type: "number", required: false, default: 1 },
            cpuModel: { type: "string", required: false },
            memory: { type: "number", required: false, default: 1024 },
            disks: {
                type: "array",
                items: {
                    type: "object",
                    required: true,
                    props: {
                        name: { type: "string", required: true },
                        size: { type: "number", required: true }
                    }
                },
                required: false,
                default: []
            },
            networkInterfaces: {
                type: "array",
                items: {
                    type: "object",
                    required: true,
                    props: {
                        name: { type: "string", required: true },
                        mac: { type: "string", required: true }
                    }
                },
                required: false,
                default: []
            },

            // options
            options: { type: "object", required: false, default: {} },
            controlNode: { type: "boolean", required: false, default: false },
            token: { type: "string", required: false },
            group: { type: "string", required: false },


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


        authorizedKeys: "/root/.ssh/authorized_keys",
    },

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
                return this.getNodeByIp(ctx, ctx.params.ip);
            }
        },

        register: {
            rest: {
                method: "POST",
                path: "/register",
            },
            params: {
                ip: { type: "string", optional: false },
                kernel: {
                    type: "string",
                    optional: true,
                    enum: [
                        "k3os",
                        "alpine"
                    ],
                    default: "alpine"
                }
            },
            async handler(ctx) {
                const { ip, kernel: kernelName } = ctx.params;

                const kernel = await ctx.call('v1.kernels.lookup', { name: kernelName });
                const authorizedKeys = await this.getAuthorizedKeys(ctx);

                const entity = {
                    ip,
                    password: crypto.randomBytes(16).toString('hex'),
                    kernel: kernel.id,
                    authorizedKeys
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

        setControlNode: {
            rest: {
                method: "POST",
                path: "/:id/set-control-node",
            },
            params: {
                id: { type: "string", optional: false },
                controlNode: { type: "boolean", optional: false }
            },
            async handler(ctx) {
                const { id, controlNode } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                return this.updateEntity(ctx, {
                    id: node.id,
                    controlNode
                });
            }
        },

        controlNode: {
            rest: {
                method: "GET",
                path: "/control-node",
            },
            params: {
                group: { type: "string", optional: true }
            },
            async handler(ctx) {
                const group = ctx.params.group;

                const query = {
                    controlNode: true
                };

                if (group) {
                    query.group = group;
                }

                return this.findEntity(ctx, {
                    query
                });
            }
        },

        setStage: {
            rest: {
                method: "POST",
                path: "/:id/set-stage",
            },
            params: {
                id: { type: "string", optional: false },
                stage: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id, stage } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                this.logger.info(`Node ${node.hostname} changed stage ${node.stage}->${stage}`);

                return this.updateEntity(ctx, {
                    id: node.id,
                    stage: stage
                });
            }
        },

        setStatus: {
            rest: {
                method: "POST",
                path: "/:id/set-status",
            },
            params: {
                id: { type: "string", optional: false },
                status: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id, status } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }
                this.logger.info(`Node ${node.hostname} changed status ${node.status}->${status}`);

                return this.updateEntity(ctx, {
                    id: node.id,
                    status
                });
            }
        },

        setLease: {
            rest: {
                method: "POST",
                path: "/:id/set-lease",
            },
            params: {
                id: { type: "string", optional: false },
                lease: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id, lease } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    lease
                });

                this.logger.info(`Node ${id} lease updated to ${lease} from ${node.lease}`);

                return updatedNode;
            }
        },

        setToken: {
            rest: {
                method: "POST",
                path: "/:id/set-token",
            },
            params: {
                id: { type: "string", optional: false },
                token: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id, token } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    token
                });

                this.logger.info(`Node ${id} token updated to ${token} from ${node.token}`);

                return updatedNode;
            }
        },

        getAuthorizedKeys: {
            rest: {
                method: "GET",
                path: "/authorized-keys",
            },
            params: {
                id: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                return node.authorizedKeys;
            }
        },


        setAuthorizedKeys: {
            rest: {
                method: "POST",
                path: "/authorized-keys",
            },
            params: {
                id: { type: "string", optional: false },
                authorizedKeys: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id, authorizedKeys } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                const updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    authorizedKeys
                });

                this.logger.info(`Node ${id} authorized keys updated to ${authorizedKeys} from ${node.authorizedKeys}`);

                return updatedNode;
            }
        },

        getSystemInfo: {
            rest: {
                method: "GET",
                path: "/:id/system-info",
            },
            params: {
                id: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                const cpuInfo = await ctx.call('v1.ssh.exec', {
                    node: node.id,
                    command: "cat /proc/cpuinfo"
                }).then(info => {
                    return this.parseCpuinfoToJson(info);
                });
                const memoryInfo = await ctx.call('v1.ssh.exec', {
                    node: node.id,
                    command: "cat /proc/meminfo"
                }).then(info => {
                    return this.parseMeminfoToJson(info);
                });
                const diskUsage = await ctx.call('v1.ssh.exec', {
                    node: node.id,
                    command: "lsblk --json"
                }).then(info => {
                    return this.parseLsblkToJson(JSON.parse(info));
                });
                const networkInfo = await ctx.call('v1.ssh.exec', {
                    node: node.id,// network devices
                    command: "ip link"
                }).then(info => {
                    return this.parseIpLinkToJson(info);
                });

                const update = {
                    id: node.id,
                    cores: cpuInfo.cores,
                    cpuModel: cpuInfo.model,
                    memory: memoryInfo.memTotal,
                    disks: diskUsage.disks,
                    networkInterfaces: networkInfo.networkInterfaces
                };

                return this.updateEntity(ctx, update);
            }
        },

        commission: {
            rest: {
                method: "POST",
                path: "/:id/commission",
            },
            params: {
                id: { type: "string", optional: false }
            },
            async handler(ctx) {
                const { id } = ctx.params;

                const node = await this.getNodeById(ctx, id);
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${id} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id }
                    );
                }

                // get system info
                let updatedNode = await ctx.call('v1.nodes.getSystemInfo', { id: node.id });

                updatedNode = await this.updateEntity(ctx, {
                    id: node.id,
                    stage: "commissioned",
                    options: {
                        installDisk: "/dev/" + updatedNode.disks.sort((a, b) => b.size - a.size)[0].name
                    }
                });


                return updatedNode;
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
                }
                return { message: `${count} nodes deleted.` };
            },
        },
    },

    events: {},

    methods: {
        async getNodeById(ctx, id) {
            return this.resolveEntities(ctx, { id });
        },
        async getNodeByIp(ctx, ip) {
            return this.findEntity(ctx, {
                query: {
                    ip
                }
            });
        },

        parseCpuinfoToJson(cpuInfo) {
            const entries = cpuInfo.split('\n\n'); // Each processor block is separated by a double newline
            const lines = entries[0].split('\n'); // Each line is separated by a newline

            const processor = {
                cores: entries.length - 1,
                model: '',
                cache: 0,
                frequency: ''
            };

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes('model name')) {
                    processor.model = line.split(':')[1].trim();
                } else if (line.includes('cache size')) {
                    processor.cache = line.split(':')[1].trim();
                } else if (line.includes('cpu MHz')) {
                    processor.frequency = line.split(':')[1].trim();
                }
            }

            return processor;
        },
        parseLsblkToJson(json) {

            const disks = [];
            for (const disk of json.blockdevices) {
                // filter ram disk
                if (disk.name.includes('ram') || disk.name.includes('loop') || disk.name.includes('boot')) {
                    continue;
                }


                // convert size to number 0B,14.8G,120M
                const byteType = disk.size.slice(-1);

                if (byteType === 'B') {
                    disk.size = disk.size.slice(0, -1);
                    disk.size = Number(disk.size);

                } else if (byteType === 'G') {
                    disk.size = disk.size.slice(0, -1);
                    disk.size = Number(disk.size) * 1024 * 1024 * 1024;

                } else if (byteType === 'M') {
                    disk.size = disk.size.slice(0, -1);
                    disk.size = Number(disk.size) * 1024 * 1024;
                }

                const diskInfo = {
                    name: disk.name,
                    size: disk.size,
                    type: disk.type
                };
                disks.push(diskInfo);
            }


            return { disks };
        },
        parseIpLinkToJson(input) {
            const interfaces = [];
            const lines = input.split("\n");

            let currentInterface = null;

            for (const line of lines) {
                if (/^\d+:\s/.test(line)) {
                    // Matches lines starting with an interface identifier, e.g., "1: lo:"
                    const match = line.match(/^(\d+):\s(\S+):\s<(.*?)>\smtu\s(\d+)\sqdisc\s(\S+)\sstate\s(\S+)(?:\smode\s(\S+))?/);
                    if (match) {
                        if (currentInterface) {
                            interfaces.push(currentInterface);
                        }
                        currentInterface = {
                            id: parseInt(match[1], 10),
                            name: match[2],
                            flags: match[3].split(","),
                            mtu: parseInt(match[4], 10),
                            qdisc: match[5],
                            state: match[6],
                            mode: match[7] || null,
                            details: {}
                        };
                    }
                } else if (/^\s+link\//.test(line)) {
                    // Matches lines with link details, e.g., "link/loopback"
                    const match = line.match(/^\s+link\/(\S+)\s([0-9a-f:]+)\sbrd\s([0-9a-f:]+)/);
                    if (match && currentInterface) {
                        currentInterface.details = {
                            type: match[1],
                            address: match[2],
                            broadcast: match[3]
                        };
                    }
                }
            }

            if (currentInterface) {
                interfaces.push(currentInterface);
            }

            return { networkInterfaces: interfaces.map(i => ({ name: i.name, mac: i.details.address })).filter(i => i.name !== 'lo') };
        },
        parseMeminfoToJson(input) {
            const lines = input.split("\n");// Each line is separated by a newline

            const result = {
                memTotal: 0
            };

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes('MemTotal')) {
                    result.memTotal = Number(line.split(':')[1].trim().split(' ')[0]);
                }
            }

            return result;
        },

        async getAuthorizedKeys(ctx) {
            const stats = await fs.stat(this.settings.authorizedKeys).catch(() => false);
            if (!stats) {
                return '';
            }

            return fs.readFile(this.settings.authorizedKeys, 'utf8');
        },

    },

    created() {

    },

    async started() {

    },

    async stopped() {
    }
}