---
title: Easy Switching Between Public and Private npm Registries
date: 2014-04-30
guid: http://strongloop.com/?p=15911
---

As Node.js is
[becoming a mainstream technology](http://www.nearform.com/nodecrunch/node-js-becoming-go-technology-enterprise)
in the enterprise, more companies are asking for a private npm registry solution
for their proprietary closed-source modules.

While there are several solutions emerging that offer a private npm registry
server (either in the cloud or on premise), we at StrongLoop feel the private
registry server is only one part of the story.

<!--more-->

The second part is switching your npm client configuration between multiple
registries.  Why would you want to use multiple registries? There are several
reasons; for example:

- Some of your modules are open source and thus published to the public
  npmjs.org registry and others are private and published to your private
  registry.

- You have multiple private registries: for example a company-wide registry for
  stable versions of modules and multiple per-team registries with nightly
  builds of each module.

Previously, many developers used the
[npm config](https://www.npmjs.org/doc/cli/npm-config.html) command to switch
between different registry servers:

```sh
$ npm config set registry https://your.registry.url/
```

This solution has few drawbacks:

- It ignores the fact that there are multiple configuration options that differ
  between registry servers, e.g. username and password.  You must change these
  options too when switching to another registry.
- You have to recall and re-type the correct registry URL every time you change
  your registry server.

The module [npmrc](https://www.npmjs.org/package/npmrc) provides a better
solution.  It maintains a set of npmrc files (one npmrc for every registry) and
you switch between them using a single command. However it is still not perfect,
as the general options like “browser” or “git” are not shared across different
configurations as they should be.

## Introducing slc registry

Today we are pleased to announce a new tool that makes registry switching as
easy at it should be: `slc registry`. It comes as a part of `slc`, our
Swiss-army knife for Node.js developers.

### `slc registry` quickstart

1. Update your slc tool

   ```sh
   $ slc update
   ```

   or install it from the public npmjs.org registry

   ```sh
   $ npm install -g strong-cli
   ```

2. Add a new configuration entry for your private registry

   ```sh
   $ slc registry add private http://your.registry.url/
   ```

   You will be presented with a simple wizard where you can customize related
   configuration options:

   ```
   Adding a new configuration "private"
   [?] Registry URL: (http://your.registry.url/)
   [?] HTTP proxy:
   [?] HTTPS proxy:
   [?] Email: (miroslav@strongloop.com)
   [?] Always authenticate? (Y/n)
   [?] Check validity of server SSL certificates? (Y/n)

   Configuration "private" was created.

   Run `slc registry use "private"` to let the npm client use this registry.
   ```

3. Switch your npm client to use the private registry:

   ```sh
   $ slc registry use private

   Using the registry "private" (http://your.registry.url/).
   ```

4. Switching back to the public npmjs.org registry is easy too:

   ```sh
   $ slc registry use default

   Using the registry "default" (https://registry.npmjs.org/).
   ```
