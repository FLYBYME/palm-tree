import angular from 'angular';
import $ from 'jquery';

import KernelsTemplate from './template.html';

class KernelsController {
    static StateProvider($stateProvider) {
        $stateProvider
            .state('KernelsController', {
                url: '/kernels',
                views: {
                    main: {
                        controllerAs: '$ctrl',
                        template: KernelsTemplate,
                        controller: KernelsController
                    }
                }
            });
    }

    constructor($scope, api) {
        this.$scope = $scope;
        this.api = api;
        this.kernels = [];
        this.formKernel = {};

        Promise.all([this.getKernels()]);
    }

    getKernels() {
        return this.api.get('/v1/kernels')
            .then(kernels => {
                this.kernels = kernels.rows;
                this.$scope.$apply();
            });
    }

    createKernel() {
        return this.api.post('/v1/kernels', this.formKernel)
            .then(response => {
                this.kernels.push(response.data);
                this.formKernel = {}; // Reset the new kernel object
                this.$scope.$apply();
            });
    }

    showCreateKernel() {
        $('#createKernelModal').modal('show');
    }

    updateKernel() {
        return this.api.patch(`/v1/kernels/${this.formKernel.id}`, this.formKernel)
            .then(() => {
                this.getKernels();
                $('#formKernelModal').modal('hide');
            });
    }

    showEditKernel(kernel) {
        this.formKernel = Object.assign({}, kernel);
        $('#formKernelModal').modal('show');
    }

    addKernelOption() {
        if (!this.formKernel.options) {
            this.formKernel.options = {};
        }
        this.formKernel.options[this.formKernel.optionsKey] = this.formKernel.optionsValue;
        this.formKernel.optionsKey = '';
        this.formKernel.optionsValue = '';
    }

    removeKernelOption(key) {
        delete this.formKernel.options[key];
    }

    deleteKernel() {
        return this.api.delete(`/v1/kernels/${this.deleteKernel.id}`)
            .then(() => this.getKernels())
            .then(() => $('#deleteKernelModal').modal('hide'));
    }

    showDeleteKernel(kernel) {
        this.deleteKernel = kernel;
        $('#deleteKernelModal').modal('show');
    }
}

KernelsController.StateProvider.$inject = ['$stateProvider'];
KernelsController.$inject = ['$scope', 'api'];

export default KernelsController;


angular.module('app')
    .config(KernelsController.StateProvider)
    .controller('KernelsController', KernelsController);