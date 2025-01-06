import 'angular';
import 'angular-route';
import 'angular-ui-router';


angular.module("app", [
    // minimum required dependencies
    "ui.router",
]).config(function ($urlRouterProvider) {

    $urlRouterProvider.otherwise("/");
}).run(function ($rootScope, $location, $timeout, $state) {
    console.log(`Application started`);
});