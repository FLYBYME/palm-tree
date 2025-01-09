import angular from 'angular';

import NodesTemplate from './template.html';

class NodesController {
    static StateProvider($stateProvider) {
        $stateProvider
            .state('NodesController', {
                url: '/nodes',
                views: {
                    main: {
                        controllerAs: '$ctrl',
                        template: NodesTemplate,
                        controller: NodesController
                    }
                }
            });
    }

    constructor($scope, api) {
        this.$scope = $scope;
        this.api = api;
        this.nodes = [];

        this.getNodes();
        this.watch();
    }

    watch() {
        const watch = () => {
            this.getNodes();
        };
        const timer = setInterval(watch, 5000);
        this.$scope.$on('$destroy', () => clearInterval(timer));
    }

    getNodes() {
        return this.api.get('/v1/nodes')
            .then(nodes => {
                this.nodes = nodes.rows;
                this.$scope.$apply();
            });
    }
}

NodesController.StateProvider.$inject = ['$stateProvider'];
NodesController.$inject = ['$scope', 'api'];

export default NodesController;

angular.module('app')
    .config(NodesController.StateProvider)
    .controller('NodesController', NodesController);