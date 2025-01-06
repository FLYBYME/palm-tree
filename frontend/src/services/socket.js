import 'angular';
import { EventEmitter } from 'events';

class SocketService extends EventEmitter {
    constructor($rootScope) {
        super();

        this.$rootScope = $rootScope;

        this.socket = null;
        this.isOpen = false;

        this.openWebSocket();
    }

    openWebSocket() {
        this.socket = new WebSocket('ws://localhost:8082');

        this.socket.onmessage = (event) => {
            this.onMessage(event);
        };

        this.socket.onclose = (event) => {
            this.onClose(event);
        };

        this.socket.onopen = (event) => {
            this.onOpen(event);
        };
    }

    onMessage(event) {
        this.emit('message', JSON.parse(event.data));
        console.log('message received', event.data);
    }

    onClose(event) {
        // set timer to reconnect
        this.emit('close');
        this.isOpen = false;
        setTimeout(() => {
            this.openWebSocket();
        }, 1000);
        console.log('websocket closed');
    }

    onOpen(event) {
        this.isOpen = true;
        this.emit('open');
        console.log('websocket opened');
    }

}

angular
    .module('app')
    .service('socket', SocketService);