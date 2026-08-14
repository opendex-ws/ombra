import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsonPath = path.join(root, '.svelte-kit/async-chunks.json');
const targets = [
	{
		file: path.join(root, '.svelte-kit/output/server/entries/hooks.server.js'),
		required: true
	},
	{
		file: path.join(root, '.svelte-kit/cloudflare/_worker.js'),
		required: false
	}
];

if (!fs.existsSync(jsonPath)) {
	console.warn('inject-async-chunks: no skip list at', jsonPath);
	process.exit(0);
}

const skip = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
if (!Array.isArray(skip) || skip.length === 0) {
	console.warn('inject-async-chunks: empty skip list');
	process.exit(0);
}

const next = `const ASYNC_CHUNK_FILES = /* @__PURE__ */ new Set(${JSON.stringify(skip)});`;
const re = /const ASYNC_CHUNK_FILES\s*=\s*(?:\/\* @__PURE__ \*\/\s*)?new Set\([\s\S]*?\);/;

let missingRequired = false;
for (const { file, required } of targets) {
	if (!fs.existsSync(file)) {
		if (required) {
			console.error('inject-async-chunks: missing', path.relative(root, file));
			missingRequired = true;
		}
		continue;
	}
	const code = fs.readFileSync(file, 'utf8');
	if (!re.test(code)) {
		if (required) {
			console.error('inject-async-chunks: pattern not found in', path.relative(root, file));
			missingRequired = true;
		}
		continue;
	}
	fs.writeFileSync(file, code.replace(re, next));
	console.log(`inject-async-chunks: patched ${path.relative(root, file)} (${skip.length} chunks)`);
}

if (missingRequired) process.exit(1);
