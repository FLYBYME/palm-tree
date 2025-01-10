

module.exports = {
    name: "node.actions.mixin",
    actions: {
        reboot: {
            rest: {
                method: "POST",
                path: "/:id/reboot",
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

                return ctx.call('v1.terminal.exec', { node: id, command: 'sudo reboot' })
                    .then(() => {
                        return this.updateEntity(ctx, {
                            id: node.id,
                            status: 'rebooting'
                        });
                    });
            }
        },
        listProcesses: {
            rest: {
                method: "GET",
                path: "/:id/processes",
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

                return ctx.call('v1.terminal.exec', { node: id, command: 'ps aux' });
            }
        },
    }
}