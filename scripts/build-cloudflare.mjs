import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';

// The Workers runtime disallows eval. These equivalent matchers avoid code generation
// for Fastify's static paths and named parameters. The normal Node build is unaffected.
const staticRouter = {
  name: 'static-fastify-router',
  setup(builder) {
    builder.onLoad(
      { filter: /find-my-way\/lib\/(node|handler-storage)\.js$/ },
      async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const isNode = path.endsWith('/node.js');
        const start = isNode
          ? 'function compilePrefixMatch (prefix) {'
          : '  _compileCreateParamsObject (params) {';
        const end = isNode ? '// Every node kind' : '  _getHandlerMatchingConstraints () {';
        const from = source.indexOf(start);
        const to = source.indexOf(end, from);
        if (from < 0 || to < 0 || !source.slice(from, to).includes('new Function')) {
          throw new Error(
            'The Fastify router changed. Recheck Worker runtime compatibility before building.',
          );
        }
        const replacement = isNode
          ? `function compilePrefixMatch (prefix) {
  return (path, index) => path.startsWith(prefix, index)
}

`
          : `  _compileCreateParamsObject (names) {
    return (param0, param1, param2, param3, extraParams) => {
      const values = [param0, param1, param2, param3];
      const params = new NullObject();
      for (let i = 0; i < names.length; i++) {
        params[names[i]] = i < 4 ? values[i] : extraParams[i - 4];
      }
      return params;
    };
  }

`;
        let contents = source.slice(0, from) + replacement + source.slice(to);
        if (!isNode) {
          const start = contents.indexOf('  _compileGetHandlerMatchingConstraints (constrainer) {');
          const end = contents.indexOf('\n}\n\nmodule.exports', start);
          if (start < 0 || end < 0 || !contents.slice(start, end).includes('new Function')) {
            throw new Error('The Fastify constraint router changed. Recheck the Worker build.');
          }
          contents =
            contents.slice(0, start) +
            `  _compileGetHandlerMatchingConstraints (constrainer) {
    if (this.constraints.length) throw new Error('SpoolNest Cloudflare routes cannot use Fastify route constraints');
    const required = Object.keys(constrainer.strategies).filter(key => constrainer.strategies[key].mustMatchWhenDerived);
    this._getHandlerMatchingConstraints = function (derived) {
      return required.some(key => derived[key] !== undefined) ? null : this.unconstrainedHandler;
    };
  }` +
            contents.slice(end);
        }
        return { contents, loader: 'js' };
      },
    );
  },
};

await mkdir('dist/cloudflare', { recursive: true });
await rm('dist/cloudflare/pages', { recursive: true, force: true });
await Promise.all([
  build({
    entryPoints: ['apps/cloudflare/worker.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2023',
    keepNames: true,
    minify: true,
    plugins: [staticRouter],
    loader: { '.sql': 'text' },
    external: ['cloudflare:*'],
    banner: {
      js: 'import {createRequire} from "node:module";const require=createRequire("file:///spoolnest-worker.mjs");',
    },
    outfile: 'dist/cloudflare/worker.mjs',
  }),
  cp('dist/web', 'dist/cloudflare/pages', { recursive: true }),
]);
await build({
  entryPoints: ['apps/cloudflare/pages.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2023',
  outfile: 'dist/cloudflare/pages/_worker.js',
});
