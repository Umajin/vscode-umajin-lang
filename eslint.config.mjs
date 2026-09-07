import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

export default [
	{
		ignores: ['dist/**', 'node_modules/**', 'out/**', 'src/**/*.d.ts']
	},
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: typescriptParser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module'
			}
		},
		plugins: {
			'@typescript-eslint': typescriptEslint
		},
		rules: {
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'enumMember',
					format: ['PascalCase']
				}
			],
			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
			semi: 'off'
		}
	}
];
