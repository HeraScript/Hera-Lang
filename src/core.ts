import * as p from 'parse-combinator';
import Printer from './printer';

const identStart = p.oneOf('_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
const identLetter = p.oneOf('_$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
const opStart = p.oneOf('+-*/=!$%&^~@?_><:|\\.');
const opLetter = p.oneOf('+-*/=!$%&^~@?_><:|\\.');

const lexer = p.buildTokenParser({
	multiCommentStart: p.string('/*'),
	multiCommentEnd: p.string('*/'),
	singleCommentLine: p.string('//'),
	identifierStart: identStart,
	identifierLetter: identLetter,
	opStart: opStart,
	opLetter: opLetter,
	reservedNames: [
		'function',
		'return',
		'op',
		'infix',
		'infixl',
		'infixr',
		'prefix',
		'postfix',
		'val',
		'var',
		'if',
		'else',
		'for',
		'native',
		'->',
	],
	reservedOps: [],
	caseSensitive: true,
});

export class Op {
	public operators: p.OperatorTable<string>[] = [];
	public binaryOps: { [op: string]: (x: string, y: string) => string } = {};
	public unaryOps: { [op: string]: (x: string) => string } = {};

	constructor() {
		this.operators[0] = new p.OperatorTable();
	}
}

class Stack<T> {
	constructor(public stack: T[] = []) {}

	public push(x: T) {
		this.stack.push(x);
	}

	public pop(): T {
		return this.stack.pop()!;
	}

	get head(): T {
		return this.stack[0];
	}

	get last(): T {
		return this.stack[this.stack.length - 1];
	}

	get length(): number {
		return this.stack.length;
	}

	public peek(cursor: number): T {
		return this.stack[cursor];
	}
}

type ArgsTable = Map<string, number>;

class Scope {
	stack: Stack<ArgsTable> = new Stack();

	public currentCursor: number = -1;

	public argsTable: ArgsTable = this.stack.peek(0);

	public advance(step: number = 1) {
		const cursor = this.currentCursor + step;
		if (cursor + 1 > this.stack.length) {
			for (let k = 0; k < cursor + 1 - this.stack.length; k++) {
				this.stack.push(new Map<string, number>());
			}
		}
		this.argsTable = this.stack.peek(cursor);
		this.currentCursor = cursor;
	}

	public back(step: number) {
		const cursor = this.currentCursor - step;
		if (cursor >= 0) {
			this.argsTable = this.stack.peek(cursor);
			this.currentCursor = cursor;
		}
	}

	getArgsCount(name: string) {
		const argsTable = this.stack.peek(this.currentCursor + 1);
		return argsTable.get(name);
	}

	addArgsCount(name: string, count: number) {
		this.argsTable.set(name, count);
	}
}

export function compile(source: string) {
	const printer = new Printer();
	const opTable = new Op();

	opTable.operators[0].infix.push(
		lexer.lexeme(
			p.seq(s => {
				s(p.string('`'));
				const ops = s(identStart);
				const opl = s(p.many(identLetter));
				s(p.string('`'));
				return (x: string, y: string) => `(${ops}${opl.join('')}(${x}, ${y}))`;
			}),
		),
	);

	opTable.operators[0].infixr.push(
		lexer.lexeme(
			p.seq(s => {
				s(p.string('.'));
				return (f: string, q: string) => {
					const transaction = printer.transaction();
					transaction.append('(function() {\n');
					transaction.indent();
					transaction.queue(`return ${f}(${q}.apply(undefined, arguments));\n`);
					transaction.dedent();
					transaction.queue('})');
					return transaction.get();
				};
			}),
		),
	);

	let _expression: p.Parser<string>;
	const expression = p.lazy(() => {
		if (!_expression) {
			const operators = opTable.operators.filter(Boolean);
			_expression = p.buildExpressionParser<string>(operators, term);
		}
		return _expression;
	});

	/**
	 * Generate executable statement through parsing operators defined by user.
	 *
	 * @param identifiers
	 */
	function makeNativeExprParser(identifiers: string[]) {
		let initialCursor: number = 0;

		const nativeExprParser = p.many(
			p.seq(m => {
				m(p.notFollowedBy(lexer.semi));
				m(p.optional(lexer.stringLiteral));
				m(p.optional(lexer.charLiteral));
				const startCursor = m.state.position;
				const ident = m(p.optional(lexer.identifier));
				if (ident) {
					if (identifiers.indexOf(ident) > -1) {
						return {
							name: ident,
							cursor: [startCursor - initialCursor, startCursor - initialCursor + ident.length],
						};
					} else {
						m(p.unexpected(`identifier ${ident}`));
					}
				} else {
					m(p.notFollowedBy(lexer.semi));
					m(p.anyChar);
				}
			}),
		);

		const parser = p.seq(x => {
			initialCursor = x.state.position;
			const reply = p.parse(p.until(lexer.semi), new p.State(x.state.source.slice(x.state.position)));
			if (!reply.success || !reply.value) {
				x(p.fail('parsing error in nativeExpressionParser'));
				return;
			}

			const statement = reply.value;
			const cursorTable = x(nativeExprParser).filter(Boolean);

			function makeExpr(table: { [ident: string]: string }) {
				let stm = statement;
				// Recording the cursor offset while replacing statement.
				let offset = 0;
				for (let i = 0; i < cursorTable.length; i++) {
					const cursorItem = cursorTable[i];
					const ident = table[cursorItem.name];
					if (ident) {
						const head = stm.slice(0, cursorItem.cursor[0] + offset);
						const tail = stm.slice(cursorItem.cursor[1] + offset, stm.length);
						stm = head + ident + tail;
						offset += ident.length - (cursorItem.cursor[1] - cursorItem.cursor[0]);
					}
				}
				return stm;
			}
			return makeExpr;
		});

		return parser;
	}

	const term: p.Parser<string> = p.label(
		'term',
		p.seq(m => {
			const transaction = printer.transaction();

			const arrowFunctionArgs = p.or(
				p.fmap(x => [x], lexer.identifier),
				lexer.parens(p.sepBy(lexer.identifier, lexer.comma)),
			);
			const arrowFunctionBody = p.or(
				lexer.braces(
					p.seq(s => {
						transaction.indent();
						const sts = s(p.many(statement));
						transaction.dedent();
						return sts;
					}),
				),
				p.fmap(x => {
					printer.indent();
					const s = [printer.get('return '), x!, ';', '\n'];
					printer.dedent();
					return s;
				}, expression),
			);
			const arrowFunction = p.seq(m => {
				const args = m(arrowFunctionArgs);
				m(lexer.symbol('=>'));
				const body = m(arrowFunctionBody);
				if (m.success) {
					transaction.queue(`((${args.join(', ')}) => `);
					transaction.append('{\n');
					body.forEach(x => {
						transaction.queue(x);
					});
					transaction.queue('})');
					return transaction.get();
				}
			});

			const nativeDirective = p.seq(m => {
				m(lexer.reserved('native'));
				return printer.get(m(lexer.stringLiteral));
			});

			const functionalOperator = p.fmap(op => {
				const transaction = printer.transaction();
				if (opTable.binaryOps[op]) {
					transaction.append('(function(x, y) {\n');
					transaction.indent();
					transaction.queue(`return ${opTable.binaryOps[op]('x', 'y')};`);
					transaction.dedent();
					transaction.append('\n})');
					return transaction.get();
				} else if (opTable.unaryOps[op]) {
					transaction.append('(function(x) {\n');
					transaction.indent();
					transaction.queue(`return ${opTable.unaryOps[op]('x')};`);
					transaction.dedent();
					transaction.append('\n})');
					return transaction.get();
				} else {
					throw new Error('Unknown operator: ' + op);
				}
			}, lexer.parens(lexer.operator));

			const arrayLiteral = p.fmap(xs => `[${xs.join(', ')}]`, lexer.brackets(p.sepBy(expression, lexer.comma)));

			const rightSection = p.seq(m => {
				m(lexer.symbol('('));
				const op = m(lexer.operator);
				const expr = m(simpleExpressionParser);
				m(lexer.symbol(')'));
				if (opTable.binaryOps[op]) {
					const transaction = printer.transaction();
					transaction.queue('(function(x) {\n');
					transaction.indent();
					transaction.queue(`return ${opTable.binaryOps[op]('x', expr)}`);
					transaction.dedent();
					transaction.queue('\n})');
					return transaction.get();
				}
			});

			const leftSection = p.seq(m => {
				m(lexer.symbol('('));
				const expr = m(simpleExpressionParser);
				const op = m(lexer.operator);
				m(lexer.symbol(')'));
				if (opTable.binaryOps[op]) {
					const transaction = printer.transaction();
					transaction.queue('(function(x) {\n');
					transaction.indent();
					transaction.queue(`return ${opTable.binaryOps[op]('x', expr)}`);
					transaction.dedent();
					transaction.queue('\n})');
					return transaction.get();
				}
			});

			const simpleExpressionParser: p.Parser<string> = p.or(
				p.triable(functionalOperator),
				p.triable(arrowFunction),
				arrayLiteral,
				p.triable(rightSection),
				p.triable(leftSection),
				p.fmap(x => `(${x})`, lexer.parens(expression)),
				p.fmap(x => `"${x}"`, lexer.stringLiteral),
				p.fmap(x => x.toString(), lexer.naturalOrFloat),
				nativeDirective,
				lexer.identifier,
			);
			const simpleExpression = m(simpleExpressionParser);

			const functionApplication = p.fmap((args: string[]) => {
				const argCount = m._userState.scope.getArgsCount(simpleExpression);
				if (args.length < argCount) {
					args = args.concat(Array(argCount - args.length).fill(undefined));
				}
				if (args.every(x => !!x)) {
					return `${simpleExpression}(${args.join(', ')})`;
				} else {
					const params: string[] = [];
					const rest: string[] = [];
					for (let i = 0; i < args.length; i++) {
						if (args[i] === undefined) {
							// Auto-Increasing variable name
							const v = String.fromCharCode(97 + i).toString();
							rest.push(v);
							params.push(v);
						} else {
							params.push(args[i]);
						}
					}
					const transaction = printer.transaction();
					transaction.append('(function(f) {\n');
					transaction.indent();
					transaction.queue(`return function(${rest.join(', ')}) {\n`);
					transaction.indent();
					transaction.queue(`return f(${params.join(', ')})\n`);
					transaction.dedent();
					transaction.queue('}\n');
					transaction.dedent();
					transaction.queue('}');
					transaction.append(`(${simpleExpression}))`);
					return transaction.get();
				}
			}, lexer.parens(p.sepBy(p.option(expression, undefined), lexer.comma)));

			return m(p.option(functionApplication, simpleExpression));
		}),
	);

	const operatorStatement = p.seq(m => {
		const type = m(p.choice(['infixl', 'infixr', 'infix', 'prefix', 'postfix'].map(lexer.reserved)));
		const priority = m(lexer.natural);
		const op = m(lexer.operator);

		m(lexer.reserved('->'));

		function addOperator(unary?: (x: string) => string, binary?: (x: string, y: string) => string) {
			opTable.operators[priority] = opTable.operators[priority] || new p.OperatorTable();
			const table = opTable.operators[priority];
			if (type === 'infixl') {
				table.infixl.push(p.fmap(_ => binary!, lexer.reservedOp(op)));
				opTable.binaryOps[op] = binary!;
			} else if (type === 'infixr') {
				table.infixr.push(p.fmap(_ => binary!, lexer.reservedOp(op)));
				opTable.binaryOps[op] = binary!;
			} else if (type === 'infix') {
				table.infix.push(p.fmap(_ => binary!, lexer.reservedOp(op)));
				opTable.binaryOps[op] = binary!;
			} else if (type === 'prefix') {
				table.prefix.push(p.fmap(_ => unary!, lexer.reservedOp(op)));
				opTable.unaryOps[op] = unary!;
			} else if (type === 'postfix') {
				table.postfix.push(p.fmap(_ => unary!, lexer.reservedOp(op)));
				opTable.unaryOps[op] = unary!;
			}
		}

		const aliasParser = p.seq(s => {
			const f = s(lexer.identifier);
			s(p.lookAhead(lexer.semi));
			if (s.success) {
				addOperator((x: string) => `${f}(${x})`, (x: string, y: string) => `${f}(${x}, ${y})`);
			}
		});

		switch (type) {
			case 'infixl':
			case 'infxr':
			case 'infix':
				m(
					p.or(
						aliasParser,
						p.seq(s => {
							const left = s(lexer.identifier);
							s(lexer.symbol(op));
							const right = s(lexer.identifier);
							s(lexer.symbol('=>'));
							const makeExpr = s(makeNativeExprParser([left, right]));
							if (s.success) {
								addOperator(
									(x: string) => makeExpr({ [left]: x }),
									(x: string, y: string) => makeExpr({ [left]: x, [right]: y }),
								);
							}
						}),
					),
				);
				break;
			case 'prefix':
				m(
					p.or(
						aliasParser,
						p.seq(s => {
							s(lexer.symbol(op));
							const t = s(lexer.identifier);
							s(lexer.symbol('=>'));
							const makeExpr = s(makeNativeExprParser([t]));
							if (s.success) {
								addOperator((x: string) => makeExpr({ [t]: x }));
							}
						}),
					),
				);
				break;
			case 'postfix':
				m(
					p.or(
						aliasParser,
						p.seq(s => {
							const t = s(lexer.identifier);
							s(lexer.symbol(op));
							s(lexer.symbol('=>'));
							const makeExpr = s(makeNativeExprParser([t]));
							if (s.success) {
								addOperator((x: string) => makeExpr({ [t]: x }));
							}
						}),
					),
				);
				break;
		}

		m(lexer.semi);
		return '';
	});

	const functionStatement = makeScopeParser(
		p.seq(m => {
			const transaction = printer.transaction();

			m(lexer.reserved('function'));
			const name: string = m(lexer.identifier);
			const args: string[] = m(lexer.parens(p.sepBy(lexer.identifier, lexer.comma)));

			if (m.success) {
				m._userState.scope.addArgsCount(name, args.length);
				transaction.queue(`function ${name}(${args.join(', ')}) {\n`);
				transaction.indent();
			}

			const body: string[] = m(lexer.braces(p.many(statement)));
			if (m.success) {
				body.forEach(t => {
					transaction.append(t);
				});
				transaction.dedent();
				transaction.queue(`}\n`);
				return transaction.get();
			}
		}),
	);

	const expressionStatement = p.fmap(expr => expr + ';\n', p.head(expression, lexer.semi));

	const valExpression = p.seq(m => {
		const def = m(p.or(lexer.reserved('val'), lexer.reserved('var')));
		const name = m(lexer.identifier);
		m(lexer.symbol('='));
		const expr = m(expression);
		return `${def === 'val' ? 'const' : 'var'} ${name} = ${expr}`;
	});

	const valStatement = p.seq(m => {
		const expr = m(valExpression);
		m(lexer.semi);
		return printer.get(expr + ';\n');
	});

	const ifStatement = p.seq(m => {
		m(lexer.reserved('if'));
		const condition = m(lexer.parens(expression));
		const thenClause = m(blockStatement);
		const elseClause: string = m(
			p.option(
				p.seq(x => {
					x(lexer.reserved('else'));
					return ' else ' + x(p.or(blockStatement, ifStatement));
				}),
				'',
			),
		);
		return printer.get(`if(${condition}) ` + thenClause + elseClause + '\n');
	});

	const forStatement = p.seq(m => {
		m(lexer.reserved('for'));
		const head = m(
			lexer.parens(
				p.seq(s => {
					const init = s(p.option(p.or(valExpression, expression), ''));
					s(lexer.semi);
					const condition = s(expression);
					s(lexer.semi);
					const next = s(expression);
					return `(${init}; ${condition}; ${next}) `;
				}),
			),
		);
		const body = m(blockStatement);
		return printer.get('for' + head + body + '\n');
	});

	const returnStatement = p.fmap(
		expr => printer.get(`return ${expr};\n`),
		p.between(lexer.reserved('return'), expression, lexer.semi),
	);

	/**
	 * Enhance parser with scope
	 *
	 * Push scope when parsing start.
	 * Pop scope when parsing end.
	 *
	 * @param parser
	 */
	function makeScopeParser<T>(parser: p.Parser<T>) {
		return p.seq(m => {
			m._userState.scope.advance(1);
			const sts = m(parser);
			m._userState.scope.back(1);
			return sts;
		});
	}

	const statement: p.Parser<string> = p.or(
		functionStatement,
		returnStatement,
		ifStatement,
		forStatement,
		valStatement,
		expressionStatement,
	);

	const blockStatement = makeScopeParser(
		p.or(
			p.fmap(
				xs => {
					const transaction = printer.transaction();
					transaction.append('{\n');
					transaction.append(xs.join(''));
					transaction.queue('}');
					return transaction.get();
				},
				lexer.braces(
					p.seq(s => {
						printer.indent();
						const sts = s(p.many(statement));
						printer.dedent();
						return sts;
					}),
				),
			),
			expression,
		),
	);

	const topLevelStatements = p.or(
		operatorStatement,
		functionStatement,
		ifStatement,
		forStatement,
		valStatement,
		expressionStatement,
	);

	const script = makeScopeParser(
		p.between(lexer.whiteSpaceOrComment, p.fmap(xs => xs!.join(''), p.many(topLevelStatements)), p.eof),
	);

	return p.parse(script, new p.State(source, 0, { scope: new Scope() }));
}
