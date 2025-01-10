import angular from 'angular';

import TerminalTemplate from './template.html';

class TerminalController {
    static StateProvider($stateProvider) {
        $stateProvider
            .state('TerminalController', {
                url: '/terminal/:id',
                views: {
                    main: {
                        controllerAs: '$ctrl',
                        template: TerminalTemplate,
                        controller: TerminalController
                    }
                }
            });
    }

    constructor($scope, $state, api) {
        this.$scope = $scope;
        this.$state = $state;
        this.api = api;

        this.terminal = {};
        this.socket = null;
        this.destroyed = false;

        this.nodeID = $state.params.id;


        $scope.$on('$destroy', () => {
            this.destroyed = true;
            if (this.socket) {
                this.socket.close();
            }
        });
        this.connect();
    }

    connect() {

        if (this.socket) {
            this.socket.close();
        }

        if (this.destroyed) {
            return;
        }

        this.socket = new WebSocket(`ws://192.168.1.143:8082/node/${this.nodeID}`);

        this.socket.onmessage = (event) => {
            console.log(event.data);
        };

        this.socket.onclose = (event) => {
            console.log('websocket closed');
            if (!this.destroyed) {
                setTimeout(() => {
                    this.connect();
                }, 1000);
            }
        };

        this.socket.onopen = (event) => {
            console.log('websocket opened');
        };
    }

}

TerminalController.StateProvider.$inject = ['$stateProvider'];
TerminalController.$inject = ['$scope', '$state', 'api'];

export default TerminalController;

angular.module('app')
    .config(TerminalController.StateProvider)
    .controller('TerminalController', TerminalController);