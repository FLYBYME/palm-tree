import angular from 'angular';

import DownloaderTemplate from './template.html';

class DownloaderController {
    static StateProvider($stateProvider) {
        $stateProvider
            .state('DownloaderController', {
                url: '/downloader',
                views: {
                    main: {
                        controllerAs: '$ctrl',
                        template: DownloaderTemplate,
                        controller: DownloaderController
                    }
                }
            });
    }

    constructor($scope, api) {
        this.$scope = $scope;
        this.api = api;
        this.kernels = [];
        this.kernel = null;
        this.path = '';
        this.url = '';
        this.getKernels();
    }

    getKernels() {
        return this.api.get('/v1/kernels')
            .then(kernels => {
                this.kernels = kernels.rows;
                this.$scope.$apply();
            });
    }

    download() {
        return this.api.post(`/v1/http/downloader`, {
            kernel: this.kernel,
            path: this.path,
            url: this.url
        })
            .then(response => {
                this.$scope.$apply();
            });
    }

}

DownloaderController.StateProvider.$inject = ['$stateProvider'];
DownloaderController.$inject = ['$scope', 'api'];

export default DownloaderController;

angular.module('app')
    .config(DownloaderController.StateProvider)
    .controller('DownloaderController', DownloaderController);