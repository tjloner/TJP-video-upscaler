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
                            allowTsInNodeModules: false
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
            template: 'src/index.html'
        }),
        new CleanWebpackPlugin({
            cleanStaleWebpackAssets: false
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: "src/*.js", to: path.basename('[name].js'), noErrorOnMissing: true },
                { from: "src/img/*.svg", to: path.basename('[name].svg'), noErrorOnMissing: true },
                { from: "src/img/*.png", to: path.basename('[name].png'), noErrorOnMissing: true },
                // Copy ONNX Runtime Web Wasm binaries for instant in-browser ML execution
                {
                    from: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/*.wasm'),
                    to: '[name][ext]'
                },
                // Copy any neural network models placed in src/models
                {
                    from: "src/models/**/*",
                    to: "models/[name][ext]",
                    noErrorOnMissing: true
                }
            ]
        })
    ],
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".css", ".wasm"],
        fallback: {
            "fs": false,
            "path": false,
            "crypto": false
        }
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