import 'angular';

class APIService {
    constructor($http) {
        this.$http = $http;
        this.baseUrl = 'http://192.168.1.143:4000/api';
    }


    async get(url) {
        const response = await this.$http.get(`${this.baseUrl}${url}`);
        return response.data;
    }

    async post(url, data) {
        const response = await this.$http.post(`${this.baseUrl}${url}`, data);
        return response.data;
    }

    async put(url, data) {
        const response = await this.$http.put(`${this.baseUrl}${url}`, data);
        return response.data;
    }
    async patch(url, data) {
        const response = await this.$http.patch(`${this.baseUrl}${url}`, data);
        return response.data;
    }

    async delete(url) {
        const response = await this.$http.delete(`${this.baseUrl}${url}`);
        return response.data;
    }
}

angular
    .module('app')
    .service('api', APIService);