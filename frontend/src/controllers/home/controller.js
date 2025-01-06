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
        
    }
}

HomeController.StateProvider.$inject = ['$stateProvider'];
HomeController.$inject = ['$scope', 'api'];

export default HomeController;

console.log('home controller');

angular.module('app')
    .config(HomeController.StateProvider)
    .controller('HomeController', HomeController);