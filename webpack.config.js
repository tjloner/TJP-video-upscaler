const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: "./src/index.ts",
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: "main.js",
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
        new HtmlWebpackPlugin({
            template: 'src/index.html',
            minify: false // Disables html-minifier-terser so it doesn't crash on Alpine attributes
        }),
        new CleanWebpackPlugin({
            cleanStaleWebpackAssets: false
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: "src/*.js", to: path.basename('[name].js'), noErrorOnMissing: true },
                { from: "src/img/*.svg", to: path.basename('[name].svg'), noErrorOnMissing: true },
                { from: "src/img/*.png", to: path.basename('[name].png'), noErrorOnMissing: true },
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
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 8080,
        allowedHosts: "all",
    },
    mode: 'production'
};