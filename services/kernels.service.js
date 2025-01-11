const DbService = require("@moleculer/database").Service;
const { MoleculerClientError } = require("moleculer").Errors;
const Context = require("moleculer").Context;

const ConfigMixin = require("../mixins/config.mixin");
/**
 * Netboot Kernel Service
 */

module.exports = {
    name: "kernels",
    version: 1,

    mixins: [
        DbService({
            adapter: {
                type: "NeDB",
                options: "./db/kernels.db"
            }
        }),
        ConfigMixin
    ],

    settings: {
        fields: {

            name: { type: "string", required: true },
            version: { type: "string", required: true },
            arch: {
                type: "string",
                enum: [
                    "x86_64",
                    "aarch64"
                ],
                required: true
            },

            // vmlinuz, initramfs, modloop, repo, archive
            vmlinuz: { type: "string", required: true },
            initramfs: { type: "string", required: true },
            rootfs: { type: "string", required: false },
            modloop: { type: "string", required: false },
            iso: { type: "string", required: false },
            repo: { type: "string", required: false },
            archive: { type: "string", required: false },
            apkovl: { type: "string", required: false },// 

            cmdline: { type: "string", required: false },

            options: {
                type: "object",
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

        kernelTypes: {
            alpine: {
                name: "alpine",
                version: "3.14.0",
                arch: "x86_64",
                cmdline: "console=tty0 modules=loop,squashfs quiet nomodeset",
                vmlinuz: "alpine/netboot/3.14.0/vmlinuz-lts",
                initramfs: "alpine/netboot/3.14.0/initramfs-lts",
                modloop: "alpine/netboot/3.14.0/modloop-lts",
                repo: "alpine/v3.14/main/",
                archive: "http://dl-cdn.alpinelinux.org",
                apkovl: "alpine/netboot/3.14.0/apkovl-lts.apkovl.tar.gz"
            },
            k3os: {
                name: "k3os",
                version: "v0.21.5-k3s2r1",
                arch: "x86_64",
                cmdline: "printk.devkmsg=on console=ttyS0 console=tty1 initrd=initrd.magic",
                vmlinuz: "k3os/v0.21.5-k3s2r1/k3os-vmlinuz-amd64",
                initramfs: "k3os/v0.21.5-k3s2r1/k3os-initramfs-amd64",
                k3os: {
                    silent: true,
                    poweroff: false,
                    mode: "install",
                    config_url: "k3os/config",
                    iso_url: "k3os/v0.21.5-k3s2r1/k3os-amd64.iso"
                }
            },
        },

        config: {
            'kernels.debug': true
        }
    },

    actions: {
        lookup: {
            rest: {
                method: "GET",
                path: "/lookup/:name"
            },
            params: {
                name: { type: "string", optional: false }
            },
            async handler(ctx) {
                return this.findEntity(ctx, {
                    query: {
                        name: ctx.params.name
                    }
                });
            }
        },
        generateBootFile: {
            rest: {
                method: "GET",
                path: "/generateBootFile/:node/:kernel"
            },
            params: {
                node: { type: "string", optional: false },
                kernel: { type: "string", optional: false }
            },
            async handler(ctx) {

                const node = await ctx.call('v1.nodes.resolve', { id: ctx.params.node });
                if (!node) {
                    throw new MoleculerClientError(
                        `Node with id ${ctx.params.node} not found`,
                        404,
                        "NODE_NOT_FOUND",
                        { id: ctx.params.node }
                    );
                }

                const kernel = await this.getKernelById(ctx, ctx.params.kernel);
                if (!kernel) {
                    throw new MoleculerClientError(
                        `Kernel with id ${ctx.params.kernel} not found`,
                        404,
                        "KERNEL_NOT_FOUND",
                        { id: ctx.params.kernel }
                    );
                }

                const bootFile = await this.generateBootFile(ctx, node, kernel);
                return bootFile;
            }
        }
    },

    events: {},

    methods: {
        async generateBootFile(ctx, node, kernel) {
            const bootFile = [];

            bootFile.push(`#!ipxe`);

            bootFile.push('echo next-server is ${next-server}');
            bootFile.push('echo filaneme is ${filename}');
            bootFile.push('echo MAC address is ${net0/mac}');
            bootFile.push('echo IP address is ${ip}');

            bootFile.push('set vmlinuz http://${next-server}/' + kernel.vmlinuz);
            bootFile.push('echo vmlinuz is ${vmlinuz}');
            bootFile.push('set initramfs http://${next-server}/' + kernel.initramfs);
            bootFile.push('echo initramfs is ${initramfs}');

            const debug = this.config.get('kernels.debug');
            if (debug) {
                bootFile.push('ifstat');
                bootFile.push('route');
                bootFile.push('ipstat');
                bootFile.push('sleep 10');
            }

            const kernelCMD = [
                '${vmlinuz}',
            ];

            if (kernel.cmdline) {
                bootFile.push(`set cmdline ${kernel.cmdline}`);
                bootFile.push('echo cmdline is ${cmdline}');
                kernelCMD.push(kernel.cmdline);
            }

            if (kernel.modloop) {
                bootFile.push('set modloop http://${next-server}/' + kernel.modloop);
                bootFile.push('echo modloop is ${modloop}');
                kernelCMD.push('modloop=${modloop}');
            }

            if (kernel.name == 'alpine') {
                bootFile.push('set repo http://${next-server}/' + kernel.repo);
                bootFile.push('echo repo is ${repo}');
                kernelCMD.push('alpine_repo=${repo}');
                if (kernel.apkovl) {
                    bootFile.push('set apkovl http://${next-server}/' + kernel.apkovl);
                    bootFile.push('echo apkovl is ${apkovl}');
                    kernelCMD.push('apkovl=${apkovl}');
                }

                bootFile.push('set ssh_keys http://${next-server}/ssh_keys');
                bootFile.push('echo ssh_keys is ${ssh_keys}');
                kernelCMD.push('ssh_keys=${ssh_keys}');

            } else if (kernel.name == 'k3os') {
                const installParams = [];
                const lease = await ctx.call('v1.dhcp.lookup', { ip: node.ip });

                bootFile.push('imgfree');

                installParams.push(`k3os.mode=${kernel.options.mode}`);
                installParams.push(`k3os.install.debug=true`);
                installParams.push(`k3os.install.silent=${kernel.options.silent}`);
                installParams.push(`k3os.install.power_off=${kernel.options.poweroff}`);
                installParams.push(`k3os.install.config_url=http://${lease.nextServer}${kernel.options.config_url}`);
                installParams.push(`k3os.install.device=${node.options.installDisk}`);
                installParams.push(`k3os.install.iso_url=http://${lease.nextServer}/${kernel.iso}`);

                kernelCMD.push(installParams.join(' '));
            } else if (kernel.name == 'coreos') {
                const installParams = [];
                const lease = await ctx.call('v1.dhcp.lookup', { ip: node.ip });

                installParams.push(`coreos.live.rootfs_url=http://${lease.nextServer}/${kernel.rootfs}`);
                installParams.push(`ignition.firstboot`);
                installParams.push(`ignition.platform.id=metal`);
                installParams.push(`ignition.config.url=http://${lease.nextServer}${kernel.options.config_url}`);

                kernelCMD.push(installParams.join(' '));
            }

            bootFile.push(`kernel ${kernelCMD.join(' ')}`);
            bootFile.push('initrd ${initramfs}');

            bootFile.push('boot');

            return bootFile.join('\n');
        },

        async loadKernels() {
            const ctx = new Context(this.broker);
            const foundKernels = await this.findEntity(ctx, {
                query: {
                }
            });

            if (!foundKernels) {
                const names = Object.keys(this.settings.kernelTypes);
                for (const name of names) {
                    const kernel = this.settings.kernelTypes[name];
                    await this.createEntity(ctx, kernel);
                }

                this.logger.info(`Created ${names.length} kernels`);
            }

        },

        async getKernelById(ctx, id) {
            const found = await this.resolveEntities(ctx, { id });
            return found;
        }
    },

    created() {

    },

    async started() {
        await this.loadKernels();
    },

    async stopped() {

    }
}