---
title: How to run UniFi Controller on Turris Omnia
date: 2020-03-25
originalUrl: https://medium.com/@bajtos/how-to-run-unifi-controller-on-turris-omnia-f9c178594bff
---

My next adventure with the Turris Omnia router was setting up an LXC container
to run UniFi Network Controller inside the router. The idea is to (eventually)
upgrade my wifi from Omnia’s Qualcomm Atheros QCA9880 to
[Ubiquiti UniFi](https://www.ui.com/unifi/unifi-ap/) access points.

It turns out the process is pretty easy and straightforward if you know what to
do. The information is a bit scattered in different places, I am writing this
blog post to provide a full and easy-to-follow guide.

Essentially, the process has three steps:

1.  Prepare the router to run LXC
2.  Create a new LXC container to run UniFi Network Controller
3.  Install UniFi Network Controller in the container

## Setup LXC

If you want to run LXC on your Turris hardware, then you need to install
additional storage (an mSATA SSD drive). Otherwise you may destroy your router’s
internal flash storage! As said in the docs:

> Operating LXC on the internal flash storage may lead to rapid degradation and
> eventually to failure of the storage. This may void your warranty.

I was lucky to have an old 16GB mSATA drive which came with my ancient Lenovo
E530 laptop. It was lying in my cabinet for years, I am glad I have found a new
use for it. If you don’t have any spare mSATA drive then go ahead and buy
one — they are fairly cheap nowadays.

### Tinker time!

Installing mSATA drive requires few changes in the way how Omnia’s wifi card are
wired, but the steps are surprisingly easy. Just follow the official video guide
here:
[https://www.youtube.com/watch?v=71_M2N3ga7s](https://www.youtube.com/watch?v=71_M2N3ga7s)

### fdisk

Depending on how is your new drive partitioned, you may need to run `fdisk` to
replace existing partition(s) with a new one. For example, my drive was split
into two 8GB partitions that I wanted to replace with a single partition taking
the entire available space.

The old version of Turris documentations provides a community-contributed guide
on partitioning mSATA SSD drives, I found it very easy to follow:
[https://doc.turris.cz/doc/en/public/partition_a_disk](https://doc.turris.cz/doc/en/public/partition_a_disk)

Note that you don’t need to format the new partition, Turris will take care of
that in the next steps.

### Storage plugin FTW

With a fresh partition ready, it’s time to tell Turris to put it to use. Turris
provides a nice GUI for this part, just follow the steps in the docs and don’t
forget to restart the router!
[https://docs.turris.cz/basics/foris/storage-plugin/storage-plugin/](https://docs.turris.cz/basics/foris/storage-plugin/storage-plugin/)

### Hello LXC

The next step is installing LXC infrastructure. Foris (on of the configuration
UIs provided by Turris Omnia) does not provide UI for working with LXC
containers, but it does allow you to install all necessary packages (and keep
them up-to-date). Learn more in the docs:
[https://docs.turris.cz/geek/lxc/lxc/](https://docs.turris.cz/geek/lxc/lxc/)

## Provision an LXC container

The first decision you need to make is which Linux distribution to use. It turns
out this is a critical part and if you get it wrong, you will have to re-do all
steps again. Let me explain why:

- UniFi Controller version 5.12 (latest) requires a MongoDB database.
- Turris Omnia has a 32bit dual-core ARMv7 CPU.
- MongoDB versions 3.x and 4.x support ARM64 only.
- MongoDB version 2.6 does support ARM32, but it has reached end of life on
  October 2016 and MongoDB no longer provides easily installable packages for
  Linux distros.

Fortunately, Ubuntu 16.04 LTS Xenial provides MongoDB 2.6 packages out of the
box. While 16.04 is very far from the latest and greatest, it is an LTS version
supported until April 2021, with extended security maintenance until April 2024.
This means you won’t have to worry about upgrades for the next four years.

### Create a new LXC container

In LuCI configuration interface, open the page “Services > LXC Containers”
([https://192.168.1.1/cgi-bin/luci/admin/services/lxc](https://192.168.1.1/cgi-bin/luci/admin/services/lxc)).
Enter the name of the new container and pick Ubuntu 16.04 LTS Xenial as the
template to use.

![Luci LXC Containers](/images/2020/luci-lxc-containers.png)

While it’s possible to start the new container from LuCI, the GUI does not pick
the new container immediately (I think you have to restart the router first).
Let’s switch to CLI for the next steps.

### Connect to your new container

Connect to your router via ssh (`ssh root@192.168.1.1`). By default, the root
account has the same password as you have configured for LuCI interface. You can
change that password via Foris interface at
[https://192.168.1.1/foris/config/main/password/](https://192.168.1.1/foris/config/main/password/).

Run the following two commands to start the new container and connect to it:

```shell
$ lxc-start unifi
$ lxc-attach -n unifi
```

### Fix the hostname

The LXC container is a new virtual machine that become another device in your
home network, it will receive the network address from your DHCP server the same
way as other clients do (e.g. your computer or mobile phone).

For reasons unknown to me, LXC containers created by LuCI use `LXC_NAME` as the
hostname. Let’s fix that!

Using your favorite editor (mine is ViM), edit `/etc/hostname` and `/etc/hosts`
to replace the silly string `LXC_NAME` with a more descriptive name (e.g.
`unifi`). See
[https://forum.turris.cz/t/hostname-for-lxc-container/1232](https://forum.turris.cz/t/hostname-for-lxc-container/1232%29)

We are done with configuring the container from inside, you can disconnect from
it now. (But keep the connection to the router itself.)

### Enable autostart

Newly created containers are not started automatically. After your router
reboots (e.g. in case of a power outage), the container requires a manual
intervention to start it up. That’s not practical for services that we want to
be always on.

Enable auto-start of the container by following the official guide at
[https://docs.turris.cz/geek/lxc/lxc#starting-the-container-at-boot](https://docs.turris.cz/geek/lxc/lxc#starting-the-container-at-boot)

### Make your LXC container easy to find

As I mentioned before, the container is just another network client configured
via DHCP. By default, DHCP assigns IP addresses dynamically, which means the IP
address of your container can change over time. This is not very practical — you
have to look up the current IP address of the container before you can connect
to it.

I recommend to assign a static DHCP lease with a custom IP address for the
container and add a DNS entry for this address.

1.  Go to
    [https://192.168.1.1/cgi-bin/luci/admin/network/dhcp](https://192.168.1.1/cgi-bin/luci/admin/network/dhcp),
    scroll down to “Static Leases” and add a new record. Check the list in
    “Active DHCP Leases” to find the MAC address of your LXC container.
2.  Go to
    [https://192.168.1.1/foris/config/main/dns/](https://192.168.1.1/foris/config/main/dns/)
    and check “Enable DHCP clients in DNS”. Pick a top-level domain to use for
    your local hosts, e.g. `.lan` to get
    [https://unifi.lan/](https://unifi.lan/) as the address of your LXC
    container.

## Install UniFi Network Controller

This becomes surprisingly easy! Essentially, you need to add Ubiquity package
repository and then run `apt-get install unifi`. Just attach to your container
again (using `lxc-attach`) and follow the official Ubiquity guide:
[https://help.ubnt.com/hc/en-us/articles/220066768-UniFi-How-to-Install-and-Update-via-APT-on-Debian-or-Ubuntu](https://help.ubnt.com/hc/en-us/articles/220066768-UniFi-How-to-Install-and-Update-via-APT-on-Debian-or-Ubuntu)

_Alternatively, you can use the all-in-one install & update scripts provided by
UniFi community here:_
[_https://community.ui.com/questions/UniFi-Installation-Scripts-or-UniFi-Easy-Update-Script-or-UniFi-Lets-Encrypt-or-Ubuntu-16-04-18-04-/ccbc7530-dd61-40a7-82ec-22b17f027776_](https://community.ui.com/questions/UniFi-Installation-Scripts-or-UniFi-Easy-Update-Script-or-UniFi-Lets-Encrypt-or-Ubuntu-16-04-18-04-/ccbc7530-dd61-40a7-82ec-22b17f027776)
_(Please note that I didn’t run it myself, I have no idea if the script works in
our setup.)_

Important: you are going to install and run MongoDB version 2.6. This version is
not supported since 2016, there may be known security vulnerabilities. Make sure
the database server is not exposed to your network! Fortunately, the default
configuration binds the server to `127.0.0.1` only 👌. All should be good as
long as you don’t change that configuration.

Optionally, you can generate an HTTPS certificate to avoid relying on a TSL
certificate issued by Ubiquity or the package install script. See the official
docs here:
[https://help.ubnt.com/hc/en-us/articles/212500127-UniFi-SSL-certificate-error-upon-opening-controller-page](https://help.ubnt.com/hc/en-us/articles/212500127-UniFi-SSL-certificate-error-upon-opening-controller-page)
Unfortunately, this creates a self-signed certificate which is not trusted by
browsers, but at least you can be sure nobody else has the private key.

And that’s it! Now you can open
[https://unifi.lan:8443/](https://unifi.lan:8443/) in the browser and proceed
with the configuration of your controller.

In the future, you may want to upgrade the controller to a newer version. This
is super easy as it’s the same process as for upgrading other Linux packages.

```shell
# Update the database of available packages & versions
$ apt-get update

# Upgrade all packages to their latest version
$ apt-get upgrade
```

## UPDATE 2020–08–12

I found that UniFi Network Controller was not able to automatically check for
updates and download new AP firmware versions. The log file
`/var/log/unifi/server.log` contained `fwupdate` error message saying “unable to
find valid certification path to requested target”. Run the following commands
inside your LXC container (`unifi`) to fix the problem:

```shell
$ service unifi stop
$ rm /etc/ssl/certs/java/cacerts &> /dev/null
$ update-ca-certificates -f
$ service unifi start
```
