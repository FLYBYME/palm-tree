import angular from "angular";
import $ from "jquery";

class NotificationsService {
    constructor() {
        this.notifications = [];
    }

    /**
     * 
     * @param {Object} notification 
     */
    addNotification(notification) {
        this.notifications.push(notification);
        const growlContainer = document.getElementById('growl-container');
        const alert = document.createElement('div');
        if (notification.type === 'error') {
            alert.classList.add('alert-danger');
        }
        else {
            alert.classList.add('alert-success');
        }
        alert.classList.add('alert');
        alert.classList.add('alert-dismissible');
        alert.classList.add('fade');
        alert.classList.add('show');
        alert.innerHTML = `<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>${notification.message}`;
        growlContainer.appendChild(alert);
        setTimeout(() => {
            $(alert).alert('close');
        }, 3000);
    }

    getNotifications() {
        return this.notifications;
    }

    clearNotifications() {
        this.notifications = [];
    }
}

angular.module("app").service("notifications", NotificationsService);

export default NotificationsService;