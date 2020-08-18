---
title: Debugging CoffeeScript with the Node Inspector Debugger
date: 2014-03-06
originalUrl: https://strongloop.com/strongblog/debug-coffeescript-node-js-inspector/
---

For what it's worth, since we announced the availability of
[Node Inspector v0.7](http://strongloop.com/strongblog/whats-new-in-the-node-inspector-v0-7-debugger/")
last week, we got a few questions about whether or not you could use Node
Inspector to debug [CoffeeScript](http://coffeescript.org/). The good news is,
yes, you can!

Getting started is straight-forward, just make sure to
[generate source-maps](http://coffeescript.org/#source-maps%20) when compiling
your CoffeeScript sources to JavaScript by adding `-m` option.

For example:

```shell
coffee -c -m *.coffee
node-debug app.js
```

For [Grunt](http://gruntjs.com/) users, the plugin
[grunt-contrib-coffee](https://github.com/gruntjs/grunt-contrib-coffee) has an
option named `sourceMap`.

Node Inspector supports source-maps out of the box, so no extra configuration is
needed.
