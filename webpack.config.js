/* Current Path */
const path = require('path')
/* HTML Template */
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
    /* Build Type */
    mode: 'development',
    /* Entry Point */
    entry: {
        main: path.resolve(__dirname, 'src/index.js')
    },
    /* Output Config */
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].[contenthash].js',
        clean: true,
        assetModuleFilename: '[name][ext]',
    },
    /* Source Map for Error Debug */
    devtool: 'source-map',
    /* Webpack Server Config */
    devServer: {
        static: {
           directory: path.resolve(__dirname, 'dist') 
        },
        port: 3000,
        open: false,
        hot: true,
        compress: true,
        historyApiFallback: true,
    },
    module: {
        rules: [
         /* Style Sheet Loader*/
         {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
        },
        {
            test: /\.glb$/,
            use:
            [
                {
                    loader: 'file-loader',
                    options:
                    {
                        outputPath: 'assets/resource/'
                    }
                }
            ]
        },
        ]
    },
    plugins: [
        /* Automated HTML Generation */
        new HtmlWebpackPlugin({
            favicon: "./src/favicon.ico",
            title: 'ROS2 GUI Wrapper',
            filename: 'index.html',
            template: "./src/template.html",
        }),
    ],
}
