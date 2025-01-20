import angular from 'angular';
import events from 'events';
import $ from 'jquery';
import { v4 as uuid } from 'uuid';
import HomeTemplate from './template.html';

class HomeController {
    static StateProvider($stateProvider) {
        $stateProvider
            .state('HomeController', {
                url: '/',
                views: {
                    main: {
                        controllerAs: '$ctrl',
                        template: HomeTemplate,
                        controller: HomeController
                    }
                }
            });
    }

    constructor($scope, api) {
        this.$scope = $scope;
        this.api = api;
        this.nodeCount = 0;
        this.leaseCount = 0;
        this.kernelCount = 0;
        this.modalOptions = {
            title: 'Example Modal',
            items: [
                { title: 'Name', type: 'text', key: 'name', required: true },
                { title: 'Email', type: 'email', key: 'email', required: false },
                { title: 'Options', type: 'options', key: 'selection', options: [{ name: 'Option 1', value: '1' }, { name: 'Option 2', value: '2' }] }
            ]
        };
        this.modalForm = {};

        this.showModal = () => {
            console.log('controller show modal');
            this.modalForm = {};
            $scope.$broadcast('show-modal', { id: 'model' });
        };

        this.hideModal = () => {
            $scope.$broadcast('hide-modal', { id: 'model' });
        };

        this.handleSubmit = () => {
            console.log(this.modalForm);
        };


        Promise.all([this.getNodes(), this.getDhcp(), this.getKernels()]);
    }

    getNodes() {
        return this.api.get('/v1/nodes/count')
            .then(nodes => {
                this.nodeCount = nodes;
                this.$scope.$apply();
            });
    }

    getDhcp() {
        return this.api.get('/v1/dhcp/count')
            .then(dhcp => {
                this.leaseCount = dhcp;
                this.$scope.$apply();
            });
    }

    getKernels() {
        return this.api.get('/v1/kernels/count')
            .then(kernels => {
                this.kernelCount = kernels;
                this.$scope.$apply();
            })
    }
}

HomeController.StateProvider.$inject = ['$stateProvider'];
HomeController.$inject = ['$scope', 'api'];

export default HomeController;

console.log('home controller');

angular.module('app')
    .config(HomeController.StateProvider)
    .controller('HomeController', HomeController);