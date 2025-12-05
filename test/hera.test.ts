import { compile } from '../src/core';

const builtin = `
postfix 1 ++ -> x++ => x++;
postfix 1 -- -> x-- => x--;
prefix 1 -- -> --x => --x;
prefix 1 ++ -> ++x => ++x;
prefix 1 - -> -x => -x;
prefix 1 + -> +x => +x;
infixl 1 : -> x:xs => [x, ...xs];
infixl 1 !! -> xs !! n => xs[n];
infixl 2 * -> x * y => x * y;
infixl 2 / -> x / y => x / y;
infixl 3 + -> x + y => x + y;
infixl 3 - -> x - y => x - y;
infixl 5 == -> x == y => x === y;
infixl 5 != -> x != y => x !== y;
infixl 5 < -> x < y => x < y;
infixl 5 > -> x > y => x > y;
infixl 14 := -> x := y => x = y;

`;

describe('hera', () => {
	it('should compile opf', () => {
		const compiled = compile(`${builtin}
val opf = (f, x) => f(x, 2);
opf((*), 3);`);
		expect(compiled.value).toBe(
			'const opf = ((f, x) => {\n  return f(x, 2);\n});\nopf((function(x, y) {\n  return x * y;\n}), 3);\n',
		);
	});

	it('should compile *', () => {
		const compiled = compile(`${builtin} (*);`);
		expect(compiled.value).toBe(`(function(x, y) {\n  return x * y;\n});\n`);
	});

	it('should compile add', () => {
		const compiled = compile(`${builtin}
function plus(x, y) {
	return x + y;
}

// Pass first param
val plus2 = plus(2);
plus2(3); // 2 + 3 = 5`);

		console.log(compiled.value);
	});
});
