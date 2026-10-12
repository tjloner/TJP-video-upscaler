const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: "./src/index.ts",
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: "main.js",
        publicPath: "./",
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.(ts|js)$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: "babel-loader"
                    },
                    {
                        loader: "ts-loader",
                        options: {
                            allowTsInNodeModules: false,
                            transpileOnly: true
                        }
                    }
                ],
            },
            {
                test: /\.css$/i,
                use: ["style-loader", "css-loader", "postcss-loader"],
            },
            {
                test: /\.(wasm|onnx)$/,
                type: 'asset/resource',
            }
        ],
    },
    plugins: [
        new CleanWebpackPlugin({
            cleanStaleWebpackAssets: false
        }),
        new HtmlWebpackPlugin({
            template: 'src/index.html',
            filename: 'index.html',
            inject: 'body',
            minify: false
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: "src/img/*.svg", to: "img/[name][ext]", noErrorOnMissing: true },
                { from: "src/img/*.png", to: "img/[name][ext]", noErrorOnMissing: true },
            ]
        })
    ],
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".css", ".wasm"],
        fallback: {
            "fs": false,
            "path": false,
            "crypto": false,
            "stream": false,
            "buffer": false
        }
    },
    performance: {
        hints: false
    },
    experiments: {
        asyncWebAssembly: true
    },
    mode: 'production'
};