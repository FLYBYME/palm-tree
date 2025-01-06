"use strict";

const ApiGateway = require("moleculer-web");
const { UnAuthorizedError } = ApiGateway.Errors;


module.exports = {
	name: "api",
	version: 1,
	mixins: [
		ApiGateway
	],

	metadata: {},

	// More info about settings: https://moleculer.services/docs/0.13/moleculer-web.html
	settings: {
		port: 4000,
		ip: '0.0.0.0',
		log4XXResponses: true,
		logRequestParams: "debug",
		// Logging the response data. Set to any log level to enable it. E.g. "info"
		logResponseData: "debug",
		debounceTime: 5000,
		use: [

		],

		cors: {
			// Configures the Access-Control-Allow-Origin CORS header.
			origin: "*",
			// Configures the Access-Control-Allow-Methods CORS header. 
			methods: '*',
			// Configures the Access-Control-Allow-Headers CORS header.
			allowedHeaders: '*',
			// Configures the Access-Control-Expose-Headers CORS header.
			//exposedHeaders: '*',
			// Configures the Access-Control-Allow-Credentials CORS header.
			credentials: false,
			// Configures the Access-Control-Max-Age CORS header.
			maxAge: 3600
		},
		routes: [
			/**
			 * API routes
			 */
			{
				path: "/api",

				whitelist: [
					"**"
				],


				etag: true,

				camelCaseNames: true,

				authentication: false,
				//authorization: true,

				autoAliases: true,
				mergeParams: true,

				aliases: {},

				// Use bodyparser modules
				bodyParsers: {
					json: { limit: "2MB" },
					urlencoded: { extended: true, limit: "2MB" }
				}
			}
		],

		config: {
            
		},
		onError(req, res, err) {
			console.log(err)
            res.setHeader("Content-Type", "text/plain");
            res.writeHead(501);
            res.end("Global error: " + err.message);
        }

	},

	actions: {

	},

	methods: {
		
	},


	/**
	 * Service created lifecycle event handler
	 */
	created() {
		this.authCache = new Map();
	},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {

	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {

	}
};
