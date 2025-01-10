import angular from 'angular';
import $ from 'jquery';

import DhcpTemplate from './template.html';

class DhcpController {
    static StateProvider($stateProvider) {
        $stateProvider
            .state('DhcpController', {
                url: '/dhcp',
                views: {
                    main: {
                        controllerAs: '$ctrl',
                        template: DhcpTemplate,
                        controller: DhcpController
                    }
                }
            });
    }

    constructor($scope, api) {
        this.$scope = $scope;
        this.api = api;
        this.leases = [];

        Promise.all([this.getDhcp()]);
    }


    getDhcp() {
        return this.api.get('/v1/dhcp?pageSize=100&populate=node')
            .then(dhcp => {
                this.leases = dhcp.rows;
                this.$scope.$apply();
            });
    }

    showLeaseDetails(lease) {
        this.selectedLease = lease;
        $('#leaseDetailsModal').modal('show');
    }

    confirmDeleteLease(lease) {
        this.selectedLease = lease;
        $('#deleteLeaseModal').modal('show');
    }

    deleteLease(lease) {
        this.api.delete(`/v1/dhcp/${lease.id}`)
            .then(() => {
                this.getDhcp();
                $('#deleteLeaseModal').modal('hide');
            });
    }
}

DhcpController.StateProvider.$inject = ['$stateProvider'];
DhcpController.$inject = ['$scope', 'api'];

export default DhcpController;


angular.module('app')
    .config(DhcpController.StateProvider)
    .controller('DhcpController', DhcpController);