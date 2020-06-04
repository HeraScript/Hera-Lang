interface Options {
	indent: string;
}

/**
 * Lodash.repeat
 * @param string
 * @param n
 */
function repeat(string: string, n: number) {
	let result: string = '';
	if (!string || n < 1 || n > Number.MAX_SAFE_INTEGER) {
		return result;
	}
	do {
		if (n % 2) {
			result += string;
		}
		n = Math.floor(n / 2);
		if (n) {
			string += string;
		}
	} while (n);

	return result;
}

interface Transaction {
	queue(str: string): void;
	append(str: string): void;
	rollback(): void;
	get(): string;
	indent(): void;
	dedent(): void;
}

export default class Printer {
	private _last: string = '';

	private _options: Options;

	private _indent: number = 0;

	constructor(options?: Options) {
		this._options = options || {
			indent: '  ',
		};
	}

	public indent(): void {
		this._indent++;
	}

	public dedent(): void {
		this._indent--;
	}

	private _getIndent(): string {
		return repeat(this._options.indent, this._indent);
	}

	get(str: string): string {
		const s = this._getIndent() + str;
		if (s.indexOf('undefined') === -1) {
			this._last = s;
		}
		return s;
	}

	public transaction(): Transaction {
		let _buf: string[] = [];
		return {
			queue: (str: string) => {
				_buf.push(this._getIndent());
				_buf.push(str);
				if (str.indexOf('undefined') === -1) {
					this._last = str;
				}
			},
			append: (str: string) => {
				_buf.push(str);
				if (str.indexOf('undefined') === -1) {
					this._last = str;
				}
			},
			get: () => {
				return _buf.join('');
			},
			rollback: () => {
				_buf = [];
			},
			indent: () => this.indent(),
			dedent: () => this.dedent(),
		};
	}
}
