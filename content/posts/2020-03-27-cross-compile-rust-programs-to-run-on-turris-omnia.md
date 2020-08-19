---
title: Cross-compile Rust programs to run on Turris Omnia
date: 2020-03-27
originalUrl: https://medium.com/@bajtos/cross-compile-rust-programs-to-run-on-turris-omnia-e592b555e2aa
---

In my
[previous blog post](../2020-03-25-how-to-run-unifi-controller-on-turris-omnia/),
I described how to use LXC containers to run an arbitrary Ubuntu package on
Turris Omnia. While easy to configure, I find such setup rather wasteful. I
don’t want to run another full Linux distro on my router to be able to run small
(home) automation programs.

What other options do we have?

- Write programs in Python. Turris OS comes with Python version 2.7, a lot of
  the admin tooling is written in Python too. However, I never fell in love with
  Python, plus it’s a high-level interpreted language with a garbage
  collector — not the most efficient option either 🤷‍♂️
- Use a low level language like C or C++ and cross-compile programs for Turris.
  It turns out cross-compilation is pretty easy to set up and we can get the
  best performance with the lowest memory usage. But only as long as we don’t
  introduce a memory leak or crash the process on accessing memory that has been
  already released back 🙈(Not to mention the complexity of installing 3rd-party
  dependencies, because there is no package manager for C/C++.)
- Use [Rust](https://www.rust-lang.org/) to get best of the both worlds:
  productivity and reliability of high-level languages like Python together with
  performance of low-level languages like C 💪

Let’s take a look at the Rust path. To get a Rust program running on Turris, we
need to:

1.  Find the platform used by the router hardware, this will be the
    cross-compilation target.
2.  Install cross-compilation build tools, verify that we can cross-compile a
    simple C program and run it on the router.
3.  Install Rust and setup cross-compilation, verify that we can cross-compile a
    simple Rust program and run it on the router.

_Note: The following instructions are for Ubuntu 18.04 LTS. I am using_
[_Windows Subsystem for Linux_](https://docs.microsoft.com/en-us/windows/wsl/install-win10)
_to run Ubuntu on my Windows machine._

## Find the target platform 🕵️‍♂️

Cross-compilation targets are typically expressed as triples in the following
format:

```text
{architecture}-{vendor}-{system}-{abi}
```

We already know that Turris Omnia’s processor has ARMv7 architecture. The vendor
is typically `unknown` for Linux systems, because it does not matter which
vendor created the distribution. The last missing piece is what ABI (application
binary interface) is Turris OS using? On Linux, this refers to the libc
implementation which you can find out with `ldd --version.`

```text
$ ssh root@192.168.1.1 "ldd --version"
musl libc (armhf)
Version 1.1.19
Dynamic Program Loader
Usage: ldd \[options\] \[--\] pathname
```

The target triple for Turris Omnia is `armv7-unknown-linux-musleabihf` and
luckily for us, this target is supported by Rust as a
[Tier 2 platform](https://forge.rust-lang.org/release/platform-support.html#tier-2):

> Tier 2 platforms can be thought of as “guaranteed to build”. Automated tests
> are not run so it’s not guaranteed to produce a working build, but platforms
> often work to quite a good degree and patches are always welcome!

## Setup C cross-compiler ⚙

Before we begin, let’s make sure we have regular build tooling installed.

```shell
$ sudo apt-get install build-essential
```

Now our task would be much simpler if we were targeting `gnueabihf` instead of
`musleabihf`, because Ubuntu provides packages with cross-compiling toolchain
for `gnueabihf` targets. [MUSL](https://www.musl-libc.org/) is a bit of mystery
for me, I know almost nothing about this flavor of the standard C library.

Fortunately, there is a project called
[musl-cross-make](https://github.com/richfelker/musl-cross-make) that provides a
_“simple makefile-based build for musl cross compiler”_ and it works like a
charm! Start by downloading the source codes from from GitHub:

```shell
$ wget https://github.com/richfelker/musl-cross-make/archive/master.tar.gz
$ tar xzf master.tar.gz
$ cd musl-cross-make-master
```

Let’s tweak few configuration options before we start the build. Copy the config
template file `config.mak.dist` to `config.mak` and set the following options
(you can uncomment the relevant lines provided by the template):

```text
TARGET=arm-linux-musleabihfOUTPUT=/usr/local
```

(It’s best to use the same MUSL version as reported by `ldd --version` on your
Turris. Mine is `1.1.19` at the time of writing.)

Build time!

```shell
$ make
$ make install
```

Now we should have all tooling installed in `/usr/local` and thus available on
`PATH`. Let’s run gcc to verify:

```text
$ arm-linux-musleabihf-gcc --version
arm-linux-musleabihf-gcc (GCC) 9.2.0
Copyright (C) 2019 Free Software Foundation, Inc.
(...)
```

## Cross-compile a C program 🌍

So far, we have a hypothesis about the target triplet that matches Turris
platform. Now it’s time to verify our assumptions in practice.

Write a simple “Hello world” program in C — save the following code to a file
named `hello.c`:

```c
#include <stdio.h>
int main() {
  printf("Hello, World!\n");
  return 0;
}
```

Cross-compile this program for Turris:

```shell
$ arm-linux-musleabihf-gcc hello.c -o hello
```

Upload the program to the router and execute it there. I am storing the file in
`/srv`, which is backed by an mSATA SSD drive, to avoid unnecessary writes to
the internal flash storage. If all goes well then you should get the familiar
greeting.

```text
$ scp hello root@192.168.1.1:/srv
hello                                 100% 7292     1.6MB/s   00:00
$ ssh root@192.168.1.1 /srv/hello
Hello, World!
```

## Install Rust and setup cross-compilation 🏎

There are different ways how to install Rust, I decided to use the recommended
approach based on `rustup`.

```shell
$ curl https://sh.rustup.rs -sSf | sh
```

We also need to install standard crates (Rust core modules) cross-compiled for
our target platform.

```shell
$ rustup target add armv7-unknown-linux-musleabihf
```

In the last step, we tell the Rust compiler which linker to use when compiling
for our target platform. Add the following section to `~/.cargo/config`:

```ini
[target.armv7-unknown-linux-musleabihf]
linker = "arm-linux-musleabihf-gcc"
```

## Cross-compile a Rust program 🎉

Create a “Hello world” program in Rust and compile it:

```text
$ cargo new --bin hello
$ cd hello
$ cargo build --target=armv7-unknown-linux-musleabihf
Compiling hello v0.1.0 (/home/bajtos/src/hello)
Finished dev [unoptimized + debuginfo] target(s) in 2.53s
```

Upload the program to the router and execute it there. If all goes well then you
should get the same greeting again.

```text
$ scp target/armv7-unknown-linux-musleabihf/debug/hello root@192.168.1.1:/srv
hello                                  100% 2903KB  10.8MB/s   00:00
$ ssh root@129.168.1.1 /srv/hello
Hello, World!
```

Congratulations, now you can take any Rust program and run it on your Turris
Omnia router. For example, if you are using Mastodon and Twitter, you can sync
your posts between these two networks using
[klausi/mastodon-twitter-sync](https://github.com/klausi/mastodon-twitter-sync/).

## Credits and references 🙇‍♂️

A lot of the information in this blog post is based on
[japaric/rust-cross](https://github.com/japaric/rust-cross/blob/master/README.md),
an awesome guide for cross-compiling Rust programs. Thank you,
[Jorge Aparicio](https://github.com/japaric)!

The list of platforms supported by Rust can be found in the official project
documentation here:
[Rust Platform Support](https://forge.rust-lang.org/release/platform-support.html).

And finally it would take me ages to figure out how to cross-compile for MUSL
ABI if there wasn’t [Rich Felker](https://github.com/richfelker)’s excellent
[musl-cross-make](https://github.com/richfelker/musl-cross-make) project.

## P.S.

Did you notice that our C program has 7kB while the Rust version has 2903kB?
There are few tricks how to reduce the executable size of Rust programs. By
enabling Link Time Optimization, I was able to quickly reduce the size of a
release build down to 1408kB. You can learn about more advanced techniques in
[“Minimizing Rust Binary Size”](https://github.com/johnthagen/min-sized-rust).
