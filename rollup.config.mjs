import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
	input: 'src/core.ts',
	output: {
		file: 'lib/umd/core.min.js',
		format: 'umd',
		name: 'Hera',
		sourcemap: false,
	},
	plugins: [
		nodeResolve(),
		commonjs(),
		typescript({
			tsconfig: './tsconfig.json',
			declaration: true,
			declarationDir: 'lib/umd',
		}),
		terser(),
	],
};

