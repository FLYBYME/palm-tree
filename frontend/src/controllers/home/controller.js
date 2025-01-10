import angular from 'angular';

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