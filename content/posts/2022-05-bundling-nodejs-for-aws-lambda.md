---
title: Bundling your Node.js app for AWS Lambda
date: 2022-05-27
---

In my current project, we decided to use AWS Lambda as the deployment model for
our Node.js webhooks and API servers. We leverage Pulumi to define our
infrastructure in JavaScript code. In this post, I share the lessons I learned
about different ways how to package your code and dependencies.

TL;DR: After trying several different options, I ended with esbuild. Despite
some shortcomings, it seems to be the most popular choice nowadays. 🤷🏻‍♂️ Jump to
the [esbuild section](#giving-up-and-adopting-eslint) if you are looking for
details on how to configure your Pulumi project to bundle Lambda handlers using
esbuild.

## Naive beginnings

Pulumi's tutorial called
[Serverless App Using API Gateways and Lambda](https://www.pulumi.com/registry/packages/aws/how-to-guides/rest-api/)
shows how to define a Lambda function inside the code describing the related
infrastructure.

```js
// Create a public HTTP endpoint (using AWS APIGateway)
const endpoint = new awsx.apigateway.API('hello', {
  routes: [
    // Serve a simple REST API on `GET /name` (using AWS Lambda)
    {
      path: '/source',
      method: 'GET',
      eventHandler: (req, ctx, cb) => {
        cb(undefined, {
          statusCode: 200,
          body: Buffer.from(JSON.stringify({ name: 'AWS' }), 'utf8').toString(
            'base64',
          ),
          isBase64Encoded: true,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  ],
});
```

This approach works great for tiny handlers with little or no dependencies. It
quickly breaks once you start working with dependencies in a modern way.

Let's take a look at an example using the legacy ES5 style assumed by Pulumi:

```js
// at the top of your file
const path = require('path');

// your Lambda
function handler(/*...*/) {
  path.resolve(/*...*/);
}
```

In this case, Pulumi is smart enough to understand that the `path` variable
defined outside of the handler function should be initialised using the built-in
Node.js module path.

If you are used to the more modern convention using object destructuring, you
are out of luck - Pulumi does not support this style.

```js
// at the top of your file
const { resolve } = require('path');

// your Lambda
function handler(/*...*/) {
  resolve(/*...*/);
}
```

In this case, Pulumi treats `resolve` as a user-defined JavaScript function. It
will attempt to recursively serialise the function body and its references,
eventually reaching a function implemented as a native C++ method in the
low-level Node.js layer. Obviously, such a function cannot be represented in
JavaScript, and so Pulumi fails.

Example error message for `fs.readfile`:

```
Error serializing '() => { readFile("/path/to/file", () ...'

'() => { readFile("/path/to/file", () ...': referenced
  function 'readFile': which referenced
    function 'maybeCallback': which captured
      'ERR_INVALID_CALLBACK', a function defined at
        function 'NodeError': which referenced
          function 'getMessage': which captured
            variable 'messages' which indirectly referenced
              function 'get': which could not be serialized because
                it was a native code function.
```

_This is a known problem; you can follow the discussion in the GitHub issue
[pulumi#6987](https://github.com/pulumi/pulumi/issues/6987)._

Now you may be wondering what happens when your code uses ES modules.

```js
import { resolve } from 'path';
```

Well, I moved away from inline handlers before AWS Lambda announced support for
ESM, so I don't know if the Pulumi bundler supports ESM.

Either way, there are additional issues with inline handlers:

- The transpiled code is subtly different from what you wrote.
- You cannot cache expensive-to-initialize values between lambda invocations.
- And so on.

For the reasons outlined above, I quickly decided to look for a better way of
bundling my code.

## Discovering the power of Pulumi Archives

All better code bundling approaches have one thing in common: they describe the
Lambda source code as an archive containing one or more files.

The REST API example shown earlier can be rewritten as follows, replacing the
inline handler function with a Lambda Function instance executing the handler
provided by the file `hello-lambda.js`:

```js
// Create a public HTTP endpoint (using AWS APIGateway)
const endpoint = new awsx.apigateway.API('hello', {
  routes: [
    // Serve a simple REST API on `GET /name` (using AWS Lambda)
    {
      path: '/source',
      method: 'GET',
      eventHandler: new aws.lambda.Function('hello-lambda', {
        code: new pulumi.asset.AssetArchive({
          'index.js': new pulumi.asset.FileAsset(require.resolve('./hello.lambda.js')),
        })
        handler: 'index.handler',
        // other Lambda settings
      },
    },
  ],
});
```

Notice how the archive is described as a key-value map, where keys are local
paths within the archive and values are providing the content. Pulumi offers
several different options for content - see the official documentation
[Assets and Archives](https://www.pulumi.com/docs/intro/concepts/assets-archives/).

- `FileAsset` represents a single file read from the local filesystem.
- `StringAsset` allows you to provide the file content directly as a string.
- `FileArchive` represents a directory in the local filesystem or a file archive
  like a `.zip` file.

Inside `hello.lambda.js` file, we need to export the `handler` function. In the
example below, I also reworked the implementation from callback-style to
async/await.

```js
// file hello.lambda.js
export async function handler(event, context) {
  return {
    statusCode: 200,
    body: Buffer.from(JSON.stringify({ name: 'AWS' }), 'utf8').toString(
      'base64',
    ),
    isBase64Encoded: true,
    headers: { 'content-type': 'application/json' },
  };
}
```

In the rest of this text, I'll explore different options for building a list of
files to include in the archive for a Lambda handler.

## Excavating obscure npm features

Back in the early StrongLoop days in 2013, we explored different ways to
package, publish, and deploy Node.js libraries and applications. Along the way,
I learned a lot about various npm package options related to dependencies. One
such option is `bundledDependencies`; it allows package authors to tell npm to
include the source code of specific dependencies in the tarball published to the
npm registry. (By default, packages publish only their own source code.)

The npm CLI client is nicely decomposed into small libraries that 3rd-party apps
can use independently. This architecture makes it easy to build custom tooling
leveraging standard npm conventions.

Here is how we can use npm APIs to describe a Pulumi archive:

- Use a monorepo layout, where each Lambda function has its own package with its
  own dependencies.
- Every lambda package must list all production dependencies in the
  `bundledDependencies` field.
- Use [npm-packlist](https://www.npmjs.com/package/npm-packlist) to build a list
  of lambda package source code files, including transitive dependencies.
- Create a Pulumi `AssetMap` and add a new `FileAsset` for each source code
  file. Finally, create an `AssetArchive` from the `AssetMap`.

```js
import * as path from 'path';
import * as pulumi from '@pulumi/pulumi';
import packlist from 'npm-packlist';

/**
 * @param {string} absDir Absolute path to lambda's package directory.
 * @returns {Promise<pulumi.asset.Archive>}
 */
export async function buildNpmPackageArchive(absDir) {
  const files = await packlist({ path: absDir });

  /** @type {pulumi.asset.AssetMap} */
  const archiveItems = {};
  for (const f of files) {
    const fullPath = path.resolve(absDir, f);
    archiveItems[f] = new pulumi.asset.FileAsset(fullPath);
  }

  return new pulumi.asset.AssetArchive(archiveItems);
}
```

The first problem I quickly discovered: npm workspaces are not compatible with
bundled dependencies. Dependencies of all monorepo packages are installed in the
root directory (this is called hoisting), e.g. `~project/node_modules`. The
module `npm-packlist` is looking for dependencies in the package's node_modules
folder only, e.g. `~project/packages/my-lambda/node_modules`. It silently
ignores that problem when it does not find any of the bundled dependencies.

Fortunately, this problem is easy to solve by using an alternative dependency
layout strategy that does not hoist dependencies to the root. Personally, I am a
happy user of [pnpm](https://pnpm.io), which implemented this strategy first.
However, you can get the same behaviour with a recent version of
[yarn](https://dev.to/arcanis/yarn-31-corepack-esm-pnpm-optional-packages--3hak#new-install-mode-raw-pnpm-endraw-)
too.

The second problem is a show stopper. pnpm creates a delicate structure of
symbolic links to prevent code from accessing packages not declared as
dependencies. This structure provides the desired dependency loading behaviour
at runtime but significantly differs from what npm produces and understands.
Unfortunately, npm-packlist does not support such node_modules layout and lists
only top-level dependencies. Such behaviour was ok as long as I used only
[undici](https://www.npmjs.com/package/undici) - an HTTP client with no
dependencies. Once I added [pg](https://www.npmjs.com/package/pg), which
internally depends on a few more packages, the lambda function stopped working.

Time to look for a different solution. Again.

## Experimenting with static code analysis

While exploring tools that could help me with bundling deep dependencies, I
discovered
[es-module-traversal](https://www.npmjs.com/package/es-module-traversal). This
library accepts a JavaScript source file in ESM format and returns a list of all
ES modules it imports, including modules imported by other files (transitive
dependencies).

With this tool, I no longer need monorepo and per-lambda `bundledDependencies`.
I can quickly get a list of things to bundle for a given source file: files from
my project and dependencies from node modules.

```js
import * as pulumi from '@pulumi/pulumi';
import emt from 'es-module-traversal';
import fs from 'fs/promises';
import path from 'path';

const { traverseEsModules } = emt;

/**
 * @param {string} projectRoot Root directory
 * @param {string} handlerFile Relative path to the handler file
 * @returns {Promise<pulumi.asset.Archive>}
 */
export async function buildLambdaArchive(projectRoot, handlerFile) {
  const imports = await traverseEsModules({
    entryPoints: [path.resolve(projectRoot, handlerFile)],
  });

  /** @type {pulumi.asset.AssetMap } */
  const archiveItems = {
    [handlerFile]: new pulumi.asset.FileAsset(
      path.resolve(projectRoot, handlerFile),
    ),
    'package.json': new pulumi.asset.StringAsset(
      JSON.stringify({ type: 'module' }),
    ),
  };

  const moduleDeps = [];
  for (const { importPath, resolvedImportPath } of imports) {
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // relative import of a single project-local file
      const localPath = path.relative(projectRoot, resolvedImportPath);
      archiveItems[localPath] = new pulumi.asset.FileAsset(resolvedImportPath);
    } else {
      // module import, may be resolved to a package cache - save it for later
      moduleDeps.push(importPath);
    }
  }

  // TODO for each dependency in `moduleDeps`:
  // find all its files, including transitive dependencies, and add them to archiveItems.

  return new pulumi.asset.AssetArchive(archiveItems);
}
```

Collecting files of all transitive dependencies is relatively easy thanks to the
pnpm module layout because every module has its dependencies linked next to it.
It's about ~40 lines of code; the essential part is to call `fs.realpath` to
resolve symlinks into their actual location in the pnpm cache.

This solution worked pretty well for a while. Until I started to add more
dependencies to my lambda. Looking at you,
[Postgraphile](https://www.graphile.org)! At that point, I exceeded the maximum
allowed size for Lambda code, and it was again time to look for yet another
solution.

## Giving up and adopting eslint

At this point, I gave up. I decided to follow what others are doing and adopt
[esbuild](https://esbuild.github.io). I am not happy that I am running a
different code from what I see in my project, but I guess that's the price I
have to pay for using AWS Lambda as the deployment target.

At a high level, esbuild makes bundling super easy: you give it a path to your
JavaScript (or even TypeScript!) handler file, and esbuild gives you back a
single JavaScript file containing both your code and all dependencies. You can
even use `pulumi.asset.StringAsset` to keep everything in memory.

Of course, things are more complicated in practice.

1. Top-level await requires a tweak in esbuild config.
2. `StringAsset` comes with a performance penalty when the content is large.
3. I want source map support for Error stack traces.
4. The client `pg` has an optional dependency `pg-native`, which I am not
   installing. esbuild fails when this dependency is not found.
5. The code produced by esbuild for Node.js ESM target does not work in several
   edge cases.
6. Code resolving paths using `__dirname` and `import.meta.url` does not work
   when bundled.

### Top-level await

I am running my code on the latest Node.js version 14.x provided by AWS Lambda;
this version supports top-level await. Support for top-level await is not
available in early 14.x versions; therefore, we must tell esbuild to target
Node.js 14.8 or later.

```js
/** @type {esbuild.BuildOptions} */
const esbuildConfig = {
  // (...)
  platform: 'node',
  target: 'node14.8',
  format: 'esm',
};
```

_Note: In May 2022, AWS Lambda added support for Node.js version 16. We can set
the build target to `node16` now._

### Low performance of large string assets

When using `StringAsset`, Pulumi stores the entire content of the asset in the
stack data. When the lambda bundle is large (several megabytes), Pulumi CLI has
to exchange a lot of data with the state backend every time it runs. As a
result, the CLI becomes sluggish.

I solved this problem by saving esbuild's output in a `dist` folder and adding
it to the asset archive using `FileAsset`.

```js
const result = await esbuild.build(esbuildConfig);
// handle errors & warnings (omitted for brevity)

for (const f of result.outputFiles) {
  const relPath = path.relative(projectRoot, f.path);
  const distPath = path.join(distDir, relPath);
  await fs.mkdir(path.dirname(distPath), { recursive: true });
  await fs.writeFile(distPath, f.text, { encoding: 'utf-8' });
  archiveItems[relPath] = new pulumi.asset.FileAsset(distPath);
}
```

A side note: I am treating AWS Lambda as a deployment model for my Node.js
application. An experienced friend reviewing my post suggested that I should not
treat AWS Lambda just as a deployment target. Instead, he recommends redesigning
my architecture and accommodating the limitations of the serverless model.

> We have had a bad experience with Lambda functions larger than 100kb.

In such a case, it is actually beneficial that large string assets are slowing
down Pulumi CLI performance. Slow CLI reminds you that your Lambda functions are
getting too large and will have long cold starts at runtime.

### Sourcemap support

Node.js has experimental support for source maps: if your transpiled code
provides a source map, and you enable sourcemaps, then error stack traces will
point to your original source code, not the transpiled bundle.

AWS Lambda does not support configuring flags passed to the `node` executable.
Fortunately, Node.js allows you to specify these flags via the environment -
just add the following entry to your Lambda's environment object:

```js
/** @type {Partial<aws.lambda.FunctionArgs>} */
const lambdaConfig = {
  // (...)
  environment: {
    variables: {
      NODE_OPTIONS: '--enable-source-maps',
      // (...)
    },
  },
};
```

Remember to add the source map file created by esbuild to the Pulumi asset map.

### Ignore optional dependency `pg-native`

The Postgres client `pg` has an optional dependency on `pg-native`. This module
is typically not installed and silently ignored at runtime, but esbuild does not
know that and fails when it cannot find the module.

The solution is easy. Just mark the module as external in esbuild options:

```js
const esbuildConfig = {
  // (...)
  external: ['pg-native'],
};
```

### Node.js ESM target

There is a bug in esbuild's support for producing ESM modules, where external
modules like Node.js built-in modules are loaded using `require`, even though
the transpiled code is in ESM format. At runtime, the transpiled code fails with
the following error:

```
Error: Dynamic require of "path" is not supported
```

I solved the problem using the workaround described in
[evanw/esbuild#2067](https://github.com/evanw/esbuild/pull/2067) and configured
esbuild to add a small shim to every output file.

```js
const REQUIRE_SHIM = `
// Shim require if needed.
import module from 'module';
if (typeof globalThis.require === "undefined") {
  globalThis.require = module.createRequire(import.meta.url);
}
`;

const esbuildConfig = {
  // (...)
  banner: {
    js: REQUIRE_SHIM,
  },
};
```

### Handle `__dirname` and `import.meta.url`

Few places in my project are resolving relative paths using `__dirname` and
`import.meta.url`. For obvious reasons, this does not work in the bundled code:
the variable `__dirname` is not even defined in ESM, and `import.meta.`url`
points to the bundled file, not the original source.

I implemented a small plugin that defines `__dirname` as a constant for CJS
files and replaces `fileURLToPath(import.meta.url)` with the actual file name.

```js
const esbuildConfig = {
  // (...)
  plugins: [createFixDirnamesPlugin(projectRoot)],
};

/**
 * @param {string} projectRoot
 * @returns {import('esbuild').Plugin}
 */
function createFixDirnamesPlugin(projectRoot) {
  return {
    name: 'fixDirnames',
    setup(build) {
      build.onLoad({ filter: /.\.js$/, namespace: 'file' }, async (args) => {
        let contents = await fs.readFile(args.path, 'utf-8');

        contents = contents.replace(
          /fileURLToPath\(import\.meta\.url\)/g,
          JSON.stringify(path.relative(projectRoot, args.path)),
        );

        if (contents.match(/__dirname/)) {
          const quotedDirname = JSON.stringify(
            path.relative(projectRoot, path.dirname(args.path)),
          );
          const declareDirname = `const __dirname = ${quotedDirname};\n`;
          contents = declareDirname + contents;
        }

        return { contents };
      });
    },
  };
}
```

Here is my final esbuild config:

```js
/** @type {esbuild.BuildOptions} */
const esbuildConfig = {
  bundle: true,
  minify: false,
  write: false,
  charset: 'utf8',
  platform: 'node',
  target: 'node14.8',
  format: 'esm',
  sourcemap: true,

  plugins: [createFixDirnamesPlugin(projectRoot)],
  banner: {
    js: REQUIRE_SHIM,
  },

  external: ['pg-native'],
  entryPoints: [path.resolve(projectRoot, handlerFile)],
  outfile: path.resolve(projectRoot, handlerBundle),
};
```

## Conclusion

So far, this setup has been working well for me.

How do you bundle your Node.js applications to run on AWS Lambda?

_Thanks to Aleš Roubíček ([@alesroubicek](https://twitter.com/alesroubicek)),
Jiří Rejman ([@rejmank1](https://twitter.com/rejmank1)) and Jan Voráček
([@JanVoracek](https://twitter.com/JanVoracek)) for comments and suggestions._
