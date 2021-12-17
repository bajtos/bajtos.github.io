---
title: Android Emulator on Apple M1 machines
date: 2022-01-07
---

What options do we have for running Android apps on macOS?

- Android Studio
- BlueStacks
- Android SDK CLI

Android Studio is a large application built on top of IntelliJ IDE with a
download size of over 900 MiB. That's a lot to install and keep up to date when
all we need is an emulator!

In the past, I have had a good experience with BlueStacks (which is still a
medium-sized app). Unfortunately, they don't support Mac computers with M1 chips
and macOS 12 Monterey.

Fortunately, setting up Android Emulator via CLI is easier than I expected:

1. Install Java runtime
2. Install Android SDK
3. Download Android Emulator and Android system components
4. Create a new virtual device
5. Done!

## Java runtime

Android tooling is built in Java, therefore you need Java runtime installed on
your machine. Using [Homebrew](https://brew.sh):

```sh
$ brew install openjdk
```

Let's verify that our Java runtime is native M1. Inspect the executabl using
`file` command and check the architecture is `arm64`:

```
$ file /opt/homebrew/opt/openjdk/bin/java
/opt/homebrew/opt/openjdk/bin/java: Mach-O 64-bit executable arm64
```

## Android SDK

Android SDK is a set of CLI tools for building Android applications.
Importantly, it includes the tool called `sdkmanager` which can download
additional components. We will use this tool to install the emulator component,
system images to boot the emulator and other required packages.

For better or worse, the process to install command line tools only is manual.

1. Download a ZIP file with the tools from the
   [Android Studio homepage](https://developer.android.com/studio#command-tools).

   _While there are two different builds of Android Studio for Intel and M1
   chips, there is a single download for command-line tools. No need to worry!
   Command-line tools are shell scripts delegating platform-specific work to
   Java._

2. Extract the content of the archive to the `Library` folder in your home
   directory. Typically, Safari will extract the ZIP archive into your Downloads
   folder. All you need is to move the files to the right place.

   **It's important to place the files in the exact path shown below, as some
   Android tools make assumptions about the file system layout.**

   ```sh
   $ mkdir -p ~/Library/Android/sdk/cmdline-tools/latest
   $ mv ~/Downloads/cmdline-tools/* ~/Library/Android/sdk/cmdline-tools/latest
   ```

3. Finally, update your `PATH` environment variable to include Android tooling.
   Add the following block to your `~/.zsh` or `~/.bashrc` file:

   ```sh
   export ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
   if [ -d $ANDROID_SDK_ROOT ]
   then
     PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/platform-tools:$PATH"
   fi
   ```

4. Now we can verify that `sdkmanager` works:

   ```sh
   $ sdkmanager --version
   5.0
   ```

## Android Emulator

With the necessary tooling installed, the next step is to download various
Android components:

```sh
$ sdkmanager "platform-tools" "emulator" \
  "platforms;android-30" \
  "system-images;android-30;google_apis_playstore;arm64-v8a"
```

This command will install the following packages:

- `platform-tools`: quoting the description from
  [Android docs](https://developer.android.com/studio/releases/platform-tools):

  > Android SDK Platform-Tools is a component for the Android SDK. It includes
  > tools that interface with the Android platform, such as `adb`, `fastboot`,
  > and `systrace`. These tools are required for Android app development.
  > They're also needed if you want to unlock your device bootloader and flash
  > it with a new system image.

- `emulator`: a program that simulates Android devices on your computer and
  provides almost all of the capabilities of a real Android device.

- `system-images;android-30;google_apis_playstore;arm64-v8a`: system image for
  arm64 (Apple M1) platform, including access to Google Play Services and Google
  Play Store. The number 30 refers to API level, here we are picking Android 11
  (API level 30). This image is required by the emulator to boot Android OS.

- `platforms;android-30`: the SDK Platform is required to compile apps.
  Apparently, the emulator requires it too. It's important to pick the same API
  level you choose for the system image (`android-30` in my case).

## Virtual device

Now we can create a virtual Android device to run in the emulator. Notice the
`package` value -- it's the name of the system image you downloaded via
`sdkmanager` in the previous step.

```sh
$ avdmanager create avd \
   --name "android30" --device "pixel" \
   --package "system-images;android-30;google_apis_playstore;arm64-v8a"
```

You can create as many virtual devices as you like. Just repeat the step above
with different parameters.

## Start the emulator

Here comes the easiest part: start the emulator using the name of the virtual
device created in the previous step.

```sh
$ emulator -avd android30
```

Congratulations, you have a working Android Emulator now and can run any Android
applications you like.

## Bonuses

### Enable hardware keyboard

By default, the emulator offers an on-screen keyboard for touch typing. This
works great on mobile phones with touch screens, but not so much on a MacBook
with no touch support! The process of logging into your Google account without a
proper keyboard is rather frustrating.

Fortunately, the emulator can accept input from your computer keyboard. Just
enable hardware keyboard in your virtual device config which is stored in
`~/.android/avd/android30.avd/config.ini` (replace `android30` with the name of
your device).

```diff
- hw.keyboard = no
+ hw.keyboard = yes
```

### Install applications from APK files

If you choose a system image that includes Play Store, then you can install
Android applications directly from the official app store.

Either way, you can also install applications from APK files. Run the following
command while the emulator is running:

```sh
$ adb install my-app.apk
```
