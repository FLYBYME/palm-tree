import angular from 'angular';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';

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

        this.terminal = null;
        this.socket = null;
        this.destroyed = false;

        this.nodeID = $state.params.id;
        this.node = {}

        $scope.$on('$destroy', () => {
            this.destroyed = true;
            if (this.socket) {
                this.socket.close();
            }
        });
        this.connect();
        this.openTerminal();
        this.getNode();
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
            if (!this.terminal) {
                return;
            }
            this.terminal.write(event.data);
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

    openTerminal() {
        const term = new Terminal({ cols: 80, rows: 24 });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(document.getElementById('terminal'));
        fitAddon.fit();

        term.onData((data) => {
            if (this.socket) {
                this.socket.send(data);
            }
        });

        this.terminal = term;
    }

    getNode() {
        return this.api.get(`/v1/nodes/${this.nodeID}`)
            .then((node) => {
                this.node = node;
                this.$scope.$apply();
            });
    }

}

TerminalController.StateProvider.$inject = ['$stateProvider'];
TerminalController.$inject = ['$scope', '$state', 'api'];

export default TerminalController;

angular.module('app')
    .config(TerminalController.StateProvider)
    .controller('TerminalController', TerminalController);