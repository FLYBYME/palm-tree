const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

module.exports = {
    //This property defines where the application starts
    entry: './src/index.js',

    //This property defines the file path and the file name which will be used for deploying the bundled file
    output: {
        path: path.join(__dirname, '/dist'),
        filename: 'bundle.js'
    },

    module: {
        rules: [
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader'
                ]
            }, {
                // HTML LOADER
                // Reference: https://github.com/webpack/raw-loader
                // Allow loading html through js
                test: /\.html$/,
                loader: 'raw-loader'
            }
        ]
    },
    // Setup plugin to use a HTML file for serving bundled js files
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html'
        }),
        new MonacoWebpackPlugin()
    ]
}