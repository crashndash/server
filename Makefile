test:
	npm test

test-cov:
	./node_modules/istanbul/lib/cli.js cover -- ./node_modules/mocha/bin/_mocha -R dot

.PHONY: test test-cov
