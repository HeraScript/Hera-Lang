const path = require('path');

const baseConfig = () => {
	return {
		devtool: false,
		output: {
			globalObject: '(typeof self !== "undefined" ? self : this)',
			libraryTarget: 'umd2',
			library: ['Hera', '[name]'],
			path: path.resolve(__dirname, 'dist'),
			filename: '[name]/index.min.js',
		},
		plugins: [],
		resolve: {
			extensions: ['.ts', '.js'],
		},
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					use: 'ts-loader',
					exclude: /node_modules/,
				},
			],
		},
	};
};

const makeConfig = (entry, filename, entryName) => {
	const config = {
		...baseConfig(),
		target: 'node',
		entry: entry,
		mode: 'production',
		optimization: {
			minimize: true,
		},
	};
	config.output.filename = filename;
	config.output.path = path.resolve(__dirname, 'lib/umd');
	config.output.library = entryName;
	return config;
};

module.exports = [makeConfig('./src/core.ts', 'core.min.js', 'Hera')];
