---
title: Getting Started with Android Push Notifications in LoopBack
date: 2014-01-14
originalUrl: https://strongloop.com/strongblog/android-push-notifications-loopback-node-js/
---

In the previous blog post
[Push notifications with LoopBack](http://strongloop.com/strongblog/push-notifications-ios7-looback-node-js/),
we have described how to setup your LoopBack application for sending push
notifications to iOS devices such as iPhone. In this installment, we will look
at pushing notifications to Android devices. To illustrate the end to end flow,
let's consider the scenario from the previous blog post and extend it to cover
Android users too.

**Example: the marketing dept wants to &#8220;push&#8221; a promotion**

Scenario: The marketing department needs to send a new year promotion to all
users of the company's iPhone and Android applications in the United States.

What steps are needed on the server side?

1. Create the promotion message.

2. Find all users whose address is in the United States

3. Find the iOS and Android devices associated with the users found in step 2.

4. Send out notifications to each of those devices through Apple's APN or
   Google's GCM service.

LoopBack's push notification service provides a single API that can be used for
pushing notifications to many different device types. Extending your application
to support a new device type like Android is only a matter of updating the
configuration stored in the LoopBack Application model. Everything else stays
the same, including the code calling the LoopBack server to send the
notifications.

Please refer to the 
[Push notifications with LoopBack](http://strongloop.com/strongblog/push-notifications-ios7-looback-node-js/)
blog for a detailed walk-through describing how to build your LoopBack server.

Now that we have a server capable of pushing notifications to Android devices,
how to enable our Android application to receive those notifications?

1. Setup your application to use Google Play Services

2. On application startup, register with GCM servers to obtain a device
   registration id (device token) and register the device with LoopBack server.

3. Configure your application to receive incoming messages from GCM.

4. Process the notifications received.

All four steps are described in our
[documentation](http://docs.strongloop.com/display/DOC/Creating+push+notifications#Creatingpushnotifications-IntegratewithAndroidclients).
In this blog post, I'd like write more about the the registration workflow.

When I started to work on the demo Android application, I ended up with the
following steps:

1. Check if we have already registered with GCM before &#8211; try to load a
   device token from `SharedPreferences`.

2. If there was no token found, or if the token was saved by an older version of
   our application, then register with GCM and save the token to
   `SharedPreferences`.

3. Now we need to create or update an instance of `Installation` model, which is
   used by LoopBack to track application installations. First of all, try to
   load `Installation` ID from `SharedPreferences`.

4. If there was an ID found, we have already registered with the LoopBack server
   and we need to update an existing record. Otherwise we are creating a new
   one.

5. Fill all required `Installation` properties like device token, user id,
   application version, etc.

6. Save the `Installation` to the server.

I didn't like how complex the registration was, especially the first three steps
involved a lot of code.  Since I have a strong preference for code that is
simple, elegant and easy to work with; I decided there must be a better
solution. And so `LocalInstallation` was born.

This is the new workflow I have arrived at:

```java
// 1. Create LocalInstallation instance
//    It will do most of the heavy lifting for us
final LocalInstallation installation =
    new LocalInstallation(appContext, restAdapter);

// 2. Update Installation properties that were not pre-filled
installation.setAppId("loopback-app-id");
installation.setUserId("miroslav");

// 3. Check if we have a valid GCM registration id
if (installation.getDeviceToken() != null) {
    // 4a. We have a valid GCM token, all we need to do now
    //     is to save the installation to the server
    saveInstallation(installation);
} else {
    // 4b. We don't have a valid GCM token. Get one from GCM
    // and save the installation afterwards
    registerInBackground(installation);
}
```

The code uses two helper functions to hide away the complexity of sending HTTP
requests on a background thread. The first one calls the familiar `save()`
method:

```java
void saveInstallation(final LocalInstallation installation) {
    installation.save(new Model.Callback() {
        @Override
        public void onSuccess() {
            // Installation was saved.
        }
        @Override
        public void onError(final Throwable t) {
            Log.e(TAG, "Cannot save Installation", t);
        }
    });
}
```

The second helper method registers the device with the GCM server, updates the
installation with the device token received and saves the updated installation
to the LoopBack server.

```java
private void registerInBackground(final LocalInstallation installation) {
    new AsyncTask<Void, Void, Exception>() {
        @Override
        protected Exception doInBackground(final Void... params) {
            try {
                GoogleCloudMessaging gcm =
                    GoogleCloudMessaging.getInstance(this);
                // substitute 12345 with the real Google API Project number
                final String regid = gcm.register("12345");
                installation.setDeviceToken(regid);
                return null;
            } catch (final IOException ex) {
                return ex;
            }
        }
        @Override
        protected void onPostExecute(final Exception error) {
            if (err != null) {
                Log.e(TAG, "GCM Registration failed.", error);
            } else {
                saveInstallation(installation);
            }
        }
    }.execute(null, null, null);
}
```

Pretty easy, huh?
