const ApiGateway = require("moleculer-web");

module.exports = {
    name: "api",
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
        assets: {
            // Root folder of assets
            folder: "./public",

            // Further options to `serve-static` module
            options: {}
        },
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
            {
                path: "/",

                whitelist: [
                    "**"
                ],

                // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares
                use: [],

                // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging
                mergeParams: true,

                // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
                authentication: false,

                // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
                authorization: false,

                // The auto-alias feature allows you to declare your route alias directly in your services.
                // The gateway will dynamically build the full routes from service schema.
                autoAliases: true,

                aliases: {

                },

                /**
                 * Before call hook. You can check the request.
                 * @param {Context} ctx
                 * @param {Object} route
                 * @param {IncomingRequest} req
                 * @param {ServerResponse} res
                 * @param {Object} data
                 *
                onBeforeCall(ctx, route, req, res) {
                    // Set request headers to context meta
                    ctx.meta.userAgent = req.headers["user-agent"];
                }, */

                /**
                 * After call hook. You can modify the data.
                 * @param {Context} ctx
                 * @param {Object} route
                 * @param {IncomingRequest} req
                 * @param {ServerResponse} res
                 * @param {Object} data
                onAfterCall(ctx, route, req, res, data) {
                    // Async function which return with Promise
                    return doSomething(ctx, res, data);
                }, */

                // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options
                callOptions: {},

                bodyParsers: {
                    json: {
                        strict: false,
                        limit: "1MB"
                    },
                    urlencoded: {
                        extended: true,
                        limit: "1MB"
                    }
				 },

				// Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy
				mappingPolicy: "all", // Available values: "all", "restrict"

				// Enable/disable logging
				logging: true
			}
		],

    },

    actions: {

    },

    methods: {

    },


    /**
     * Service created lifecycle event handler
     */
    created() {

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