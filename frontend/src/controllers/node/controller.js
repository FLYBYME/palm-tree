import angular from 'angular';
import $ from 'jquery';

import NodeTemplate from './template.html';

class NodeController {
    static StateProvider($stateProvider) {
        $stateProvider
            .state('NodeController', {
                url: '/nodes/:id',
                views: {
                    main: {
                        controllerAs: '$ctrl',
                        template: NodeTemplate,
                        controller: NodeController
                    }
                }
            });
    }

    constructor($scope, api, $state) {
        this.$scope = $scope;
        this.api = api;
        this.$state = $state;
        this.nodeID = $state.params.id;
        this.node = {};
        this.editNode = {};
        this.lease = {};
        this.kernel = {};
        this.kernels = [];

        this.getNode();
    }

    getNode() {
        return this.api.get(`/v1/nodes/${this.nodeID}`)
            .then(node => {
                this.node = node;
                this.$scope.$apply();
                return Promise.all([this.getLease(), this.getKernel()]);
            });
    }

    getLease() {
        return this.api.get(`/v1/dhcp/lookup/${this.node.ip}`)
            .then(lease => {
                this.lease = lease;
                this.$scope.$apply();
            });
    }

    getKernel() {
        return this.api.get(`/v1/kernels/${this.node.kernel}`)
            .then(kernel => {
                this.kernel = kernel;
                this.$scope.$apply();
            });
    }

    getKernels() {
        return this.api.get('/v1/kernels')
            .then(kernels => {
                this.kernels = kernels.rows;
                this.$scope.$apply();
            });
    }

    showEditNode() {
        this.getKernels()
            .then(() => this.editNode = Object.assign({}, this.node))
            .then(() => this.$scope.$apply())
            .then(() => $('#editNodeModal').modal('show'));
    }

    updateNode() {
        this.api.patch(`/v1/nodes/${this.nodeID}`, {
            ip: this.editNode.ip,
            lease: this.editNode.lease,
            kernel: this.editNode.kernel
        })
            .then(() => $('#editNodeModal').modal('hide'))
            .then(() => this.getNode());
    }
}

NodeController.StateProvider.$inject = ['$stateProvider'];
NodeController.$inject = ['$scope', 'api', '$state'];

export default NodeController;

angular.module('app')
    .config(NodeController.StateProvider)
    .controller('NodeController', NodeController);